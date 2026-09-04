import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

const API_PORT = Number(process.env.API_PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 8082);
export const API_URL = process.env.API_URL ?? `http://localhost:${API_PORT}`;
export const WEB_URL = process.env.WEB_URL ?? `http://localhost:${WEB_PORT}`;
// `fixtures.ts` reads API_URL/WEB_URL from the environment, so a run on private ports
// (`API_PORT=4300 WEB_PORT=8390 pnpm e2e`) has to see them there too — the config is loaded before
// the workers start, so writing them back here is what makes API_PORT alone sufficient.
process.env.API_URL = API_URL;
process.env.WEB_URL = WEB_URL;

/**
 * The E2E database. **One per run**: `rpgllm_test_e2e_<pid>` is created, migrated and seeded by
 * `scripts/api.mjs` before the API starts, and dropped in `global-teardown.ts`. Two suites running
 * at once therefore cannot truncate each other — which is exactly what the shared `rpgllm_test`
 * used to do (build-notes: Agent K, Agent I, Agent L, Agent M). `docs/testing.md` has the recipe.
 *
 *   E2E_DATABASE_URL=…   use that database verbatim; this run never creates or drops it
 *   E2E_DB_SUFFIX=alice  a stable private name (`rpgllm_test_e2e_alice`)
 *   E2E_DB_KEEP=1        keep the database after the run, for a post-mortem
 *   E2E_SKIP_DB=1        touch no database at all (reusing a stack you started yourself)
 */
const DB_BASE = (process.env.E2E_DATABASE_BASE_URL ?? "postgresql://postgres@127.0.0.1:5432").replace(/\/+$/, "");
const DB_SUFFIX = (process.env.E2E_DB_SUFFIX ?? `p${process.pid}`).replace(/[^A-Za-z0-9_]/g, "_");
/** true when this run owns the database and must drop it afterwards */
export const TEST_DATABASE_MANAGED = !process.env.E2E_DATABASE_URL;
export const TEST_DATABASE_URL = process.env.E2E_DATABASE_URL ?? `${DB_BASE}/rpgllm_test_e2e_${DB_SUFFIX}`;

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
  globalTeardown: "./global-teardown.ts",
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
    // Chromium preinstalled in this environment (build revision differs from Playwright 1.62; never run `playwright install`)
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" },
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
      // Prepares the per-run database and *then* starts the API — see e2e/scripts/db.mjs.
      command: "node e2e/scripts/api.mjs",
      cwd: REPO_ROOT,
      url: `${API_URL}/v1/health`,
      // Only reuse a server somebody else started when the operator has explicitly said so with
      // E2E_SKIP_DB=1 ("I brought my own stack"): every other run owns a private database, and a
      // foreign API on this port would be talking to a different one.
      reuseExistingServer: process.env.E2E_SKIP_DB === "1",
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
        E2E_DB_MANAGED: TEST_DATABASE_MANAGED ? "1" : "0",
        ...(process.env.E2E_SKIP_DB ? { E2E_SKIP_DB: process.env.E2E_SKIP_DB } : {}),
      },
    },
    {
      command: "node e2e/scripts/web.mjs",
      cwd: REPO_ROOT,
      url: WEB_URL,
      reuseExistingServer: process.env.E2E_SKIP_DB === "1" || process.env.E2E_SKIP_EXPORT === "1",
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
