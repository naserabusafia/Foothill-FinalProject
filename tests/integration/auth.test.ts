import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { db } from "../../src/db/client";
import { apiKeys } from "../../src/db/schema";
import { resetDb } from "../helpers/db";
import { createTestAccount } from "../helpers/factories";
import { TEST_ADMIN_KEY } from "../setup/env";

const app = createApp();

beforeEach(resetDb);

describe("apiKeyAuth (x-api-key)", () => {
  it("rejects a request without a key", async () => {
    const res = await request(app).get("/account");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_API_KEY");
  });

  it("rejects an unknown key", async () => {
    const res = await request(app).get("/account").set("x-api-key", "uq_this-key-does-not-exist");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_API_KEY");
  });

  it("rejects an absurdly long key without looking it up", async () => {
    const res = await request(app).get("/account").set("x-api-key", "x".repeat(5_000));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_API_KEY");
  });

  it("rejects a revoked key with the same answer as an unknown one", async () => {
    const { account, apiKey } = await createTestAccount();
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.accountId, account.id));

    const res = await request(app).get("/account").set("x-api-key", apiKey);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_API_KEY");
  });

  it("accepts a valid key and resolves the right account", async () => {
    const { account, apiKey } = await createTestAccount();
    const res = await request(app).get("/account").set("x-api-key", apiKey);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(account.id);
  });

  it("stores only the hash of the key, never the key itself", async () => {
    const { account, apiKey } = await createTestAccount();
    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.accountId, account.id));
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.keyHash).not.toContain(apiKey);
    expect(apiKey.startsWith(stored?.keyPrefix ?? "?")).toBe(true);
  });
});

describe("adminAuth (x-admin-key)", () => {
  it("rejects account creation without the admin key", async () => {
    const res = await request(app).post("/accounts").send({ name: "Acme" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("MISSING_ADMIN_KEY");
  });

  it("rejects a wrong admin key", async () => {
    const res = await request(app).post("/accounts").set("x-admin-key", "wrong-admin-key").send({ name: "Acme" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_ADMIN_KEY");
  });

  it("does not accept an account API key as the admin key", async () => {
    const { apiKey } = await createTestAccount();
    const res = await request(app).post("/accounts").set("x-admin-key", apiKey).send({ name: "Acme" });
    expect(res.status).toBe(401);
  });

  it("accepts the configured admin key", async () => {
    const res = await request(app).post("/accounts").set("x-admin-key", TEST_ADMIN_KEY).send({ name: "Acme" });
    expect(res.status).toBe(201);
  });
});
