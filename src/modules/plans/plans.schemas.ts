import { z } from "zod";
import { planScope } from "../../db/schema";

/** Upper bound for any unit amount; keeps values far inside JS safe integers. */
export const MAX_UNITS = 1_000_000_000_000;

const units = z.number().int().positive().max(MAX_UNITS);

export const planIdParamsSchema = z.object({ id: z.uuid() });

export const listPlansQuerySchema = z.object({
  scope: z.enum(planScope.enumValues).optional(),
});

export const createPlanSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(planScope.enumValues),
  monthlyLimit: units,
  maxUnitsPerRequest: units,
});

/**
 * Strict: unknown keys are rejected, so `{ "scope": "user" }` fails loudly
 * instead of being silently ignored. A plan's scope never changes.
 */
export const updatePlanSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    monthlyLimit: units.optional(),
    maxUnitsPerRequest: units.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Provide at least one field to update" });

export const assignPlanSchema = z.object({ planId: z.uuid() });

export type ListPlansQuery = z.output<typeof listPlansQuerySchema>;
export type CreatePlanInput = z.output<typeof createPlanSchema>;
export type UpdatePlanInput = z.output<typeof updatePlanSchema>;
