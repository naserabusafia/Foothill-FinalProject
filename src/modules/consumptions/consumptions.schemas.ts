import { z } from "zod";
import { monthQuerySchema } from "../../shared/month";
import { pageQuerySchema } from "../../shared/pagination";
import { MAX_UNITS } from "../plans/plans.schemas";

export const consumeSchema = z.object({
  userId: z.uuid(),
  units: z.number().int().positive().max(MAX_UNITS),
  /** Caller-chosen idempotency key: reuse it when retrying the same operation. */
  requestId: z.string().trim().min(1).max(255),
});

export type ConsumeInput = z.output<typeof consumeSchema>;

/** ?limit=&cursor=&userId=&status=accepted|rejected&month=YYYY-MM */
export const listConsumptionsQuerySchema = pageQuerySchema.extend({
  userId: z.uuid().optional(),
  status: z.enum(["accepted", "rejected"]).optional(),
  month: monthQuerySchema.optional(),
});

export type ListConsumptionsQuery = z.output<typeof listConsumptionsQuerySchema>;
