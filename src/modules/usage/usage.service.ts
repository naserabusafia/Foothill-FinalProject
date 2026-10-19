import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { accountMonthlyUsage, userMonthlyUsage } from "../../db/schema";
import { ValidationError } from "../../shared/errors";
import { currentMonthUtc, toMonthLabel } from "../../shared/month";
import { getAccountOrThrow } from "../accounts/accounts.service";
import { remaining } from "../consumptions/decide";
import type { PlanResponse } from "../plans/plans.service";
import { getUserDetailsOrThrow } from "../users/users.service";

export interface UsageResponse {
  month: string;
  /** Accepted units counted in that month. */
  used: number;
  /**
   * The plan applied now and what is left under it. Only for the current month:
   * a past month may have run under different limits, so "remaining" would mislead.
   */
  plan: PlanResponse | null;
  remaining: number | null;
}

/** Resolves ?month= to a stored month; rejects months that have not started yet. */
function resolveMonth(requested: string | undefined): { month: string; isCurrent: boolean } {
  const current = currentMonthUtc();
  const month = requested ?? current;
  if (month > current) {
    throw new ValidationError([{ path: "month", message: "Month is in the future" }]);
  }
  return { month, isCurrent: month === current };
}

function toUsageResponse(month: string, isCurrent: boolean, used: number, plan: PlanResponse): UsageResponse {
  return {
    month: toMonthLabel(month),
    used,
    plan: isCurrent ? plan : null,
    remaining: isCurrent ? remaining({ monthlyLimit: plan.monthlyLimit, used }) : null,
  };
}

export async function getAccountUsage(accountId: string, requestedMonth?: string): Promise<UsageResponse> {
  const { month, isCurrent } = resolveMonth(requestedMonth);
  const account = await getAccountOrThrow(accountId);

  // No row yet means nothing was consumed that month.
  const [row] = await db
    .select({ used: accountMonthlyUsage.usedUnits })
    .from(accountMonthlyUsage)
    .where(and(eq(accountMonthlyUsage.accountId, accountId), eq(accountMonthlyUsage.month, month)));

  return toUsageResponse(month, isCurrent, row?.used ?? 0, account.plan);
}

export async function getUserUsage(accountId: string, userId: string, requestedMonth?: string): Promise<UsageResponse> {
  const { month, isCurrent } = resolveMonth(requestedMonth);
  // Also the ownership check: another account's user is a 404.
  const user = await getUserDetailsOrThrow(accountId, userId);

  const [row] = await db
    .select({ used: userMonthlyUsage.usedUnits })
    .from(userMonthlyUsage)
    .where(and(eq(userMonthlyUsage.userId, userId), eq(userMonthlyUsage.month, month)));

  return toUsageResponse(month, isCurrent, row?.used ?? 0, user.plan);
}
