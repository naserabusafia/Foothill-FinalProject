import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { db } from "../../src/db/client";
import { accountMonthlyUsage, userMonthlyUsage } from "../../src/db/schema";
import { PREDEFINED_PLAN_IDS } from "../../src/db/seed";
import { resetDb } from "../helpers/db";
import { createScenario, createTestAccount, createTestUser } from "../helpers/factories";
import { expectUsageInvariants } from "../helpers/invariants";

const app = createApp();
let n = 0;

beforeEach(resetDb);
afterEach(() => {
  vi.useRealTimers();
});

function consume(apiKey: string, body: { userId: string; units: number; requestId?: string }) {
  return request(app)
    .post("/consumptions")
    .set("x-api-key", apiKey)
    .send({ requestId: `req-${++n}`, ...body });
}

async function usage(accountId: string, userId: string, month = "2026-10-01") {
  const [acc] = await db
    .select()
    .from(accountMonthlyUsage)
    .where(and(eq(accountMonthlyUsage.accountId, accountId), eq(accountMonthlyUsage.month, month)));
  const [usr] = await db
    .select()
    .from(userMonthlyUsage)
    .where(and(eq(userMonthlyUsage.userId, userId), eq(userMonthlyUsage.month, month)));
  return { account: acc?.usedUnits ?? 0, user: usr?.usedUnits ?? 0 };
}

/** The brief's example: account 1,000 / 50 per request, Ahmad 100 / 20. */
async function ahmadScenario() {
  const s = await createScenario({
    account: { monthlyLimit: 1_000, maxUnitsPerRequest: 50 },
    users: [
      { monthlyLimit: 100, maxUnitsPerRequest: 20 },
      { monthlyLimit: 200, maxUnitsPerRequest: 30 },
    ],
  });
  const [ahmad, sara] = s.users as [(typeof s.users)[number], (typeof s.users)[number]];
  return { ...s, ahmad, sara };
}

describe("POST /consumptions: decisions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  });

  it("accepts and counts the units for both the user and the account", async () => {
    const s = await ahmadScenario();

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 10, requestId: "req-123" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      requestId: "req-123",
      userId: s.ahmad.id,
      units: 10,
      accepted: true,
      rejection: null,
      month: "2026-10",
      account: { planId: s.accountPlanId, monthlyLimit: 1_000, maxUnitsPerRequest: 50, used: 10, remaining: 990 },
      user: { planId: s.ahmad.planId, monthlyLimit: 100, maxUnitsPerRequest: 20, used: 10, remaining: 90 },
    });
    expect(await usage(s.accountId, s.ahmad.id)).toEqual({ account: 10, user: 10 });
  });

  it("adds every user's consumption to the shared account total", async () => {
    const s = await ahmadScenario();
    await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });
    await consume(s.apiKey, { userId: s.sara.id, units: 30 });

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 10 });
    expect(res.body.account.used).toBe(60);
    expect(res.body.user.used).toBe(30);
    await expectUsageInvariants();
  });

  it("accepts a request that uses exactly the remaining allowance", async () => {
    const s = await ahmadScenario();
    for (let i = 0; i < 4; i++) await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });
    expect(res.body.accepted).toBe(true);
    expect(res.body.user).toMatchObject({ used: 100, remaining: 0 });
  });

  it.each([
    ["user per-request limit", { units: 25, prior: 0 }, "max_units_per_request", "user"],
    ["user monthly allowance", { units: 20, prior: 90 }, "monthly_limit", "user"],
  ])("rejects on the %s and consumes nothing", async (_label, { units, prior }, rule, scope) => {
    const s = await ahmadScenario();
    for (let left = prior; left > 0; left -= 20) {
      await consume(s.apiKey, { userId: s.ahmad.id, units: Math.min(20, left) });
    }
    const before = await usage(s.accountId, s.ahmad.id);

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units });

    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection).toMatchObject({ rule, scope });
    expect(res.body.rejection.message).toEqual(expect.any(String));
    expect(await usage(s.accountId, s.ahmad.id)).toEqual(before);
  });

  it("rejects on the account per-request limit", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 1_000, maxUnitsPerRequest: 15 },
      users: [{ monthlyLimit: 500, maxUnitsPerRequest: 100 }],
    });
    const res = await consume(s.apiKey, { userId: s.users[0]!.id, units: 20 });
    expect(res.body.rejection).toMatchObject({ rule: "max_units_per_request", scope: "account" });
    expect(res.body.account.used).toBe(0);
  });

  it("rejects on the account's allowance even when the user has plenty left", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 50, maxUnitsPerRequest: 50 },
      users: [
        { monthlyLimit: 5_000, maxUnitsPerRequest: 50 },
        { monthlyLimit: 5_000, maxUnitsPerRequest: 50 },
      ],
    });
    await consume(s.apiKey, { userId: s.users[0]!.id, units: 45 });

    const res = await consume(s.apiKey, { userId: s.users[1]!.id, units: 10 });
    expect(res.body.rejection).toMatchObject({ rule: "monthly_limit", scope: "account" });
    expect(res.body.user).toMatchObject({ used: 0, remaining: 5_000 });
    expect(res.body.account).toMatchObject({ used: 45, remaining: 5 });
  });

  it("keeps separate totals for users who share a plan", async () => {
    const { account, apiKey } = await createTestAccount();
    const a = await createTestUser(account.id, { planId: PREDEFINED_PLAN_IDS.basic });
    const b = await createTestUser(account.id, { planId: PREDEFINED_PLAN_IDS.basic });

    await consume(apiKey, { userId: a.id, units: 40 });
    const res = await consume(apiKey, { userId: b.id, units: 5 });
    expect(res.body.user).toMatchObject({ used: 5, remaining: 495 });
  });
});

describe("POST /consumptions: plan changes and months", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  });

  it("does not reset usage when the user moves to a bigger plan", async () => {
    const s = await ahmadScenario();
    for (let i = 0; i < 4; i++) await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });

    await request(app)
      .patch(`/users/${s.ahmad.id}/plan`)
      .set("x-api-key", s.apiKey)
      .send({ planId: s.sara.planId });

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 30 });
    expect(res.body.accepted).toBe(true);
    expect(res.body.user).toMatchObject({ monthlyLimit: 200, used: 110, remaining: 90 });
  });

  it("rejects everything after a limit is lowered below what was used, and shows 0 remaining", async () => {
    const s = await ahmadScenario();
    for (let i = 0; i < 4; i++) await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });

    await request(app)
      .patch(`/plans/${s.ahmad.planId}`)
      .set("x-api-key", s.apiKey)
      .send({ monthlyLimit: 50, maxUnitsPerRequest: 20 });

    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 1 });
    expect(res.body.accepted).toBe(false);
    expect(res.body.rejection).toMatchObject({ rule: "monthly_limit", scope: "user" });
    expect(res.body.user).toMatchObject({ monthlyLimit: 50, used: 80, remaining: 0 });
  });

  it("starts each calendar month (UTC) from zero and keeps the previous month", async () => {
    const s = await ahmadScenario();
    for (let i = 0; i < 4; i++) await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });

    vi.setSystemTime(new Date("2026-11-01T00:00:05Z"));
    const res = await consume(s.apiKey, { userId: s.ahmad.id, units: 20 });

    expect(res.body).toMatchObject({ accepted: true, month: "2026-11", user: { used: 20, remaining: 80 } });
    expect(await usage(s.accountId, s.ahmad.id, "2026-10-01")).toEqual({ account: 80, user: 80 });
    expect(await usage(s.accountId, s.ahmad.id, "2026-11-01")).toEqual({ account: 20, user: 20 });
  });
});

describe("POST /consumptions: idempotency", () => {
  it("returns the original decision for a retried requestId without counting again", async () => {
    const s = await ahmadScenario();

    const first = await consume(s.apiKey, { userId: s.ahmad.id, units: 10, requestId: "req-retry" });
    const retry = await consume(s.apiKey, { userId: s.ahmad.id, units: 10, requestId: "req-retry" });

    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.body).toEqual(first.body);
    expect(await usage(s.accountId, s.ahmad.id, first.body.month + "-01")).toEqual({ account: 10, user: 10 });
  });

  it("replays a rejection even after the plan would now allow it", async () => {
    const s = await ahmadScenario();
    const first = await consume(s.apiKey, { userId: s.ahmad.id, units: 25, requestId: "req-big" });
    expect(first.body.accepted).toBe(false);

    await request(app)
      .patch(`/plans/${s.ahmad.planId}`)
      .set("x-api-key", s.apiKey)
      .send({ maxUnitsPerRequest: 50 });

    const retry = await consume(s.apiKey, { userId: s.ahmad.id, units: 25, requestId: "req-big" });
    expect(retry.body).toEqual(first.body);

    const fresh = await consume(s.apiKey, { userId: s.ahmad.id, units: 25, requestId: "req-big-2" });
    expect(fresh.body.accepted).toBe(true);
  });

  it.each([
    ["different units", { units: 11 }],
    ["a different user", { other: true }],
  ])("rejects a reused requestId with %s (409)", async (_label, change) => {
    const s = await ahmadScenario();
    await consume(s.apiKey, { userId: s.ahmad.id, units: 10, requestId: "req-x" });

    const res = await consume(s.apiKey, {
      userId: "other" in change ? s.sara.id : s.ahmad.id,
      units: "units" in change ? change.units : 10,
      requestId: "req-x",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REQUEST_ID_REUSED");
  });

  it("scopes requestIds per account", async () => {
    const a = await ahmadScenario();
    const b = await ahmadScenario();
    const resA = await consume(a.apiKey, { userId: a.ahmad.id, units: 5, requestId: "shared-id" });
    const resB = await consume(b.apiKey, { userId: b.ahmad.id, units: 7, requestId: "shared-id" });
    expect(resA.body).toMatchObject({ accepted: true, units: 5 });
    expect(resB.body).toMatchObject({ accepted: true, units: 7 });
    expect(resB.headers["idempotent-replayed"]).toBeUndefined();
  });
});

describe("POST /consumptions: access and validation", () => {
  it("requires an API key", async () => {
    const res = await request(app).post("/consumptions").send({ userId: crypto.randomUUID(), units: 1, requestId: "r" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for a user of another account and records nothing", async () => {
    const mine = await ahmadScenario();
    const other = await ahmadScenario();

    const res = await consume(mine.apiKey, { userId: other.ahmad.id, units: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
    expect(await usage(other.accountId, other.ahmad.id)).toEqual({ account: 0, user: 0 });
  });

  it.each([
    [{ units: 0 }, "units"],
    [{ units: -5 }, "units"],
    [{ units: 1.5 }, "units"],
    [{ units: "10" }, "units"],
    [{ units: 1, requestId: "" }, "requestId"],
    [{ units: 1, userId: "ahmad" }, "userId"],
  ])("rejects invalid input %j with 400", async (override, field) => {
    const s = await ahmadScenario();
    const res = await request(app)
      .post("/consumptions")
      .set("x-api-key", s.apiKey)
      .send({ userId: s.ahmad.id, requestId: "r-1", ...override });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((i: { path: string }) => i.path)).toContain(field);
  });
});
