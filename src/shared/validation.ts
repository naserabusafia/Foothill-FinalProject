import type { z } from "zod";
import { type ValidationIssue, ValidationError } from "./errors";

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/**
 * Parses `data` with `schema` and returns the typed result, or throws a
 * ValidationError (400) listing every issue.
 *
 * Called inside route handlers rather than as middleware so the parsed value
 * keeps its inferred type, and because Express 5 makes `req.query` read-only.
 *
 *   const input = validate(createUserSchema, req.body);
 */
export function validate<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(toValidationIssues(result.error));
  }
  return result.data;
}
