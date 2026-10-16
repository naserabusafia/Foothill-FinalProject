// Must stay the first import (see global.ts).
import "./env";
import { afterAll } from "vitest";
import { pool } from "../../src/db/client";

// Each test file gets its own module graph and pool; close it so the worker can exit.
afterAll(async () => {
  await pool.end();
});
