import { z } from "zod";
import { MAX_UNITS } from "../plans/plans.schemas";

export const consumeSchema = z.object({
  userId: z.uuid(),
  units: z.number().int().positive().max(MAX_UNITS),
  /** Caller-chosen idempotency key: reuse it when retrying the same operation. */
  requestId: z.string().trim().min(1).max(255),
});

export type ConsumeInput = z.output<typeof consumeSchema>;
