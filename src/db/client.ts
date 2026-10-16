import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

/** The only pool in the process; every module imports `db` from here. */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle({ client: pool, schema, casing: "snake_case" });

export type Db = typeof db;

/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** For queries that may run either inside or outside a transaction. */
export type DbOrTx = Db | Tx;
