import { createApp } from "./app";
import { config } from "./config";
import { pool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { seedPredefinedPlans } from "./db/seed";

/** How long in-flight requests get to finish after SIGTERM before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

async function main(): Promise<void> {
  if (config.RUN_MIGRATIONS_ON_START) {
    // Safe to repeat: applied migrations are recorded, and the seed skips existing plans.
    await runMigrations();
    await seedPredefinedPlans();
    console.log("Database migrated and predefined plans seeded");
  }

  const server = createApp().listen(config.PORT, () => {
    console.log(`Usage quota service listening on port ${config.PORT}`);
  });

  // `docker compose stop` sends SIGTERM: stop accepting connections, let
  // in-flight requests finish (their transactions commit or roll back), then close the pool.
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Startup failed", err);
  process.exit(1);
});
