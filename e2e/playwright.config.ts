import { defineConfig, devices } from "@playwright/test";
// Agent D completes this config (webServer for api :4000 and web :8082, global setup, projects).
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  use: { baseURL: process.env.WEB_URL ?? "http://localhost:8082", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
