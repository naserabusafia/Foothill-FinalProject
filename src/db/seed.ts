import { db } from "./client";
import { type NewPlan, plans } from "./schema";

/**
 * Predefined plans (owner_account_id = NULL, read-only through the API).
 * Fixed ids make the seed idempotent and let clients reference them directly.
 */
export const PREDEFINED_PLAN_IDS = {
  starter: "00000000-0000-4000-8000-000000000001",
  pro: "00000000-0000-4000-8000-000000000002",
  basic: "00000000-0000-4000-8000-000000000003",
  premium: "00000000-0000-4000-8000-000000000004",
} as const;

export const PREDEFINED_PLANS: NewPlan[] = [
  { id: PREDEFINED_PLAN_IDS.starter, name: "Starter", scope: "account", monthlyLimit: 10_000, maxUnitsPerRequest: 100 },
  { id: PREDEFINED_PLAN_IDS.pro, name: "Pro", scope: "account", monthlyLimit: 100_000, maxUnitsPerRequest: 1_000 },
  { id: PREDEFINED_PLAN_IDS.basic, name: "Basic", scope: "user", monthlyLimit: 500, maxUnitsPerRequest: 50 },
  { id: PREDEFINED_PLAN_IDS.premium, name: "Premium", scope: "user", monthlyLimit: 5_000, maxUnitsPerRequest: 200 },
];

export async function seedPredefinedPlans(): Promise<void> {
  await db.insert(plans).values(PREDEFINED_PLANS).onConflictDoNothing({ target: plans.id });
}
