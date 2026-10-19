import { and, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../../db/client";
import { getPgError, PgErrorCode } from "../../db/errors";
import { type Plan, plans, type User, users } from "../../db/schema";
import { firstRow } from "../../db/utils";
import { ConflictError, NotFoundError } from "../../shared/errors";
import { decodeCursor, type Page, toPage } from "../../shared/pagination";
import { getAssignablePlanOrThrow, type PlanResponse, toPlanResponse } from "../plans/plans.service";
import type { CreateUserInput, ListUsersQuery } from "./users.schemas";

export interface UserResponse {
  id: string;
  externalId: string | null;
  name: string;
  plan: PlanResponse;
  createdAt: Date;
}

function toUserResponse(user: User, plan: Plan): UserResponse {
  return {
    id: user.id,
    externalId: user.externalId,
    name: user.name,
    plan: toPlanResponse(plan),
    createdAt: user.createdAt,
  };
}

/** Turns the unique-constraint error into a 409 the caller can act on. */
function rethrowIfExternalIdTaken(err: unknown): never {
  if (getPgError(err)?.constraint === "users_external_id_uk") {
    throw new ConflictError("EXTERNAL_ID_TAKEN", "Another user in this account already has this externalId");
  }
  throw err;
}

/**
 * The user row, scoped to the account. A user of another account is reported
 * as not found. Other modules (usage, consumptions) use this ownership check.
 */
export async function getUserOrThrow(accountId: string, userId: string, conn: DbOrTx = db): Promise<User> {
  const [user] = await conn
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.accountId, accountId)));

  if (!user) {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  return user;
}

/** The user with the plan currently applied to them. */
export async function getUserDetailsOrThrow(accountId: string, userId: string): Promise<UserResponse> {
  const [row] = await db
    .select({ user: users, plan: plans })
    .from(users)
    .innerJoin(plans, eq(plans.id, users.planId))
    .where(and(eq(users.id, userId), eq(users.accountId, accountId)));

  if (!row) {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  return toUserResponse(row.user, row.plan);
}

export async function createUser(accountId: string, input: CreateUserInput): Promise<UserResponse> {
  const plan = await getAssignablePlanOrThrow(accountId, input.planId, "user");

  try {
    const user = firstRow(
      await db
        .insert(users)
        .values({ accountId, name: input.name, externalId: input.externalId ?? null, planId: plan.id })
        .returning(),
    );
    return toUserResponse(user, plan);
  } catch (err) {
    rethrowIfExternalIdTaken(err);
  }
}

/** Newest first, cursor-paginated. Optional exact match on externalId. */
export async function listUsers(accountId: string, query: ListUsersQuery): Promise<Page<UserResponse>> {
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;

  const rows = await db
    .select({
      user: users,
      plan: plans,
      // Full-precision timestamp for the cursor (see shared/pagination.ts).
      cursor: { createdAt: sql<string>`${users.createdAt}::text`, id: users.id },
    })
    .from(users)
    .innerJoin(plans, eq(plans.id, users.planId))
    .where(
      and(
        eq(users.accountId, accountId),
        query.externalId ? eq(users.externalId, query.externalId) : undefined,
        after ? sql`(${users.createdAt}, ${users.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(query.limit + 1);

  return toPage(rows, query.limit, (row) => toUserResponse(row.user, row.plan));
}

/** Moves a user to another user plan. Their usage is not reset. */
export async function changeUserPlan(accountId: string, userId: string, planId: string): Promise<UserResponse> {
  const plan = await getAssignablePlanOrThrow(accountId, planId, "user");

  const [user] = await db
    .update(users)
    .set({ planId: plan.id, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.accountId, accountId)))
    .returning();

  if (!user) {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  }
  return toUserResponse(user, plan);
}
