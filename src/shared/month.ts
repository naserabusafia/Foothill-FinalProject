import { z } from "zod";

/**
 * Usage is bucketed by calendar month in UTC. A month is stored as its first
 * day ("2026-10-01") and shown to callers as "2026-10".
 */
export function currentMonthUtc(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

/** "2026-10-01" -> "2026-10" */
export function toMonthLabel(month: string): string {
  return month.slice(0, 7);
}

/** Accepts "YYYY-MM" in a query string and yields the stored form "YYYY-MM-01". */
export const monthQuerySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected a month in YYYY-MM format")
  .transform((value) => `${value}-01`);
