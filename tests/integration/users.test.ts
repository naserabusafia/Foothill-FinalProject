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

describe("POST /users", () => {
  it("requires an API key", async () => {
    const res = await request(app).post("/users").send({ name: "Ahmad" });
    expect(res.status).toBe(401);
  });

  it("creates a user on the Basic plan by default", async () => {
    const res = await as(apiKey).post("/users", { name: "Ahmad", externalId: "emp-1" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Ahmad",
      externalId: "emp-1",
      plan: { id: PREDEFINED_PLAN_IDS.basic, name: "Basic", monthlyLimit: 500, maxUnitsPerRequest: 50 },
    });
  });

  it("accepts another predefined user plan or the account's own custom user plan", async () => {
    const premium = await as(apiKey).post("/users", { name: "Sara", planId: PREDEFINED_PLAN_IDS.premium });
    expect(premium.body.plan.name).toBe("Premium");

    const custom = await createTestPlan({ name: "Interns", scope: "user", ownerAccountId: account.id });
    const res = await as(apiKey).post("/users", { name: "Omar", planId: custom.id });
    expect(res.status).toBe(201);
    expect(res.body.plan).toMatchObject({ name: "Interns", predefined: false });
  });

  it("rejects an account plan", async () => {
    const res = await as(apiKey).post("/users", { name: "Ahmad", planId: PREDEFINED_PLAN_IDS.starter });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLAN_SCOPE_MISMATCH");
  });

  it("rejects another account's custom plan as not found", async () => {
    const other = await createTestAccount();
    const theirs = await createTestPlan({ scope: "user", ownerAccountId: other.account.id });
    const res = await as(apiKey).post("/users", { name: "Ahmad", planId: theirs.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PLAN_NOT_FOUND");
  });

  it("rejects a duplicate externalId within the same account", async () => {
    await as(apiKey).post("/users", { name: "Ahmad", externalId: "emp-1" });
    const res = await as(apiKey).post("/users", { name: "Someone else", externalId: "emp-1" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EXTERNAL_ID_TAKEN");
  });

  it("allows the same externalId in different accounts", async () => {
    const other = await createTestAccount();
    const first = await as(apiKey).post("/users", { name: "Ahmad", externalId: "emp-1" });
    const second = await as(other.apiKey).post("/users", { name: "Ahmad", externalId: "emp-1" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("allows many users without an externalId", async () => {
    await as(apiKey).post("/users", { name: "A" });
    const res = await as(apiKey).post("/users", { name: "B" });
    expect(res.status).toBe(201);
    expect(res.body.externalId).toBeNull();
  });

  it.each([
    [{}, "name"],
    [{ name: "  " }, "name"],
    [{ name: "A", externalId: "" }, "externalId"],
    [{ name: "A", planId: "basic" }, "planId"],
  ])("rejects invalid input %j", async (body, field) => {
    const res = await as(apiKey).post("/users", body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((i: { path: string }) => i.path)).toContain(field);
  });
});

describe("GET /users/:id", () => {
  it("returns the user with the plan applied to them", async () => {
    const user = await createTestUser(account.id, { name: "Ahmad", planId: PREDEFINED_PLAN_IDS.premium });
    const res = await as(apiKey).get(`/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: user.id, name: "Ahmad", plan: { name: "Premium" } });
  });

  it("returns 404 for a user of another account", async () => {
    const other = await createTestAccount();
    const theirs = await createTestUser(other.account.id);
    const res = await as(apiKey).get(`/users/${theirs.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects a malformed id with 400", async () => {
    const res = await as(apiKey).get("/users/123");
    expect(res.status).toBe(400);
  });
});

describe("GET /users", () => {
  it("pages through every user exactly once, newest first", async () => {
    const created = [];
    for (let i = 0; i < 5; i++) created.push(await createTestUser(account.id, { name: `U${i}` }));

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await as(apiKey).get(`/users?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((u: { name: string }) => u.name));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(["U4", "U3", "U2", "U1", "U0"]);
  });

  it("returns nextCursor null when everything fits on one page", async () => {
    await createTestUser(account.id);
    const res = await as(apiKey).get("/users");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.nextCursor).toBeNull();
  });

  it("only lists the calling account's users", async () => {
    const other = await createTestAccount();
    await createTestUser(account.id, { name: "Mine" });
    await createTestUser(other.account.id, { name: "Theirs" });

    const res = await as(apiKey).get("/users");
    expect(res.body.items.map((u: { name: string }) => u.name)).toEqual(["Mine"]);
  });

  it("finds a user by externalId", async () => {
    await createTestUser(account.id, { name: "Ahmad", externalId: "emp-1" });
    await createTestUser(account.id, { name: "Sara", externalId: "emp-2" });

    const res = await as(apiKey).get("/users?externalId=emp-2");
    expect(res.body.items.map((u: { name: string }) => u.name)).toEqual(["Sara"]);
  });

  it.each(["limit=0", "limit=101", "limit=abc", "cursor=garbage"])("rejects ?%s", async (qs) => {
    const res = await as(apiKey).get(`/users?${qs}`);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /users/:id/plan", () => {
  it("moves the user to another user plan", async () => {
    const user = await createTestUser(account.id);
    const res = await as(apiKey).patch(`/users/${user.id}/plan`, { planId: PREDEFINED_PLAN_IDS.premium });
    expect(res.status).toBe(200);
    expect(res.body.plan.name).toBe("Premium");

    const fetched = await as(apiKey).get(`/users/${user.id}`);
    expect(fetched.body.plan.name).toBe("Premium");
  });

  it("rejects an account plan", async () => {
    const user = await createTestUser(account.id);
    const res = await as(apiKey).patch(`/users/${user.id}/plan`, { planId: PREDEFINED_PLAN_IDS.pro });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PLAN_SCOPE_MISMATCH");
  });

  it("returns 404 for a user of another account and leaves them unchanged", async () => {
    const other = await createTestAccount();
    const theirs = await createTestUser(other.account.id);

    const res = await as(apiKey).patch(`/users/${theirs.id}/plan`, { planId: PREDEFINED_PLAN_IDS.premium });
    expect(res.status).toBe(404);

    const unchanged = await as(other.apiKey).get(`/users/${theirs.id}`);
    expect(unchanged.body.plan.name).toBe("Basic");
  });
});
