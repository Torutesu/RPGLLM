import { defineConfig } from "vitest/config";
import { resolveTestDatabase } from "./test-database";

/**
 * Each run owns its database (`rpgllm_test_v<pid>` by default), created and migrated in
 * `vitest.global-setup.ts` and dropped afterwards — two suites running at once no longer truncate
 * each other. `TEST_DATABASE_URL=…` opts out and uses your own database untouched;
 * `TEST_DB_SUFFIX=<name>` picks a stable private name; `TEST_DB_KEEP=1` keeps it for a post-mortem.
 * The recipe is written up in `docs/testing.md`.
 */
const db = resolveTestDatabase();

export default defineConfig({
  test: {
    // One DB, one schema: never run API test files in parallel.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      DATABASE_URL: db.url,
      TEST_DATABASE_URL: db.url,
      JWT_SECRET: "test-secret",
      TEST_HOOKS: "1",
      BILLING_MODE: "test",
      ADS_MODE: "test",
      LLM_MODE: "replay",
      LLM_MODEL_HIGH: "claude-opus-5",
      LLM_MODEL_MID: "claude-sonnet-5",
      LLM_MODEL_LIGHT: "claude-haiku-4-5",
      STREAM_DELAY_MS: "0",
      DM_STREAM_DELAY_MS: "0",
    },
  },
});
