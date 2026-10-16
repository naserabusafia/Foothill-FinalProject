import { sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import { seedPredefinedPlans } from "../../src/db/seed";

/** Empties every table and restores the predefined plans. Call in beforeEach. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE consumption_requests, user_monthly_usage, account_monthly_usage,
             users, api_keys, plans, accounts
    CASCADE
  `);
  await seedPredefinedPlans();
}
