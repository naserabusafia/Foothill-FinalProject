import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/app";
import { errorHandler, notFoundHandler } from "../../src/middleware/errorHandler";
import { ConflictError, NotFoundError, ServiceUnavailableError } from "../../src/shared/errors";
import { validate } from "../../src/shared/validation";

/** A throwaway app with routes that fail in every way the handler must cover. */
function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1kb" }));

  app.get("/not-found", () => {
    throw new NotFoundError("USER_NOT_FOUND", "User not found");
  });
  app.get("/conflict", () => {
    throw new ConflictError("REQUEST_ID_REUSED", "requestId was used with different data", { requestId: "r-1" });
  });
  app.get("/async-failure", async () => {
    await Promise.resolve();
    throw new NotFoundError();
  });
  app.post("/validate", (req, res) => {
    const input = validate(z.object({ units: z.number().int().positive(), requestId: z.string().min(1) }), req.body);
    res.json(input);
  });
  app.get("/zod-outside-validate", () => {
    z.object({ id: z.uuid() }).parse({ id: "nope" });
  });
  app.get("/lock-timeout", () => {
    // Shape of a Drizzle error wrapping the pg driver error.
    throw new Error("Failed query", { cause: Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }) });
  });
  app.get("/pool-timeout", () => {
    throw new Error("timeout exceeded when trying to connect");
  });
  app.get("/custom-503", () => {
    throw new ServiceUnavailableError("MAINTENANCE", "Back soon", 30);
  });
  app.get("/unexpected", () => {
    throw new Error("secret internal detail");
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("errorHandler", () => {
  const app = buildApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the status, code and message of an AppError", async () => {
    const res = await request(app).get("/not-found");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  });

  it("includes details when the AppError has them", async () => {
    const res = await request(app).get("/conflict");
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({
      code: "REQUEST_ID_REUSED",
      message: "requestId was used with different data",
      details: { requestId: "r-1" },
    });
  });

  it("handles errors thrown from async handlers (Express 5)", async () => {
    const res = await request(app).get("/async-failure");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 with every validation issue", async () => {
    const res = await request(app).post("/validate").send({ units: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((issue: { path: string }) => issue.path).sort()).toEqual(["requestId", "units"]);
  });

  it("passes valid input through with its parsed value", async () => {
    const res = await request(app).post("/validate").send({ units: 10, requestId: "req-1", extra: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ units: 10, requestId: "req-1" });
  });

  it("maps a ZodError thrown outside validate() to 400", async () => {
    const res = await request(app).get("/zod-outside-validate");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details[0].path).toBe("id");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(app).post("/validate").set("content-type", "application/json").send('{"units": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it("returns 413 for an oversized body", async () => {
    const res = await request(app).post("/validate").send({ requestId: "x".repeat(2_000), units: 1 });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("maps a wrapped Postgres lock timeout to a retryable 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app).get("/lock-timeout");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.body.error.code).toBe("LOCK_TIMEOUT");
  });

  it("maps a pool connection timeout to 503", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app).get("/pool-timeout");
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("uses the Retry-After value of a ServiceUnavailableError", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await request(app).get("/custom-503");
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("30");
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app).get("/unexpected");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(log).toHaveBeenCalledOnce();
  });

  it("returns 404 ROUTE_NOT_FOUND for unknown routes", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toEqual({ code: "ROUTE_NOT_FOUND", message: "Route GET /nope not found" });
  });
});

describe("createApp", () => {
  const app = createApp();

  it("serves the health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("is wired to the error handler", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("does not advertise Express", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
