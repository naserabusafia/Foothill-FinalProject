import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { PREDEFINED_PLAN_IDS } from "../../src/db/seed";
import { resetDb } from "../helpers/db";
import { createTestAccount, createTestPlan, createTestUser } from "../helpers/factories";

const app = createApp();

let account: { id: string };
let apiKey: string;

beforeEach(async () => {
  await resetDb();
  ({ account, apiKey } = await createTestAccount());
});

const as = (key: string) => ({
  get: (path: string) => request(app).get(path).set("x-api-key", key),
  post: (path: string, body: object) => request(app).post(path).set("x-api-key", key).send(body),
  patch: (path: string, body: object) => request(app).patch(path).set("x-api-key", key).send(body),
});

describe("GET /plans", () => {
  it("requires an API key", async () => {
    const res = await request(app).get("/plans");
    expect(res.status).toBe(401);
  });

  it("lists the four predefined plans for a new account", async () => {
    const res = await as(apiKey).get("/plans");
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: { name: string }) => p.name).sort()).toEqual(["Basic", "Premium", "Pro", "Starter"]);
    expect(res.body.items.every((p: { predefined: boolean }) => p.predefined)).toBe(true);
  });

  it("includes the account's own custom plans after the predefined ones, but never another account's", async () => {
    const other = await createTestAccount();
    await createTestPlan({ name: "Mine", scope: "user", ownerAccountId: account.id });
    await createTestPlan({ name: "Theirs", scope: "user", ownerAccountId: other.account.id });

    const res = await as(apiKey).get("/plans");
    const names = res.body.items.map((p: { name: string }) => p.name);
    expect(names).toContain("Mine");
    expect(names).not.toContain("Theirs");
    expect(names.at(-1)).toBe("Mine");
  });

  it("filters by scope", async () => {
    const res = await as(apiKey).get("/plans?scope=user");
    expect(res.body.items.map((p: { name: string }) => p.name).sort()).toEqual(["Basic", "Premium"]);
  });

  it("rejects an unknown scope", async () => {
    const res = await as(apiKey).get("/plans?scope=team");
    expect(res.status).toBe(400);
  });
});

describe("GET /plans/:id", () => {
  it("returns a predefined plan", async () => {
    const res = await as(apiKey).get(`/plans/${PREDEFINED_PLAN_IDS.premium}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: PREDEFINED_PLAN_IDS.premium,
      name: "Premium",
      scope: "user",
      monthlyLimit: 5_000,
      maxUnitsPerRequest: 200,
      predefined: true,
    });
  });

  it("returns 404 for another account's custom plan", async () => {
    const other = await createTestAccount();
    const theirs = await createTestPlan({ scope: "user", ownerAccountId: other.account.id });

    const res = await as(apiKey).get(`/plans/${theirs.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLAN_NOT_FOUND");
  });

  it("rejects a malformed id with 400", async () => {
    const res = await as(apiKey).get("/plans/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /plans", () => {
  it("creates a custom plan owned by the account", async () => {
    const res = await as(apiKey).post("/plans", { name: "Team Gold", scope: "user", monthlyLimit: 800, maxUnitsPerRequest: 40 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Team Gold", scope: "user", monthlyLimit: 800, maxUnitsPerRequest: 40, predefined: false });

    const fetched = await as(apiKey).get(`/plans/${res.body.id}`);
    expect(fetched.status).toBe(200);
  });

  it("rejects a per-request limit above the monthly limit", async () => {
    const res = await as(apiKey).post("/plans", { name: "Odd", scope: "user", monthlyLimit: 100, maxUnitsPerRequest: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("maxUnitsPerRequest");
  });

  it.each([
    [{ scope: "user", monthlyLimit: 10, maxUnitsPerRequest: 1 }, "name"],
    [{ name: "X", scope: "team", monthlyLimit: 10, maxUnitsPerRequest: 1 }, "scope"],
    [{ name: "X", scope: "user", monthlyLimit: 0, maxUnitsPerRequest: 1 }, "monthlyLimit"],
    [{ name: "X", scope: "user", monthlyLimit: 10.5, maxUnitsPerRequest: 1 }, "monthlyLimit"],
    [{ name: "X", scope: "user", monthlyLimit: 10, maxUnitsPerRequest: -1 }, "maxUnitsPerRequest"],
    [{ name: "X", scope: "user", monthlyLimit: "10", maxUnitsPerRequest: 1 }, "monthlyLimit"],
  ])("rejects invalid input %j", async (body, field) => {
    const res = await as(apiKey).post("/plans", body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((i: { path: string }) => i.path)).toContain(field);
  });
});

describe("PATCH /plans/:id", () => {
  it("updates a custom plan", async () => {
    const plan = await createTestPlan({ scope: "user", ownerAccountId: account.id, monthlyLimit: 100, maxUnitsPerRequest: 10 });

    const res = await as(apiKey).patch(`/plans/${plan.id}`, { name: "Renamed", monthlyLimit: 300 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Renamed", monthlyLimit: 300, maxUnitsPerRequest: 10 });
  });

  it("checks consistency against the stored value of the field that was not sent", async () => {
    const plan = await createTestPlan({ scope: "user", ownerAccountId: account.id, monthlyLimit: 100, maxUnitsPerRequest: 50 });

    const res = await as(apiKey).patch(`/plans/${plan.id}`, { monthlyLimit: 20 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe("maxUnitsPerRequest");
  });

  it("refuses to modify a predefined plan", async () => {
    const res = await as(apiKey).patch(`/plans/${PREDEFINED_PLAN_IDS.basic}`, { monthlyLimit: 999_999 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PREDEFINED_PLAN_READ_ONLY");
  });

  it("returns 404 for another account's plan and leaves it unchanged", async () => {
    const other = await createTestAccount();
    const theirs = await createTestPlan({ scope: "user", ownerAccountId: other.account.id, monthlyLimit: 100, maxUnitsPerRequest: 10 });

    const res = await as(apiKey).patch(`/plans/${theirs.id}`, { monthlyLimit: 1 });
    expect(res.status).toBe(404);

    const stillTheirs = await as(other.apiKey).get(`/plans/${theirs.id}`);
    expect(stillTheirs.body.monthlyLimit).toBe(100);
  });

  it("does not allow changing the scope", async () => {
    const plan = await createTestPlan({ scope: "user", ownerAccountId: account.id });
    const res = await as(apiKey).patch(`/plans/${plan.id}`, { scope: "account" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an empty update", async () => {
    const plan = await createTestPlan({ scope: "user", ownerAccountId: account.id });
    const res = await as(apiKey).patch(`/plans/${plan.id}`, {});
    expect(res.status).toBe(400);
  });

  it("applies immediately to every user sharing the plan", async () => {
    const plan = await createTestPlan({ scope: "user", ownerAccountId: account.id, monthlyLimit: 100, maxUnitsPerRequest: 10 });
    const ahmad = await createTestUser(account.id, { planId: plan.id });
    const sara = await createTestUser(account.id, { planId: plan.id });

    await as(apiKey).patch(`/plans/${plan.id}`, { monthlyLimit: 250 });

    for (const user of [ahmad, sara]) {
      const res = await as(apiKey).get(`/users/${user.id}`);
      expect(res.body.plan.monthlyLimit).toBe(250);
    }
  });
});

describe("PATCH /account/plan", () => {
  it("switches the account to another predefined account plan", async () => {
    const res = await as(apiKey).patch("/account/plan", { planId: PREDEFINED_PLAN_IDS.pro });
    expect(res.status).toBe(200);
    expect(res.body.plan.name).toBe("Pro");

    const current = await as(apiKey).get("/account");
    expect(current.body.plan.name).toBe("Pro");
  });

  it("accepts the account's own custom account plan", async () => {
    const custom = await createTestPlan({ name: "Enterprise", scope: "account", ownerAccountId: account.id });
    const res = await as(apiKey).patch("/account/plan", { planId: custom.id });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ name: "Enterprise", predefined: false });
  });

  it("rejects a user plan", async () => {
    const res = await as(apiKey).patch("/account/plan", { planId: PREDEFINED_PLAN_IDS.premium });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLAN_SCOPE_MISMATCH");
  });

  it("rejects another account's custom plan as not found", async () => {
    const other = await createTestAccount();
    const theirs = await createTestPlan({ scope: "account", ownerAccountId: other.account.id });
    const res = await as(apiKey).patch("/account/plan", { planId: theirs.id });
    expect(res.status).toBe(404);
  });
});
