import { Router } from "express";
import { apiKeyAuth, getAccountId } from "../../middleware/apiKeyAuth";
import { validate } from "../../shared/validation";
import { consumeSchema } from "./consumptions.schemas";
import { consume } from "./consume.service";

/** Mounted at /consumptions. */
export const consumptionsRouter = Router();
consumptionsRouter.use(apiKeyAuth);

/**
 * Accepted and rejected are both decisions, so both return 200 with `accepted`.
 * A replayed requestId returns the original body plus `Idempotent-Replayed: true`.
 */
consumptionsRouter.post("/", async (req, res) => {
  const input = validate(consumeSchema, req.body ?? {});
  const { response, replayed } = await consume(getAccountId(req), input);
  if (replayed) res.setHeader("Idempotent-Replayed", "true");
  res.json(response);
});
