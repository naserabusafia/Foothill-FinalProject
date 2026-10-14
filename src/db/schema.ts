/**
 * Database schema. Design rationale: docs/database-design.md
 *
 * Column names are written in camelCase here and mapped to snake_case in the
 * database by the `casing: "snake_case"` option (client.ts and drizzle.config.ts).
 */
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planScope = pgEnum("plan_scope", ["account", "user"]);

/** `pending` exists only inside the consume transaction and is never committed. */
export const requestStatus = pgEnum("request_status", ["pending", "accepted", "rejected"]);

export const rejectionRule = pgEnum("rejection_rule", ["max_units_per_request", "monthly_limit"]);

export const rejectionScope = pgEnum("rejection_scope", ["account", "user"]);

// ---------------------------------------------------------------------------
// Shared column helpers
// ---------------------------------------------------------------------------

/** Unit amounts are bigint in Postgres; values stay well inside JS safe integers. */
const units = () => bigint({ mode: "number" });

/** Month buckets are stored as the first day of the month, e.g. "2026-10-01". */
const month = () => date({ mode: "string" });

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// plans: predefined (owner_account_id IS NULL) and custom plans
// ---------------------------------------------------------------------------

export const plans = pgTable(
  "plans",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 100 }).notNull(),
    scope: planScope().notNull(),
    ownerAccountId: uuid().references((): AnyPgColumn => accounts.id),
    monthlyLimit: units().notNull(),
    maxUnitsPerRequest: units().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Target of the composite (plan_id, plan_scope) foreign keys.
    unique("plans_id_scope_uk").on(t.id, t.scope),
    index("plans_owner_account_idx").on(t.ownerAccountId),
    check("plans_monthly_limit_ck", sql`${t.monthlyLimit} > 0`),
    check("plans_max_units_per_request_ck", sql`${t.maxUnitsPerRequest} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: varchar({ length: 200 }).notNull(),
    planId: uuid().notNull(),
    // Always 'account'; lets the composite FK reject user plans.
    planScope: planScope().notNull().default("account"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "accounts_plan_fk",
      columns: [t.planId, t.planScope],
      foreignColumns: [plans.id, plans.scope],
    }),
    check("accounts_plan_scope_ck", sql`${t.planScope} = 'account'`),
  ],
);

// ---------------------------------------------------------------------------
// api_keys: only the SHA-256 hash of each key is stored
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    keyHash: char({ length: 64 }).notNull().unique("api_keys_key_hash_uk"),
    keyPrefix: varchar({ length: 12 }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("api_keys_account_idx").on(t.accountId)],
);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    externalId: varchar({ length: 255 }),
    name: varchar({ length: 200 }).notNull(),
    planId: uuid().notNull(),
    // Always 'user'; lets the composite FK reject account plans.
    planScope: planScope().notNull().default("user"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "users_plan_fk",
      columns: [t.planId, t.planScope],
      foreignColumns: [plans.id, plans.scope],
    }),
    check("users_plan_scope_ck", sql`${t.planScope} = 'user'`),
    // Target of the composite (account_id, user_id) FK from consumption_requests.
    unique("users_account_id_uk").on(t.accountId, t.id),
    unique("users_external_id_uk").on(t.accountId, t.externalId),
    index("users_plan_idx").on(t.planId),
  ],
);

// ---------------------------------------------------------------------------
// Monthly usage counters: one row per subject per month, locked FOR UPDATE
// during consumption. Remaining = max(0, current plan limit - used_units).
// ---------------------------------------------------------------------------

export const accountMonthlyUsage = pgTable(
  "account_monthly_usage",
  {
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    month: month().notNull(),
    usedUnits: units().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "account_monthly_usage_pk", columns: [t.accountId, t.month] }),
    check("account_monthly_usage_month_ck", sql`${t.month} = date_trunc('month', ${t.month})::date`),
    check("account_monthly_usage_used_units_ck", sql`${t.usedUnits} >= 0`),
  ],
);

export const userMonthlyUsage = pgTable(
  "user_monthly_usage",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id),
    month: month().notNull(),
    usedUnits: units().notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "user_monthly_usage_pk", columns: [t.userId, t.month] }),
    check("user_monthly_usage_month_ck", sql`${t.month} = date_trunc('month', ${t.month})::date`),
    check("user_monthly_usage_used_units_ck", sql`${t.usedUnits} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// consumption_requests: idempotency key, decision log, and decision snapshot
// ---------------------------------------------------------------------------

export const consumptionRequests = pgTable(
  "consumption_requests",
  {
    id: uuid().primaryKey().defaultRandom(),
    accountId: uuid().notNull(),
    userId: uuid().notNull(),
    requestId: varchar({ length: 255 }).notNull(),
    units: units().notNull(),
    month: month().notNull(),
    status: requestStatus().notNull(),
    rejectionRule: rejectionRule(),
    rejectionScope: rejectionScope(),

    // Snapshot of the inputs the decision was based on. Plain columns, not FKs:
    // this is history and must survive later plan changes.
    accountPlanId: uuid(),
    userPlanId: uuid(),
    accountMonthlyLimit: units(),
    userMonthlyLimit: units(),
    accountMaxPerRequest: units(),
    userMaxPerRequest: units(),
    accountUsedBefore: units(),
    userUsedBefore: units(),

    createdAt: createdAt(),
    decidedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("consumption_requests_idempotency_uk").on(t.accountId, t.requestId),
    foreignKey({
      name: "consumption_requests_user_fk",
      columns: [t.accountId, t.userId],
      foreignColumns: [users.accountId, users.id],
    }),
    check("consumption_requests_units_ck", sql`${t.units} > 0`),
    check("consumption_requests_month_ck", sql`${t.month} = date_trunc('month', ${t.month})::date`),
    check(
      "consumption_requests_rejection_ck",
      sql`(${t.status} = 'rejected' AND ${t.rejectionRule} IS NOT NULL AND ${t.rejectionScope} IS NOT NULL)
       OR (${t.status} <> 'rejected' AND ${t.rejectionRule} IS NULL AND ${t.rejectionScope} IS NULL)`,
    ),
    check(
      "consumption_requests_decided_ck",
      sql`${t.status} = 'pending' OR (
        ${t.decidedAt} IS NOT NULL
        AND ${t.accountPlanId} IS NOT NULL AND ${t.userPlanId} IS NOT NULL
        AND ${t.accountMonthlyLimit} IS NOT NULL AND ${t.userMonthlyLimit} IS NOT NULL
        AND ${t.accountMaxPerRequest} IS NOT NULL AND ${t.userMaxPerRequest} IS NOT NULL
        AND ${t.accountUsedBefore} IS NOT NULL AND ${t.userUsedBefore} IS NOT NULL
      )`,
    ),
    index("consumption_requests_account_created_idx").on(t.accountId, t.createdAt.desc(), t.id.desc()),
    index("consumption_requests_user_created_idx").on(t.userId, t.createdAt.desc(), t.id.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type User = typeof users.$inferSelect;
export type AccountMonthlyUsage = typeof accountMonthlyUsage.$inferSelect;
export type UserMonthlyUsage = typeof userMonthlyUsage.$inferSelect;
export type ConsumptionRequest = typeof consumptionRequests.$inferSelect;
export type PlanScope = (typeof planScope.enumValues)[number];
export type RequestStatus = (typeof requestStatus.enumValues)[number];
export type RejectionRule = (typeof rejectionRule.enumValues)[number];
export type RejectionScope = (typeof rejectionScope.enumValues)[number];
