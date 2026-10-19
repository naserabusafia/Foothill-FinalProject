import { z } from "zod";
import { monthQuerySchema } from "../../shared/month";

export const usageQuerySchema = z.object({
  /** "YYYY-MM"; defaults to the current UTC month. */
  month: monthQuerySchema.optional(),
});

export type UsageQuery = z.output<typeof usageQuerySchema>;
