import { z } from "zod";
import { PREDEFINED_PLAN_IDS } from "../../db/seed";

export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Defaults to the Starter plan. Only predefined account plans can be chosen here. */
  planId: z.uuid().default(PREDEFINED_PLAN_IDS.starter),
});

export type CreateAccountInput = z.output<typeof createAccountSchema>;
