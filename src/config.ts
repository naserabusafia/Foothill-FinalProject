import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  // One pool per process. Bigger is not faster: see docs/architecture.md (section 5).
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  // How long a request may wait for a free pool connection before failing with 503.
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  ADMIN_API_KEY: z.string().min(16, "ADMIN_API_KEY must be at least 16 characters"),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast: the service must not start with missing or invalid settings.
    console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
