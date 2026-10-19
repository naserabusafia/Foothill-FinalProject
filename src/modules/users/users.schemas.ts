import { z } from "zod";
import { PREDEFINED_PLAN_IDS } from "../../db/seed";
import { pageQuerySchema } from "../../shared/pagination";

const externalId = z.string().trim().min(1).max(255);

export const userIdParamsSchema = z.object({ id: z.uuid() });

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** The caller's own identifier for this user; unique within the account. */
  externalId: externalId.optional(),
  /** Defaults to the predefined Basic user plan. */
  planId: z.uuid().default(PREDEFINED_PLAN_IDS.basic),
});

export const listUsersQuerySchema = pageQuerySchema.extend({
  externalId: externalId.optional(),
});

export type CreateUserInput = z.output<typeof createUserSchema>;
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;
