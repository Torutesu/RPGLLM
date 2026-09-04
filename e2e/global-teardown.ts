import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_MANAGED, TEST_DATABASE_URL } from "./playwright.config";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Drops the database this run created (`DROP DATABASE … WITH (FORCE)`, so a lingering API
 * connection cannot block it). A database supplied through `E2E_DATABASE_URL` is never dropped —
 * you own its lifecycle. `E2E_DB_KEEP=1` keeps a managed one for a post-mortem.
 */
export default async function globalTeardown(): Promise<void> {
  if (!TEST_DATABASE_MANAGED || process.env.E2E_SKIP_DB === "1") return;
  try {
    execFileSync("node", ["e2e/scripts/db.mjs", "drop"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, E2E_DB_MANAGED: "1" },
    });
  } catch (err: unknown) {
    // Never fail a green run on housekeeping.
    process.stdout.write(`[e2e:teardown] could not drop the test database: ${String(err)}\n`);
  }
  return Promise.resolve();
}
