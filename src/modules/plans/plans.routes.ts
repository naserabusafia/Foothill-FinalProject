import { Router } from "express";
import { apiKeyAuth, getAccountId } from "../../middleware/apiKeyAuth";
import { validate } from "../../shared/validation";
import { createPlanSchema, listPlansQuerySchema, planIdParamsSchema, updatePlanSchema } from "./plans.schemas";
import { createPlan, getPlanOrThrow, listPlans, toPlanResponse, updatePlan } from "./plans.service";

/** Mounted at /plans. Every route needs an account API key. */
export const plansRouter = Router();
plansRouter.use(apiKeyAuth);

/** Predefined plans plus the account's own custom plans. Optional ?scope=account|user. */
plansRouter.get("/", async (req, res) => {
  const query = validate(listPlansQuerySchema, req.query);
  res.json({ items: await listPlans(getAccountId(req), query) });
});

plansRouter.get("/:id", async (req, res) => {
  const { id } = validate(planIdParamsSchema, req.params);
  res.json(toPlanResponse(await getPlanOrThrow(getAccountId(req), id)));
});

plansRouter.post("/", async (req, res) => {
  const input = validate(createPlanSchema, req.body ?? {});
  res.status(201).json(await createPlan(getAccountId(req), input));
});

/** Custom plans only; predefined plans are read-only (403). */
plansRouter.patch("/:id", async (req, res) => {
  const { id } = validate(planIdParamsSchema, req.params);
  const input = validate(updatePlanSchema, req.body ?? {});
  res.json(await updatePlan(getAccountId(req), id, input));
});
