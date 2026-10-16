/**
 * Points the app at the test database before any src module reads config.
 * Imported first by both the global setup and every test file (setupFiles).
 */
try {
  process.loadEnvFile();
} catch {
  // No .env: rely on the real environment (e.g. CI).
}

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://quota:quota@localhost:5433/quota_test";
process.env.ADMIN_API_KEY ??= "test-admin-key-0123456789";
process.env.DB_POOL_MAX ??= "5";

export const TEST_ADMIN_KEY = process.env.ADMIN_API_KEY;
