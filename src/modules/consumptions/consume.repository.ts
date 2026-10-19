/**
 * Queries used inside the consume transaction. Every function takes `tx`
 * (never `db`), so TypeScript refuses to run them outside the transaction
 * that holds the locks.
 */
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "../../db/client";
import {
  accountMonthlyUsage,
  accounts,
  type ConsumptionRequest,
  consumptionRequests,
  type Plan,
  plans,
  type RejectionRule,
  type RejectionScope,
  userMonthlyUsage,
  users,
} from "../../db/schema";
import { firstRow } from "../../db/utils";

/** Fail fast instead of queueing forever behind a busy account (mapped to 503 by the error handler). */
export async function setLockTimeout(tx: Tx, milliseconds: number): Promise<void> {
  // SET does not accept bind parameters; the value is a validated integer from config.
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${Math.trunc(milliseconds)}`));
}

/**
 * Claims (account_id, request_id) by inserting a pending row. Returns its id,
 * or null if the requestId was already used. A concurrent duplicate blocks on
 * the unique index until this transaction ends, then gets null.
 */
export async function reserveRequest(
  tx: Tx,
  values: { accountId: string; userId: string; requestId: string; units: number; month: string },
): Promise<string | null> {
  const [row] = await tx
    .insert(consumptionRequests)
    .values({ ...values, status: "pending" })
    .onConflictDoNothing({ target: [consumptionRequests.accountId, consumptionRequests.requestId] })
    .returning({ id: consumptionRequests.id });

  return row?.id ?? null;
}

export async function findRequest(tx: Tx, accountId: string, requestId: string): Promise<ConsumptionRequest> {
  return firstRow(
    await tx
      .select()
      .from(consumptionRequests)
      .where(and(eq(consumptionRequests.accountId, accountId), eq(consumptionRequests.requestId, requestId))),
  );
}

/** FOR UPDATE cannot lock a row that does not exist, so the month's rows are created first. */
export async function ensureUsageRows(tx: Tx, accountId: string, userId: string, month: string): Promise<void> {
  await tx.insert(accountMonthlyUsage).values({ accountId, month }).onConflictDoNothing();
  await tx.insert(userMonthlyUsage).values({ userId, month }).onConflictDoNothing();
}

/** Lock 1 of 2. Always taken before the user lock, so two consumptions can never deadlock. */
export async function lockAccountUsage(tx: Tx, accountId: string, month: string): Promise<number> {
  const row = firstRow(
    await tx
      .select({ used: accountMonthlyUsage.usedUnits })
      .from(accountMonthlyUsage)
      .where(and(eq(accountMonthlyUsage.accountId, accountId), eq(accountMonthlyUsage.month, month)))
      .for("update"),
  );
  return row.used;
}

/** Lock 2 of 2. */
export async function lockUserUsage(tx: Tx, userId: string, month: string): Promise<number> {
  const row = firstRow(
    await tx
      .select({ used: userMonthlyUsage.usedUnits })
      .from(userMonthlyUsage)
      .where(and(eq(userMonthlyUsage.userId, userId), eq(userMonthlyUsage.month, month)))
      .for("update"),
  );
  return row.used;
}

/**
 * Both plans currently applied, in one query. Read after the usage locks are
 * held, so the decision uses the latest committed plan settings.
 */
export async function loadCurrentPlans(
  tx: Tx,
  accountId: string,
  userId: string,
): Promise<{ accountPlan: Plan; userPlan: Plan }> {
  const accountPlan = alias(plans, "account_plan");
  const userPlan = alias(plans, "user_plan");

  return firstRow(
    await tx
      .select({ accountPlan, userPlan })
      .from(users)
      .innerJoin(accounts, eq(accounts.id, users.accountId))
      .innerJoin(accountPlan, eq(accountPlan.id, accounts.planId))
      .innerJoin(userPlan, eq(userPlan.id, users.planId))
      .where(and(eq(users.id, userId), eq(users.accountId, accountId))),
  );
}

/** Adds in SQL (used_units + n), never a value computed in JS. */
export async function incrementUsage(tx: Tx, accountId: string, userId: string, month: string, units: number): Promise<void> {
  await tx
    .update(accountMonthlyUsage)
    .set({ usedUnits: sql`${accountMonthlyUsage.usedUnits} + ${units}`, updatedAt: new Date() })
    .where(and(eq(accountMonthlyUsage.accountId, accountId), eq(accountMonthlyUsage.month, month)));

  await tx
    .update(userMonthlyUsage)
    .set({ usedUnits: sql`${userMonthlyUsage.usedUnits} + ${units}`, updatedAt: new Date() })
    .where(and(eq(userMonthlyUsage.userId, userId), eq(userMonthlyUsage.month, month)));
}

export interface DecisionRecord {
  status: "accepted" | "rejected";
  rejectionRule: RejectionRule | null;
  rejectionScope: RejectionScope | null;
  accountPlan: Plan;
  userPlan: Plan;
  accountUsedBefore: number;
  userUsedBefore: number;
}

/** Turns the pending row into the final decision with a snapshot of everything it was based on. */
export async function saveDecision(tx: Tx, id: string, record: DecisionRecord): Promise<ConsumptionRequest> {
  return firstRow(
    await tx
      .update(consumptionRequests)
      .set({
        status: record.status,
        rejectionRule: record.rejectionRule,
        rejectionScope: record.rejectionScope,
        accountPlanId: record.accountPlan.id,
        userPlanId: record.userPlan.id,
        accountMonthlyLimit: record.accountPlan.monthlyLimit,
        userMonthlyLimit: record.userPlan.monthlyLimit,
        accountMaxPerRequest: record.accountPlan.maxUnitsPerRequest,
        userMaxPerRequest: record.userPlan.maxUnitsPerRequest,
        accountUsedBefore: record.accountUsedBefore,
        userUsedBefore: record.userUsedBefore,
        decidedAt: new Date(),
      })
      .where(eq(consumptionRequests.id, id))
      .returning(),
  );
}
