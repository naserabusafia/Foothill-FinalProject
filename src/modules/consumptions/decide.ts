import type { RejectionRule, RejectionScope } from "../../db/schema";

/** One side of the check: the limits of the plan applied now and what was used this month. */
export interface LimitState {
  monthlyLimit: number;
  maxUnitsPerRequest: number;
  used: number;
}

export interface DecisionInput {
  units: number;
  account: LimitState;
  user: LimitState;
}

export type Decision =
  | { accepted: true }
  | { accepted: false; rule: RejectionRule; scope: RejectionScope };

/**
 * Decides whether `units` may be consumed. Pure: no I/O, so every rule can be
 * unit-tested directly. All four rules must pass; the full amount is accepted
 * or nothing is.
 *
 * When several rules fail, the first in this fixed order is reported, so the
 * same inputs always give the same reason:
 *   1. user per-request limit      2. account per-request limit
 *   3. user monthly allowance      4. account monthly allowance
 * Per-request limits come first because no amount of remaining allowance can
 * make such a request pass; it must be split.
 */
export function decide({ units, account, user }: DecisionInput): Decision {
  if (units > user.maxUnitsPerRequest) {
    return { accepted: false, rule: "max_units_per_request", scope: "user" };
  }
  if (units > account.maxUnitsPerRequest) {
    return { accepted: false, rule: "max_units_per_request", scope: "account" };
  }
  if (user.used + units > user.monthlyLimit) {
    return { accepted: false, rule: "monthly_limit", scope: "user" };
  }
  if (account.used + units > account.monthlyLimit) {
    return { accepted: false, rule: "monthly_limit", scope: "account" };
  }
  return { accepted: true };
}

/** What is left this month under the current limit; never negative (the limit may have been lowered). */
export function remaining(state: Pick<LimitState, "monthlyLimit" | "used">): number {
  return Math.max(0, state.monthlyLimit - state.used);
}
