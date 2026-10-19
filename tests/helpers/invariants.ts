import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "../../src/db/client";

/**
 * The invariants from docs/database-design.md (section 7), checked against the
 * whole database. Each query returns the rows that break a rule, so all must be empty.
 */
export async function expectUsageInvariants(): Promise<void> {
  // 1. Each account counter equals the sum of its accepted requests that month.
  const accountVsLog = await db.execute(sql`
    SELECT a.account_id, a.month, a.used_units
    FROM account_monthly_usage a
    LEFT JOIN consumption_requests r
      ON r.account_id = a.account_id AND r.month = a.month AND r.status = 'accepted'
    GROUP BY a.account_id, a.month, a.used_units
    HAVING a.used_units <> COALESCE(SUM(r.units), 0)`);
  expect(accountVsLog.rows, "account counters match the request log").toEqual([]);

  // 2. Each user counter equals the sum of their accepted requests that month.
  const userVsLog = await db.execute(sql`
    SELECT u.user_id, u.month, u.used_units
    FROM user_monthly_usage u
    LEFT JOIN consumption_requests r
      ON r.user_id = u.user_id AND r.month = u.month AND r.status = 'accepted'
    GROUP BY u.user_id, u.month, u.used_units
    HAVING u.used_units <> COALESCE(SUM(r.units), 0)`);
  expect(userVsLog.rows, "user counters match the request log").toEqual([]);

  // 3. Each account counter equals the sum of its users' counters that month.
  const accountVsUsers = await db.execute(sql`
    SELECT a.account_id, a.month
    FROM account_monthly_usage a
    LEFT JOIN users us ON us.account_id = a.account_id
    LEFT JOIN user_monthly_usage u ON u.user_id = us.id AND u.month = a.month
    GROUP BY a.account_id, a.month, a.used_units
    HAVING a.used_units <> COALESCE(SUM(u.used_units), 0)`);
  expect(accountVsUsers.rows, "account counters equal the sum of their users").toEqual([]);

  // 4. No counter is above its limit at decision time: every accepted request fit its snapshot.
  const overLimit = await db.execute(sql`
    SELECT id FROM consumption_requests
    WHERE status = 'accepted'
      AND (account_used_before + units > account_monthly_limit
        OR user_used_before + units > user_monthly_limit
        OR units > account_max_per_request
        OR units > user_max_per_request)`);
  expect(overLimit.rows, "every accepted request fit the limits it was decided under").toEqual([]);

  // 5. Nothing is left pending after a transaction.
  const pending = await db.execute(sql`SELECT id FROM consumption_requests WHERE status = 'pending'`);
  expect(pending.rows, "no pending requests remain").toEqual([]);
}
