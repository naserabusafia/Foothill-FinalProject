import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { resetDb } from "../helpers/db";
import { createScenario } from "../helpers/factories";

const app = createApp();
let n = 0;

beforeEach(async () => {
  await resetDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

const get = (apiKey: string, path: string) => request(app).get(path).set("x-api-key", apiKey);
const consume = (apiKey: string, userId: string, units: number, requestId = `h-${++n}`) =>
  request(app).post("/consumptions").set("x-api-key", apiKey).send({ userId, units, requestId });

async function scenario() {
  const s = await createScenario({
    account: { monthlyLimit: 1_000, maxUnitsPerRequest: 50 },
    users: [
      { monthlyLimit: 100, maxUnitsPerRequest: 20 },
      { monthlyLimit: 200, maxUnitsPerRequest: 30 },
    ],
  });
  return { ...s, ahmad: s.users[0]!, sara: s.users[1]! };
}

describe("GET /account/usage and /users/:id/usage", () => {
  it("shows the current month's usage, the plan applied now, and what remains", async () => {
    const s = await scenario();
    await consume(s.apiKey, s.ahmad.id, 20);
    await consume(s.apiKey, s.sara.id, 30);

    const account = await get(s.apiKey, "/account/usage");
    expect(account.status).toBe(200);
    expect(account.body).toMatchObject({
      month: "2026-10",
      used: 50,
      remaining: 950,
      plan: { id: s.accountPlanId, monthlyLimit: 1_000, maxUnitsPerRequest: 50 },
    });

    const ahmad = await get(s.apiKey, `/users/${s.ahmad.id}/usage`);
    expect(ahmad.body).toMatchObject({ month: "2026-10", used: 20, remaining: 80, plan: { id: s.ahmad.planId } });
  });

  it("returns zero for a month without any consumption", async () => {
    const s = await scenario();
    const res = await get(s.apiKey, `/users/${s.ahmad.id}/usage`);
    expect(res.body).toMatchObject({ used: 0, remaining: 100 });
  });

  it("does not count rejected requests", async () => {
    const s = await scenario();
    await consume(s.apiKey, s.ahmad.id, 25);
    const res = await get(s.apiKey, `/users/${s.ahmad.id}/usage`);
    expect(res.body.used).toBe(0);
  });

  it("shows only `used` for a past month: its limits may have differed", async () => {
    const s = await scenario();
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    await consume(s.apiKey, s.ahmad.id, 15);
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));

    const past = await get(s.apiKey, `/users/${s.ahmad.id}/usage?month=2026-09`);
    expect(past.body).toEqual({ month: "2026-09", used: 15, plan: null, remaining: null });

    const current = await get(s.apiKey, `/users/${s.ahmad.id}/usage`);
    expect(current.body).toMatchObject({ month: "2026-10", used: 0, remaining: 100 });
  });

  it("shows 0 remaining when the limit was lowered below usage", async () => {
    const s = await scenario();
    for (let i = 0; i < 4; i++) await consume(s.apiKey, s.ahmad.id, 20);
    await request(app).patch(`/plans/${s.ahmad.planId}`).set("x-api-key", s.apiKey).send({ monthlyLimit: 50 });

    const res = await get(s.apiKey, `/users/${s.ahmad.id}/usage`);
    expect(res.body).toMatchObject({ used: 80, remaining: 0, plan: { monthlyLimit: 50 } });
  });

  it.each(["2026-11", "2026-13", "2026-1", "october"])("rejects ?month=%s", async (month) => {
    const s = await scenario();
    const res = await get(s.apiKey, `/account/usage?month=${month}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("month");
  });

  it("returns 404 for another account's user", async () => {
    const mine = await scenario();
    const other = await scenario();
    const res = await get(mine.apiKey, `/users/${other.ahmad.id}/usage`);
    expect(res.status).toBe(404);
  });

  it("requires an API key", async () => {
    expect((await request(app).get("/account/usage")).status).toBe(401);
  });
});

describe("GET /consumptions", () => {
  it("lists accepted and rejected decisions, newest first, in the same shape as POST", async () => {
    const s = await scenario();
    const accepted = await consume(s.apiKey, s.ahmad.id, 10, "first");
    const rejected = await consume(s.apiKey, s.ahmad.id, 25, "second");

    const res = await get(s.apiKey, "/consumptions");
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([rejected.body, accepted.body]);
    expect(res.body.items[0].rejection).toMatchObject({ rule: "max_units_per_request", scope: "user" });
    expect(res.body.nextCursor).toBeNull();
  });

  it("filters by user, status and month", async () => {
    const s = await scenario();
    vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
    await consume(s.apiKey, s.ahmad.id, 5, "sep");
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    await consume(s.apiKey, s.ahmad.id, 10, "oct-ok");
    await consume(s.apiKey, s.ahmad.id, 25, "oct-rejected");
    await consume(s.apiKey, s.sara.id, 10, "sara");

    const ids = async (qs: string) =>
      (await get(s.apiKey, `/consumptions?${qs}`)).body.items.map((i: { requestId: string }) => i.requestId);

    expect(await ids(`userId=${s.sara.id}`)).toEqual(["sara"]);
    expect(await ids("status=rejected")).toEqual(["oct-rejected"]);
    expect(await ids("month=2026-09")).toEqual(["sep"]);
    expect(await ids(`userId=${s.ahmad.id}&status=accepted&month=2026-10`)).toEqual(["oct-ok"]);
  });

  it("pages through the log without repeats", async () => {
    const s = await scenario();
    for (let i = 0; i < 5; i++) await consume(s.apiKey, s.ahmad.id, 1, `p-${i}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await get(s.apiKey, `/consumptions?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.items.map((i: { requestId: string }) => i.requestId));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(seen).toEqual(["p-4", "p-3", "p-2", "p-1", "p-0"]);
  });

  it("never shows another account's requests", async () => {
    const mine = await scenario();
    const other = await scenario();
    await consume(other.apiKey, other.ahmad.id, 5, "theirs");

    const res = await get(mine.apiKey, "/consumptions");
    expect(res.body.items).toEqual([]);
    const filtered = await get(mine.apiKey, `/consumptions?userId=${other.ahmad.id}`);
    expect(filtered.body.items).toEqual([]);
  });

  it.each(["status=pending", "status=maybe", "userId=ahmad", "month=2026-1", "limit=0"])("rejects ?%s", async (qs) => {
    const s = await scenario();
    const res = await get(s.apiKey, `/consumptions?${qs}`);
    expect(res.status).toBe(400);
  });
});
