/**
 * PostgreSQL SQLSTATE codes the service reacts to.
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const PgErrorCode = {
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  checkViolation: "23514",
  deadlockDetected: "40P01",
  lockNotAvailable: "55P03",
  queryCanceled: "57014",
} as const;

export interface PgErrorInfo {
  code: string;
  constraint?: string;
}

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Finds the Postgres error behind `err`, if any. Drizzle wraps driver errors
 * (the original is on `.cause`), so the cause chain is walked.
 */
export function getPgError(err: unknown): PgErrorInfo | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && SQLSTATE.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === "string" ? candidate.constraint : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

/** True when the database could not be reached or no pool connection became free in time. */
export function isDbConnectionError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT") return true;
    // Thrown by pg.Pool when connectionTimeoutMillis elapses.
    if (current.message.includes("timeout exceeded when trying to connect")) return true;
    current = current.cause;
  }
  return false;
}
