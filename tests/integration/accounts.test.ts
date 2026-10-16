import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { PREDEFINED_PLAN_IDS } from "../../src/db/seed";
import { resetDb } from "../helpers/db";
import { createTestAccount, createTestPlan } from "../helpers/factories";
import { TEST_ADMIN_KEY } from "../setup/env";

const app = createApp();
const asAdmin = () => request(app).post("/accounts").set("x-admin-key", TEST_ADMIN_KEY);

beforeEach(resetDb);

describe("POST /accounts", () => {
  it("creates an account on the Starter plan by default and returns its API key once", async () => {
    const res = await asAdmin().send({ name: "Acme Docs" });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^uq_/);
    expect(res.body.account).toMatchObject({
      name: "Acme Docs",
      plan: {
        id: PREDEFINED_PLAN_IDS.starter,
        name: "Starter",
        scope: "account",
        monthlyLimit: 10_000,
        maxUnitsPerRequest: 100,
        predefined: true,
      },
    });
  });

  it("returns a key that works immediately", async () => {
    const created = await asAdmin().send({ name: "Acme" });
    const res = await request(app).get("/account").set("x-api-key", created.body.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.account.id);
  });

  it("accepts another predefined account plan", async () => {
    const res = await asAdmin().send({ name: "Big Co", planId: PREDEFINED_PLAN_IDS.pro });
    expect(res.status).toBe(201);
    expect(res.body.account.plan.name).toBe("Pro");
  });

  it("trims the name", async () => {
    const res = await asAdmin().send({ name: "   Acme   " });
    expect(res.body.account.name).toBe("Acme");
  });

  it("rejects a user plan for an account", async () => {
    const res = await asAdmin().send({ name: "Acme", planId: PREDEFINED_PLAN_IDS.basic });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLAN_SCOPE_MISMATCH");
  });

  it("rejects an unknown plan", async () => {
    const res = await asAdmin().send({ name: "Acme", planId: "11111111-1111-4111-8111-111111111111" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLAN_NOT_FOUND");
  });

  it("does not reveal or allow another account's custom plan", async () => {
    const { account: owner } = await createTestAccount();
    const custom = await createTestPlan({ scope: "account", ownerAccountId: owner.id });

    const res = await asAdmin().send({ name: "Intruder", planId: custom.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLAN_NOT_FOUND");
  });

  it.each([
    [{}, "name"],
    [{ name: "" }, "name"],
    [{ name: "x".repeat(201) }, "name"],
    [{ name: "Acme", planId: "not-a-uuid" }, "planId"],
  ])("rejects invalid input %j", async (body, field) => {
    const res = await asAdmin().send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((issue: { path: string }) => issue.path)).toContain(field);
  });

  it("rejects a request with no body at all", async () => {
    const res = await request(app).post("/accounts").set("x-admin-key", TEST_ADMIN_KEY);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /account", () => {
  it("returns the calling account with the plan applied to it", async () => {
    const { account, apiKey } = await createTestAccount({ name: "Acme", planId: PREDEFINED_PLAN_IDS.pro });

    const res = await request(app).get("/account").set("x-api-key", apiKey);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: account.id,
      name: "Acme",
      plan: {
        id: PREDEFINED_PLAN_IDS.pro,
        name: "Pro",
        scope: "account",
        monthlyLimit: 100_000,
        maxUnitsPerRequest: 1_000,
        predefined: true,
      },
      createdAt: expect.any(String),
    });
  });

  it("keeps accounts isolated: each key sees only its own account", async () => {
    const a = await createTestAccount({ name: "A" });
    const b = await createTestAccount({ name: "B" });

    const resA = await request(app).get("/account").set("x-api-key", a.apiKey);
    const resB = await request(app).get("/account").set("x-api-key", b.apiKey);

    expect(resA.body.id).toBe(a.account.id);
    expect(resB.body.id).toBe(b.account.id);
    expect(resA.body.id).not.toBe(resB.body.id);
  });
});
