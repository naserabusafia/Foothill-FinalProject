import type { Request, RequestHandler } from "express";
import { findAccountIdByApiKey } from "../modules/accounts/accounts.service";
import { UnauthorizedError } from "../shared/errors";

export const API_KEY_HEADER = "x-api-key";

/** Real keys are ~46 characters; anything far longer is rejected without hashing it. */
const MAX_KEY_LENGTH = 200;

/**
 * Identifies the calling account from the `x-api-key` header and sets
 * `req.accountId`. Every account-scoped route uses this, and every query
 * downstream is filtered by that id.
 */
export const apiKeyAuth: RequestHandler = async (req, _res, next) => {
  const key = req.get(API_KEY_HEADER);
  if (!key) {
    throw new UnauthorizedError("MISSING_API_KEY", `Missing ${API_KEY_HEADER} header`);
  }

  const accountId = key.length <= MAX_KEY_LENGTH ? await findAccountIdByApiKey(key) : null;
  if (!accountId) {
    // Same answer for unknown and revoked keys: the caller learns nothing about which.
    throw new UnauthorizedError("INVALID_API_KEY", "Invalid API key");
  }

  req.accountId = accountId;
  next();
};

/** The authenticated account id. Only valid on routes behind apiKeyAuth. */
export function getAccountId(req: Request): string {
  if (!req.accountId) {
    // Reaching this means a route forgot apiKeyAuth: a bug, so fail closed.
    throw new UnauthorizedError("MISSING_API_KEY", `Missing ${API_KEY_HEADER} header`);
  }
  return req.accountId;
}
