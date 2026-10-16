import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { getPgError, isDbConnectionError, PgErrorCode } from "../db/errors";
import { AppError, NotFoundError, ServiceUnavailableError } from "../shared/errors";
import { toValidationIssues } from "../shared/validation";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

function send(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ErrorBody = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  res.status(status).json(body);
}

/** Errors raised by express.json() carry a `type` and an HTTP `status`. */
function asBodyParserError(err: unknown): { type: string; status: number } | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const { type, status } = err as { type?: unknown; status?: unknown };
  return typeof type === "string" && typeof status === "number" ? { type, status } : undefined;
}

/** Maps transient database failures to a retryable 503. */
function asTransientDbError(err: unknown): ServiceUnavailableError | undefined {
  const pg = getPgError(err);
  if (pg?.code === PgErrorCode.lockNotAvailable) {
    return new ServiceUnavailableError("LOCK_TIMEOUT", "Too many concurrent requests for this account, retry later");
  }
  if (pg?.code === PgErrorCode.deadlockDetected || pg?.code === PgErrorCode.queryCanceled) {
    return new ServiceUnavailableError("DATABASE_BUSY", "Database is busy, retry later");
  }
  if (isDbConnectionError(err)) {
    return new ServiceUnavailableError("DATABASE_UNAVAILABLE", "Database is unavailable, retry later");
  }
  return undefined;
}

/** Catch-all for unmatched routes. Mount after every router. */
export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError("ROUTE_NOT_FOUND", `Route ${req.method} ${req.path} not found`);
};

/**
 * Single place that turns errors into HTTP responses. Mount last.
 * Express 5 forwards rejected promises from async handlers here automatically.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = err instanceof AppError ? err : asTransientDbError(err);
  if (appError) {
    if (appError instanceof ServiceUnavailableError) {
      res.setHeader("Retry-After", String(appError.retryAfterSeconds));
      console.warn(`${req.method} ${req.originalUrl} -> 503 ${appError.code}`);
    }
    send(res, appError.status, appError.code, appError.message, appError.details);
    return;
  }

  // A schema parsed outside validate() (e.g. inside a service).
  if (err instanceof ZodError) {
    send(res, 400, "VALIDATION_ERROR", "Request validation failed", toValidationIssues(err));
    return;
  }

  const bodyError = asBodyParserError(err);
  if (bodyError?.type === "entity.parse.failed") {
    send(res, 400, "INVALID_JSON", "Request body is not valid JSON");
    return;
  }
  if (bodyError?.type === "entity.too.large") {
    send(res, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    return;
  }
  if (bodyError && bodyError.status >= 400 && bodyError.status < 500) {
    send(res, bodyError.status, "BAD_REQUEST", "Request body could not be read");
    return;
  }

  // Unexpected: log everything, reveal nothing.
  console.error(`${req.method} ${req.originalUrl} -> 500`, err);
  send(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
};
