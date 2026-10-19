import { z } from "zod";
import { ValidationError } from "./errors";

/**
 * Cursor ("keyset") pagination over (created_at DESC, id DESC).
 *
 * The cursor is the position of the last item on the previous page, so the next
 * query is an index seek, not an OFFSET scan. `createdAt` is kept as Postgres
 * text to preserve microseconds; a JS Date would round to milliseconds and could
 * skip or repeat rows created in the same millisecond.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

const cursorSchema = z.object({ createdAt: z.string().min(1), id: z.uuid() });

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Shared query-string fields for list endpoints. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: z.string().optional(),
});

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(value: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new ValidationError([{ path: "cursor", message: "Invalid cursor" }]);
  }
}

/**
 * Builds a page from rows fetched with `limit + 1`: the extra row only signals
 * that another page exists and is not returned.
 */
export function toPage<Row extends { cursor: Cursor }, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last ? encodeCursor(last.cursor) : null,
  };
}
