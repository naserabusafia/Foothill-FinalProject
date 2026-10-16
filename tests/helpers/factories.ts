import { db } from "../../src/db/client";
import { type NewPlan, plans } from "../../src/db/schema";
import { firstRow } from "../../src/db/utils";
import { createAccount } from "../../src/modules/accounts/accounts.service";

let counter = 0;
const unique = (label: string) => `${label} ${++counter}`;

/** Creates an account through the real service; returns it with its plain API key. */
export async function createTestAccount(overrides: { name?: string; planId?: string } = {}) {
  return createAccount({
    name: overrides.name ?? unique("Account"),
    planId: overrides.planId ?? "00000000-0000-4000-8000-000000000001",
  });
}

/** Inserts a custom plan directly (the plans API arrives in a later branch). */
export async function createTestPlan(values: Partial<NewPlan> & Pick<NewPlan, "scope" | "ownerAccountId">) {
  return firstRow(
    await db
      .insert(plans)
      .values({ name: unique("Plan"), monthlyLimit: 1_000, maxUnitsPerRequest: 100, ...values })
      .returning(),
  );
}
