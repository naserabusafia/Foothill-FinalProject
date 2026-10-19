import { describe, expect, it } from "vitest";
import { decide, type LimitState, remaining } from "../../src/modules/consumptions/decide";
import { currentMonthUtc, toMonthLabel } from "../../src/shared/month";

const roomy: LimitState = { monthlyLimit: 1_000, maxUnitsPerRequest: 50, used: 400 };
const ahmad: LimitState = { monthlyLimit: 100, maxUnitsPerRequest: 20, used: 70 };

describe("decide", () => {
  it("accepts when all four rules pass", () => {
    expect(decide({ units: 10, account: roomy, user: ahmad })).toEqual({ accepted: true });
  });

  it("accepts a request that lands exactly on every limit", () => {
    const user = { monthlyLimit: 100, maxUnitsPerRequest: 30, used: 70 };
    const account = { monthlyLimit: 430, maxUnitsPerRequest: 30, used: 400 };
    expect(decide({ units: 30, account, user })).toEqual({ accepted: true });
  });

  it("rejects above the user's per-request limit even with allowance left", () => {
    expect(decide({ units: 25, account: roomy, user: ahmad })).toEqual({
      accepted: false,
      rule: "max_units_per_request",
      scope: "user",
    });
  });

  it("rejects above the account's per-request limit", () => {
    const user = { ...ahmad, maxUnitsPerRequest: 100, used: 0 };
    const account = { ...roomy, maxUnitsPerRequest: 15 };
    expect(decide({ units: 20, account, user })).toEqual({
      accepted: false,
      rule: "max_units_per_request",
      scope: "account",
    });
  });

  it("rejects when the user's monthly allowance is short by one unit", () => {
    expect(decide({ units: 20, account: roomy, user: { ...ahmad, used: 81 } })).toEqual({
      accepted: false,
      rule: "monthly_limit",
      scope: "user",
    });
  });

  it("rejects on the account's allowance even if the user has plenty: a bigger user plan does not grow the account", () => {
    const account = { ...roomy, used: 995 };
    const user = { monthlyLimit: 5_000, maxUnitsPerRequest: 200, used: 0 };
    expect(decide({ units: 10, account, user })).toEqual({
      accepted: false,
      rule: "monthly_limit",
      scope: "account",
    });
  });

  it("rejects everything once a lowered limit is below what was already used", () => {
    expect(decide({ units: 1, account: roomy, user: { ...ahmad, monthlyLimit: 50, used: 80 } })).toMatchObject({
      accepted: false,
      rule: "monthly_limit",
      scope: "user",
    });
  });

  describe("reports the first failing rule in a fixed order", () => {
    const tight: LimitState = { monthlyLimit: 10, maxUnitsPerRequest: 5, used: 10 };

    it("user per-request beats everything", () => {
      expect(decide({ units: 50, account: tight, user: tight })).toMatchObject({ rule: "max_units_per_request", scope: "user" });
    });

    it("account per-request beats monthly rules", () => {
      const user = { ...tight, maxUnitsPerRequest: 100 };
      expect(decide({ units: 50, account: tight, user })).toMatchObject({ rule: "max_units_per_request", scope: "account" });
    });

    it("user monthly beats account monthly", () => {
      expect(decide({ units: 1, account: tight, user: tight })).toMatchObject({ rule: "monthly_limit", scope: "user" });
    });
  });
});

describe("remaining", () => {
  it("is the limit minus usage", () => {
    expect(remaining({ monthlyLimit: 100, used: 70 })).toBe(30);
  });

  it("never goes below zero", () => {
    expect(remaining({ monthlyLimit: 50, used: 80 })).toBe(0);
  });
});

describe("month helpers", () => {
  it("buckets by UTC calendar month", () => {
    expect(currentMonthUtc(new Date("2026-10-31T23:59:59.999Z"))).toBe("2026-10-01");
    expect(currentMonthUtc(new Date("2026-11-01T00:00:00.000Z"))).toBe("2026-11-01");
    // 01:30 on Nov 1 in UTC+3 is still October in UTC.
    expect(currentMonthUtc(new Date("2026-11-01T01:30:00+03:00"))).toBe("2026-10-01");
  });

  it("formats a stored month for callers", () => {
    expect(toMonthLabel("2026-10-01")).toBe("2026-10");
  });
});
