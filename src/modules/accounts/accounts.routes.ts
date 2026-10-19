import { Router } from "express";
import { adminAuth } from "../../middleware/adminAuth";
import { apiKeyAuth, getAccountId } from "../../middleware/apiKeyAuth";
import { validate } from "../../shared/validation";
import { assignPlanSchema } from "../plans/plans.schemas";
import { createAccountSchema } from "./accounts.schemas";
import { changeAccountPlan, createAccount, getAccountOrThrow } from "./accounts.service";

/**
 * Mounted at the root because it serves two prefixes (/accounts and /account),
 * so auth is attached per route rather than with router.use().
 */
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

/** Switches the calling account to another account plan. Usage is kept. */
accountsRouter.patch("/account/plan", apiKeyAuth, async (req, res) => {
  const { planId } = validate(assignPlanSchema, req.body ?? {});
  res.json(await changeAccountPlan(getAccountId(req), planId));
});
