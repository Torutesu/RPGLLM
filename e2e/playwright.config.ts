import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 8082);
export const API_URL = process.env.API_URL ?? `http://localhost:${API_PORT}`;
export const WEB_URL = process.env.WEB_URL ?? `http://localhost:${WEB_PORT}`;

/** The E2E database. Never point this at `rpgllm` — globalSetup drops and recreates it. */
export const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/rpgllm_test";

/** Ads flag baked into the web export we serve. E2E-007/016 need it; E2E-012 turns it off at runtime. */
const ADS_MODE = process.env.EXPO_PUBLIC_ADS_MODE ?? "test";

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } as const;

/**
 * Optional second project: a web export built WITHOUT the ads flag, served elsewhere.
 * Only E2E-012 runs there. When `E2E_PROD_WEB_URL` is unset the project is not registered at all
 * (P0 cases are never `test.skip`ped — E2E-012 still runs in `chromium`, where it disables ads
 * through `globalThis.__ADS_MODE`, the runtime override apps/mobile/src/env.ts exposes).
 */
const projects: NonNullable<PlaywrightTestConfig["projects"]> = [
  { name: "chromium", use: { ...desktop, baseURL: WEB_URL } },
];
if (process.env.E2E_PROD_WEB_URL) {
  projects.push({
    name: "web-prod",
    grep: /E2E-012/,
    use: {
    // Chromium preinstalled in this environment (Playwright build revision may differ; never run `playwright install`)
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" }, ...desktop, baseURL: process.env.E2E_PROD_WEB_URL },
  });
}

/** `smoke.spec.ts` is wiring proof, not a spec case — keep it out of the reported case list. */
const testIgnore = process.env.E2E_SMOKE === "1" ? [] : ["**/smoke.spec.ts"];

export default defineConfig({
  testDir: "./tests",
  testIgnore,
  globalSetup: "./global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects,
  webServer: [
    {
      command: "pnpm --filter api start",
      cwd: REPO_ROOT,
      url: `${API_URL}/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        TEST_HOOKS: "1",
        LLM_MODE: "replay",
        BILLING_MODE: "test",
        ADS_MODE: "test",
        LLM_REPLAY_LATENCY_MS: "0",
        JWT_SECRET: "test",
      },
    },
    {
      command: "node e2e/scripts/web.mjs",
      cwd: REPO_ROOT,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        WEB_PORT: String(WEB_PORT),
        EXPO_PUBLIC_API_URL: API_URL,
        EXPO_PUBLIC_ADS_MODE: ADS_MODE,
        EXPO_PUBLIC_BILLING_MODE: "test",
      },
    },
  ],
});
