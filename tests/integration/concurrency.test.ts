import type { Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { resetDb } from "../helpers/db";
import { createScenario } from "../helpers/factories";
import { expectUsageInvariants } from "../helpers/invariants";

/**
 * Many requests at the same moment. One real HTTP server so requests overlap
 * inside the database exactly as they would in production.
 */
let server: Server;

beforeAll(() => {
  server = createApp().listen(0);
});
afterAll(() => {
  server.close();
});
beforeEach(resetDb);

function consume(apiKey: string, body: { userId: string; units: number; requestId: string }) {
  return request(server).post("/consumptions").set("x-api-key", apiKey).send(body);
}

const roomyUser = { monthlyLimit: 100_000, maxUnitsPerRequest: 100 };

describe("concurrent consumption", () => {
  it("accepts exactly 100 of 200 simultaneous 1-unit requests against an account limit of 100", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 100, maxUnitsPerRequest: 10 },
      users: [roomyUser, roomyUser, roomyUser, roomyUser],
    });

    const responses = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        consume(s.apiKey, { userId: s.users[i % 4]!.id, units: 1, requestId: `burst-${i}` }),
      ),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    const accepted = responses.filter((r) => r.body.accepted);
    const rejected = responses.filter((r) => !r.body.accepted);
    expect(accepted).toHaveLength(100);
    expect(rejected).toHaveLength(100);
    expect(rejected.every((r) => r.body.rejection.rule === "monthly_limit" && r.body.rejection.scope === "account")).toBe(true);

    const account = await request(server).get("/account").set("x-api-key", s.apiKey);
    expect(account.status).toBe(200);
    await expectUsageInvariants();
  });

  it("enforces a user's limit under concurrency too", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 10_000, maxUnitsPerRequest: 100 },
      users: [{ monthlyLimit: 50, maxUnitsPerRequest: 5 }],
    });

    const responses = await Promise.all(
      Array.from({ length: 100 }, (_, i) => consume(s.apiKey, { userId: s.users[0]!.id, units: 1, requestId: `u-${i}` })),
    );

    expect(responses.filter((r) => r.body.accepted)).toHaveLength(50);
    expect(responses.filter((r) => !r.body.accepted).every((r) => r.body.rejection.scope === "user")).toBe(true);
    await expectUsageInvariants();
  });

  it("counts the same requestId sent 20 times at once exactly once", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 1_000, maxUnitsPerRequest: 100 },
      users: [roomyUser],
    });
    const body = { userId: s.users[0]!.id, units: 7, requestId: "same-request" };

    const responses = await Promise.all(Array.from({ length: 20 }, () => consume(s.apiKey, body)));

    expect(responses.every((r) => r.status === 200 && r.body.accepted)).toBe(true);
    const original = responses.filter((r) => r.headers["idempotent-replayed"] === undefined);
    expect(original).toHaveLength(1);
    expect(responses.every((r) => JSON.stringify(r.body) === JSON.stringify(original[0]!.body))).toBe(true);

    const next = await consume(s.apiKey, { ...body, requestId: "after" });
    expect(next.body.account.used).toBe(14);
    await expectUsageInvariants();
  });

  it("decides every request under one complete version of the plan while the plan is being edited", async () => {
    const s = await createScenario({
      account: { monthlyLimit: 1_000, maxUnitsPerRequest: 100 },
      users: [roomyUser, roomyUser],
    });

    const consumptions = Array.from({ length: 100 }, (_, i) =>
      consume(s.apiKey, { userId: s.users[i % 2]!.id, units: 5, requestId: `edit-${i}` }),
    );
    const edit = request(server)
      .patch(`/plans/${s.accountPlanId}`)
      .set("x-api-key", s.apiKey)
      .send({ monthlyLimit: 200, maxUnitsPerRequest: 50 });

    const [editRes, ...responses] = await Promise.all([edit, ...consumptions]);
    expect(editRes.status).toBe(200);

    // Each decision saw either the old plan or the new one, never a mix of the two.
    for (const r of responses) {
      expect(["1000/100", "200/50"]).toContain(`${r.body.account.monthlyLimit}/${r.body.account.maxUnitsPerRequest}`);
    }

    // Once the edit has committed, every new request is decided under the new limit.
    const after = await consume(s.apiKey, { userId: s.users[0]!.id, units: 5, requestId: "after-edit" });
    expect(after.body.account.monthlyLimit).toBe(200);
    if (after.body.accepted) {
      expect(after.body.account.used).toBeLessThanOrEqual(200);
    } else {
      expect(after.body.account.used + 5).toBeGreaterThan(200);
    }
    await expectUsageInvariants();
  });
});
