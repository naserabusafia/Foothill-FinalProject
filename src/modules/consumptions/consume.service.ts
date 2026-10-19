import { config } from "../../config";
import { db } from "../../db/client";
import type { ConsumptionRequest, RejectionRule, RejectionScope } from "../../db/schema";
import { ConflictError } from "../../shared/errors";
import { currentMonthUtc, toMonthLabel } from "../../shared/month";
import { getUserOrThrow } from "../users/users.service";
import * as repo from "./consume.repository";
import type { ConsumeInput } from "./consumptions.schemas";
import { decide, remaining } from "./decide";

export interface LimitSummary {
  planId: string;
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  /** Units used this month after this decision. */
  used: number;
  remaining: number;
}

export interface ConsumptionResponse {
  requestId: string;
  userId: string;
  units: number;
  accepted: boolean;
  /** Present only when rejected: which rule stopped it and whose rule it is. */
  rejection: { rule: RejectionRule; scope: RejectionScope; message: string } | null;
  month: string;
  account: LimitSummary;
  user: LimitSummary;
  decidedAt: Date;
}

export interface ConsumeResult {
  response: ConsumptionResponse;
  /** True when this requestId was already decided and the original decision is returned. */
  replayed: boolean;
}

const RULE_MESSAGES: Record<RejectionScope, Record<RejectionRule, string>> = {
  user: {
    max_units_per_request: "Requested units exceed the user's per-request limit",
    monthly_limit: "Not enough remaining units in the user's monthly allowance",
  },
  account: {
    max_units_per_request: "Requested units exceed the account's per-request limit",
    monthly_limit: "Not enough remaining units in the account's monthly allowance",
  },
};

/**
 * Built only from the stored row (decision + snapshot), so a replay returns
 * exactly what the original call returned, whatever changed since.
 */
function toConsumptionResponse(record: ConsumptionRequest): ConsumptionResponse {
  const accepted = record.status === "accepted";
  const added = accepted ? record.units : 0;

  const summary = (
    planId: string | null,
    monthlyLimit: number | null,
    maxUnitsPerRequest: number | null,
    usedBefore: number | null,
  ): LimitSummary => {
    // consumption_requests_decided_ck guarantees the snapshot on every decided row.
    if (planId === null || monthlyLimit === null || maxUnitsPerRequest === null || usedBefore === null) {
      throw new Error(`Consumption request ${record.id} has no decision snapshot`);
    }
    const used = usedBefore + added;
    return { planId, monthlyLimit, maxUnitsPerRequest, used, remaining: remaining({ monthlyLimit, used }) };
  };

  return {
    requestId: record.requestId,
    userId: record.userId,
    units: record.units,
    accepted,
    rejection:
      record.rejectionRule && record.rejectionScope
        ? {
            rule: record.rejectionRule,
            scope: record.rejectionScope,
            message: RULE_MESSAGES[record.rejectionScope][record.rejectionRule],
          }
        : null,
    month: toMonthLabel(record.month),
    account: summary(record.accountPlanId, record.accountMonthlyLimit, record.accountMaxPerRequest, record.accountUsedBefore),
    user: summary(record.userPlanId, record.userMonthlyLimit, record.userMaxPerRequest, record.userUsedBefore),
    decidedAt: record.decidedAt ?? record.createdAt,
  };
}

/**
 * Consumes `units` for a user of the account, or rejects the request and
 * consumes nothing. One transaction:
 *
 *   reserve requestId -> create month rows -> lock account usage -> lock user usage
 *   -> read current plans -> decide -> increment (if accepted) -> save decision
 *
 * Any error rolls everything back (including the reservation), so the caller
 * can safely retry with the same requestId.
 */
export async function consume(accountId: string, input: ConsumeInput): Promise<ConsumeResult> {
  // Ownership check before taking any lock: another account's user is a 404.
  await getUserOrThrow(accountId, input.userId);

  const month = currentMonthUtc();

  return db.transaction(async (tx) => {
    await repo.setLockTimeout(tx, config.CONSUME_LOCK_TIMEOUT_MS);

    const reservedId = await repo.reserveRequest(tx, { accountId, ...input, month });
    if (reservedId === null) {
      return replay(await repo.findRequest(tx, accountId, input.requestId), input);
    }

    await repo.ensureUsageRows(tx, accountId, input.userId, month);
    const accountUsed = await repo.lockAccountUsage(tx, accountId, month);
    const userUsed = await repo.lockUserUsage(tx, input.userId, month);
    const { accountPlan, userPlan } = await repo.loadCurrentPlans(tx, accountId, input.userId);

    const decision = decide({
      units: input.units,
      account: { monthlyLimit: accountPlan.monthlyLimit, maxUnitsPerRequest: accountPlan.maxUnitsPerRequest, used: accountUsed },
      user: { monthlyLimit: userPlan.monthlyLimit, maxUnitsPerRequest: userPlan.maxUnitsPerRequest, used: userUsed },
    });

    if (decision.accepted) {
      await repo.incrementUsage(tx, accountId, input.userId, month, input.units);
    }

    const record = await repo.saveDecision(tx, reservedId, {
      status: decision.accepted ? "accepted" : "rejected",
      rejectionRule: decision.accepted ? null : decision.rule,
      rejectionScope: decision.accepted ? null : decision.scope,
      accountPlan,
      userPlan,
      accountUsedBefore: accountUsed,
      userUsedBefore: userUsed,
    });

    return { response: toConsumptionResponse(record), replayed: false };
  });
}

/**
 * Same requestId again. Same payload: return the original decision, even if a
 * retry would now be decided differently (a new attempt needs a new requestId).
 * Different payload: the caller reused the key for another operation, 409.
 */
function replay(existing: ConsumptionRequest, input: ConsumeInput): ConsumeResult {
  if (existing.userId !== input.userId || existing.units !== input.units) {
    throw new ConflictError("REQUEST_ID_REUSED", "requestId was already used with a different userId or units", {
      requestId: input.requestId,
    });
  }
  return { response: toConsumptionResponse(existing), replayed: true };
}
