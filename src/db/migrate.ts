import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: "drizzle" });
}

if (require.main === module) {
  runMigrations()
    .then(() => console.log("Migrations applied"))
    .catch((err) => {
      console.error("Migration failed", err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
