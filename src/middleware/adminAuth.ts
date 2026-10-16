import type { RequestHandler } from "express";
import { config } from "../config";
import { secretsEqual } from "../shared/apiKey";
import { UnauthorizedError } from "../shared/errors";

export const ADMIN_KEY_HEADER = "x-admin-key";

/**
 * Guards operator-only routes (account creation) with the ADMIN_API_KEY
 * from the environment. Compared in constant time.
 */
export const adminAuth: RequestHandler = (req, _res, next) => {
  const key = req.get(ADMIN_KEY_HEADER);
  if (!key) {
    throw new UnauthorizedError("MISSING_ADMIN_KEY", `Missing ${ADMIN_KEY_HEADER} header`);
  }
  if (!secretsEqual(key, config.ADMIN_API_KEY)) {
    throw new UnauthorizedError("INVALID_ADMIN_KEY", "Invalid admin key");
  }
  next();
};
