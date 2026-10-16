import { and, eq, isNull, or } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/client";
import { type Plan, type PlanScope, plans } from "../../db/schema";
import { BadRequestError, NotFoundError } from "../../shared/errors";

export interface PlanResponse {
  id: string;
  name: string;
  scope: PlanScope;
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  predefined: boolean;
}

export function toPlanResponse(plan: Plan): PlanResponse {
  return {
    id: plan.id,
    name: plan.name,
    scope: plan.scope,
    monthlyLimit: plan.monthlyLimit,
    maxUnitsPerRequest: plan.maxUnitsPerRequest,
    predefined: plan.ownerAccountId === null,
  };
}

/**
 * Loads a plan the caller may assign: a predefined plan, or a custom plan owned
 * by `accountId` (pass null when there is no account yet, e.g. account creation).
 *
 * Another account's custom plan is reported as not found, so its existence is not revealed.
 */
export async function getAssignablePlanOrThrow(
  accountId: string | null,
  planId: string,
  scope: PlanScope,
  conn: DbOrTx = db,
): Promise<Plan> {
  const visibleToCaller =
    accountId === null ? isNull(plans.ownerAccountId) : or(isNull(plans.ownerAccountId), eq(plans.ownerAccountId, accountId));

  const [plan] = await conn
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), visibleToCaller));

  if (!plan) {
    throw new NotFoundError("PLAN_NOT_FOUND", "Plan not found");
  }
  if (plan.scope !== scope) {
    throw new BadRequestError("PLAN_SCOPE_MISMATCH", `Plan is a ${plan.scope} plan; a ${scope} plan is required`);
  }
  return plan;
}
