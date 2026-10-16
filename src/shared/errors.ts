/**
 * Errors the API returns on purpose. The error handler turns them into
 *   { "error": { "code": "...", "message": "...", "details"?: ... } }
 * Anything that is not an AppError is unexpected and becomes a 500.
 *
 * `code` is stable and machine-readable (clients branch on it);
 * `message` is for humans and may change.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ValidationIssue {
  /** Dot path of the offending field, e.g. "units" or "limits.monthly". Empty for the root. */
  path: string;
  message: string;
}

/** 400: input failed schema validation. */
export class ValidationError extends AppError {
  constructor(issues: ValidationIssue[], message = "Request validation failed") {
    super(400, "VALIDATION_ERROR", message, issues);
  }
}

/** 400: input is well-formed but not acceptable (e.g. a user plan assigned to an account). */
export class BadRequestError extends AppError {
  constructor(code = "BAD_REQUEST", message = "Bad request") {
    super(400, code, message);
  }
}

/** 401: missing or invalid credentials. */
export class UnauthorizedError extends AppError {
  constructor(code = "UNAUTHORIZED", message = "Missing or invalid credentials") {
    super(401, code, message);
  }
}

/** 403: authenticated, but the action is not allowed (e.g. editing a predefined plan). */
export class ForbiddenError extends AppError {
  constructor(code = "FORBIDDEN", message = "This action is not allowed") {
    super(403, code, message);
  }
}

/**
 * 404: not found. Also used for resources that belong to another account,
 * so callers cannot learn that they exist.
 */
export class NotFoundError extends AppError {
  constructor(code = "NOT_FOUND", message = "Resource not found") {
    super(404, code, message);
  }
}

/** 409: conflicts with existing state (e.g. a reused requestId with different data). */
export class ConflictError extends AppError {
  constructor(code = "CONFLICT", message = "Request conflicts with existing state", details?: unknown) {
    super(409, code, message, details);
  }
}

/** 503: temporary failure; safe to retry (with the same requestId for consumptions). */
export class ServiceUnavailableError extends AppError {
  constructor(
    code = "SERVICE_UNAVAILABLE",
    message = "Service temporarily unavailable, retry later",
    readonly retryAfterSeconds = 1,
  ) {
    super(503, code, message);
  }
}
