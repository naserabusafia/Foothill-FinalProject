import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_PREFIX = "uq_";
/** Stored in api_keys.key_prefix (varchar(12)) so a key can be recognised without storing it. */
const DISPLAY_PREFIX_LENGTH = 12;

export interface GeneratedApiKey {
  /** Returned to the caller exactly once; never stored. */
  key: string;
  /** SHA-256 hex digest; this is what the database stores and looks up. */
  hash: string;
  /** First characters of the key, safe to show (e.g. "uq_Xk3f9aQ2m"). */
  prefix: string;
}

/** 32 random bytes (256 bits): far too many to guess, so a fast hash is enough. */
export function generateApiKey(): GeneratedApiKey {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, hash: hashApiKey(key), prefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/**
 * SHA-256 rather than bcrypt: keys are random and long, so slow hashing adds
 * nothing, and a deterministic hash lets us find the key with an index lookup.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Compares two secrets in constant time. Both sides are hashed first so the
 * buffers have equal length and the comparison leaks neither content nor length.
 */
export function secretsEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
