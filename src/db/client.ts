import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
});

export const db = drizzle({ client: pool, schema, casing: "snake_case" });

export type Db = typeof db;

/** The transaction handle passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** For queries that may run either inside or outside a transaction. */
export type DbOrTx = Db | Tx;
