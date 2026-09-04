import { defineConfig } from "vitest/config";

const testDbUrl = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/rpgllm_test";

export default defineConfig({
  test: {
    // One DB, one schema: never run API test files in parallel.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    env: {
      DATABASE_URL: testDbUrl,
      TEST_DATABASE_URL: testDbUrl,
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
