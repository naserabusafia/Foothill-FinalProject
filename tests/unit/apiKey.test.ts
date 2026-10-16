import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, secretsEqual } from "../../src/shared/apiKey";

describe("generateApiKey", () => {
  it("produces a prefixed, URL-safe key with 256 bits of randomness", () => {
    const { key } = generateApiKey();
    expect(key).toMatch(/^uq_[A-Za-z0-9_-]{43}$/);
  });

  it("returns the SHA-256 hex of the key and a 12-character display prefix", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(hash).toBe(hashApiKey(key));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(key.slice(0, 12));
  });

  it("never repeats", () => {
    const keys = new Set(Array.from({ length: 1_000 }, () => generateApiKey().key));
    expect(keys.size).toBe(1_000);
  });
});

describe("hashApiKey", () => {
  it("is deterministic, so a key can be looked up by its hash", () => {
    expect(hashApiKey("uq_example")).toBe(hashApiKey("uq_example"));
    expect(hashApiKey("uq_example")).not.toBe(hashApiKey("uq_example2"));
  });
});

describe("secretsEqual", () => {
  it("compares secrets of any length", () => {
    expect(secretsEqual("admin-key", "admin-key")).toBe(true);
    expect(secretsEqual("admin-key", "admin-kez")).toBe(false);
    expect(secretsEqual("short", "a-much-longer-secret")).toBe(false);
    expect(secretsEqual("", "x")).toBe(false);
  });
});
