import { Router } from "express";
import { adminAuth } from "../../middleware/adminAuth";
import { apiKeyAuth, getAccountId } from "../../middleware/apiKeyAuth";
import { validate } from "../../shared/validation";
import { createAccountSchema } from "./accounts.schemas";
import { createAccount, getAccountOrThrow } from "./accounts.service";

export const accountsRouter = Router();

/** Operator-only: creates an account and returns its API key (shown once). */
accountsRouter.post("/accounts", adminAuth, async (req, res) => {
  const input = validate(createAccountSchema, req.body ?? {});
  const result = await createAccount(input);
  res.status(201).json(result);
});

/** The calling account and the plan currently applied to it. */
accountsRouter.get("/account", apiKeyAuth, async (req, res) => {
  const account = await getAccountOrThrow(getAccountId(req));
  res.json(account);
});
