// Must stay the first import: modules are evaluated in import order, so the
// test DATABASE_URL is in place before src/config.ts reads the environment.
import "./env";
import { pool } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";

/** Runs once before the whole suite: brings the test database schema up to date. */
export default async function setup(): Promise<void> {
  try {
    await runMigrations();
  } finally {
    await pool.end();
  }
}
