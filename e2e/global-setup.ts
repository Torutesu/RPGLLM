import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_MANAGED, TEST_DATABASE_URL } from "./playwright.config";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Makes sure this run's database exists, is migrated and is seeded — **without** ever doing that
 * work behind a running API.
 *
 * Playwright starts its webServers before `globalSetup`, so the old version of this file (drop and
 * recreate the shared `rpgllm_test`, then migrate and seed) pulled the database out from under an
 * API that had already connected: `POST /__test/reset` answered 500 and the first cases failed for
 * reasons that had nothing to do with the product. The preparation now lives in the API webServer
 * command itself (`e2e/scripts/api.mjs`), which runs it before the server process starts; this hook
 * is the idempotent second half — it is a no-op when the marker is already there, and does the work
 * when the API webServer was reused (`reuseExistingServer`) and therefore never ran it.
 *
 * `E2E_SKIP_DB=1` bypasses everything (running against a stack you brought up yourself).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_DB === "1") {
    process.stdout.write("[e2e:setup] E2E_SKIP_DB=1 — skipping create/migrate/seed\n");
    return;
  }
  execFileSync("node", ["e2e/scripts/db.mjs", "prepare"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, E2E_DB_MANAGED: TEST_DATABASE_MANAGED ? "1" : "0" },
  });
  return Promise.resolve();
}
