import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { consumptionRequests } from "../../db/schema";
import { decodeCursor, type Page, toPage } from "../../shared/pagination";
import { type ConsumptionResponse, toConsumptionResponse } from "./consume.service";
import type { ListConsumptionsQuery } from "./consumptions.schemas";

/**
 * The account's decision log, newest first, cursor-paginated. Each item has the
 * same shape as the POST /consumptions response, built from the stored snapshot.
 * Served by the (account_id, created_at DESC, id DESC) index.
 */
export async function listConsumptions(accountId: string, query: ListConsumptionsQuery): Promise<Page<ConsumptionResponse>> {
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  const t = consumptionRequests;

  const rows = await db
    .select({
      request: t,
      cursor: { createdAt: sql<string>`${t.createdAt}::text`, id: t.id },
    })
    .from(t)
    .where(
      and(
        eq(t.accountId, accountId),
        // Never visible outside the consume transaction; excluded defensively.
        ne(t.status, "pending"),
        query.userId ? eq(t.userId, query.userId) : undefined,
        query.status ? eq(t.status, query.status) : undefined,
        query.month ? eq(t.month, query.month) : undefined,
        after ? sql`(${t.createdAt}, ${t.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(query.limit + 1);

  return toPage(rows, query.limit, (row) => toConsumptionResponse(row.request));
}
