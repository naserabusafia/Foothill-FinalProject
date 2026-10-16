import { pool } from "../db/client";
import { runMigrations } from "../db/migrate";

runMigrations()
  .then(() => console.log("Migrations applied"))
  .catch((err) => {
    console.error("Migration failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
