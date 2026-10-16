import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/global.ts"],
    setupFiles: ["tests/setup/perFile.ts"],
    // Integration tests share one database and truncate it, so files run one at a time.
    fileParallelism: false,
  },
});
