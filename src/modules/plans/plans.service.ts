import { and, asc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/client";
import { type Plan, type PlanScope, plans } from "../../db/schema";
import { firstRow } from "../../db/utils";
import { BadRequestError, ForbiddenError, NotFoundError, ValidationError } from "../../shared/errors";
import type { CreatePlanInput, ListPlansQuery, UpdatePlanInput } from "./plans.schemas";

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
 * Plans an account may see and use: every predefined plan plus its own custom plans.
 * `null` means "no account yet" (account creation): predefined plans only.
 */
function visibleTo(accountId: string | null): SQL | undefined {
  return accountId === null
    ? isNull(plans.ownerAccountId)
    : or(isNull(plans.ownerAccountId), eq(plans.ownerAccountId, accountId));
}

/** A per-request limit above the monthly limit could never be used, so it is rejected. */
function assertLimitsConsistent(monthlyLimit: number, maxUnitsPerRequest: number): void {
  if (maxUnitsPerRequest > monthlyLimit) {
    throw new ValidationError([
      { path: "maxUnitsPerRequest", message: "maxUnitsPerRequest cannot be greater than monthlyLimit" },
    ]);
  }
}

/** Another account's custom plan is reported as not found, so its existence is not revealed. */
export async function getPlanOrThrow(accountId: string | null, planId: string, conn: DbOrTx = db): Promise<Plan> {
  const [plan] = await conn
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), visibleTo(accountId)));

  if (!plan) {
    throw new NotFoundError("PLAN_NOT_FOUND", "Plan not found");
  }
  return plan;
}

/**
 * Loads a plan the caller may assign to an account or a user: visible to the
 * caller and of the required scope. Used wherever a plan is assigned.
 */
export async function getAssignablePlanOrThrow(
  accountId: string | null,
  planId: string,
  scope: PlanScope,
  conn: DbOrTx = db,
): Promise<Plan> {
  const plan = await getPlanOrThrow(accountId, planId, conn);
  if (plan.scope !== scope) {
    throw new BadRequestError("PLAN_SCOPE_MISMATCH", `Plan is a ${plan.scope} plan; a ${scope} plan is required`);
  }
  return plan;
}

/** Predefined plans first, then the account's own plans in creation order. */
export async function listPlans(accountId: string, query: ListPlansQuery): Promise<PlanResponse[]> {
  const rows = await db
    .select()
    .from(plans)
    .where(and(visibleTo(accountId), query.scope ? eq(plans.scope, query.scope) : undefined))
    .orderBy(sql`${plans.ownerAccountId} IS NOT NULL`, asc(plans.createdAt), asc(plans.name));

  return rows.map(toPlanResponse);
}

export async function createPlan(accountId: string, input: CreatePlanInput): Promise<PlanResponse> {
  assertLimitsConsistent(input.monthlyLimit, input.maxUnitsPerRequest);

  const plan = firstRow(await db.insert(plans).values({ ...input, ownerAccountId: accountId }).returning());
  return toPlanResponse(plan);
}

/**
 * Updates a custom plan. Takes effect immediately for every account or user on
 * the plan; their usage totals are untouched.
 *
 * The row is locked while the merged limits are checked, so two concurrent
 * partial updates cannot together produce an inconsistent plan.
 */
export async function updatePlan(accountId: string, planId: string, input: UpdatePlanInput): Promise<PlanResponse> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, planId), visibleTo(accountId)))
      .for("update");

    if (!current) {
      throw new NotFoundError("PLAN_NOT_FOUND", "Plan not found");
    }
    if (current.ownerAccountId === null) {
      throw new ForbiddenError("PREDEFINED_PLAN_READ_ONLY", "Predefined plans cannot be modified");
    }

    assertLimitsConsistent(
      input.monthlyLimit ?? current.monthlyLimit,
      input.maxUnitsPerRequest ?? current.maxUnitsPerRequest,
    );

    const updated = firstRow(
      await tx
        .update(plans)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(plans.id, planId))
        .returning(),
    );
    return toPlanResponse(updated);
  });
}
