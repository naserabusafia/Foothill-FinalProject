import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { type Account, accounts, apiKeys, type Plan, plans } from "../../db/schema";
import { firstRow } from "../../db/utils";
import { generateApiKey, hashApiKey } from "../../shared/apiKey";
import { NotFoundError } from "../../shared/errors";
import { getAssignablePlanOrThrow, type PlanResponse, toPlanResponse } from "../plans/plans.service";
import type { CreateAccountInput } from "./accounts.schemas";

export interface AccountResponse {
  id: string;
  name: string;
  plan: PlanResponse;
  createdAt: Date;
}

function toAccountResponse(account: Account, plan: Plan): AccountResponse {
  return {
    id: account.id,
    name: account.name,
    plan: toPlanResponse(plan),
    createdAt: account.createdAt,
  };
}

/**
 * Creates an account and its first API key in one transaction.
 * The plain key is returned here and nowhere else; only its hash is stored.
 */
export async function createAccount(input: CreateAccountInput): Promise<{ account: AccountResponse; apiKey: string }> {
  return db.transaction(async (tx) => {
    const plan = await getAssignablePlanOrThrow(null, input.planId, "account", tx);

    const account = firstRow(await tx.insert(accounts).values({ name: input.name, planId: plan.id }).returning());

    const apiKey = generateApiKey();
    await tx.insert(apiKeys).values({ accountId: account.id, keyHash: apiKey.hash, keyPrefix: apiKey.prefix });

    return { account: toAccountResponse(account, plan), apiKey: apiKey.key };
  });
}

export async function getAccountOrThrow(accountId: string): Promise<AccountResponse> {
  const [row] = await db
    .select({ account: accounts, plan: plans })
    .from(accounts)
    .innerJoin(plans, eq(plans.id, accounts.planId))
    .where(eq(accounts.id, accountId));

  if (!row) {
    throw new NotFoundError("ACCOUNT_NOT_FOUND", "Account not found");
  }
  return toAccountResponse(row.account, row.plan);
}

/** Resolves an API key to its account, or null if the key is unknown or revoked. */
export async function findAccountIdByApiKey(key: string): Promise<string | null> {
  const [row] = await db
    .select({ accountId: apiKeys.accountId })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hashApiKey(key)), isNull(apiKeys.revokedAt)));

  return row?.accountId ?? null;
}
