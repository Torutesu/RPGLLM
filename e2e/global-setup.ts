import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_DATABASE_URL } from "./playwright.config";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(label: string, cmd: string, args: readonly string[]): void {
  process.stdout.write(`\n[e2e:setup] ${label} — ${cmd} ${args.join(" ")}\n`);
  execFileSync(cmd, [...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

/**
 * Brings `rpgllm_test` to a known state before the run:
 *   1. Postgres up + database dropped/recreated (`scripts/db.sh`)
 *   2. `prisma migrate deploy`
 *   3. `pnpm --filter api seed` (worlds, characters, preset personas, ambient pool)
 *
 * Set `E2E_SKIP_DB=1` to bypass all three (used when proving the webServer wiring against a
 * skeleton API that has no schema or seed yet).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_SKIP_DB === "1") {
    process.stdout.write("[e2e:setup] E2E_SKIP_DB=1 — skipping reset/migrate/seed\n");
    return;
  }
  run("postgres up", "bash", ["scripts/db.sh", "start"]);
  run("reset rpgllm_test", "bash", ["scripts/db.sh", "reset"]);
  run("migrate", "pnpm", ["--filter", "api", "exec", "prisma", "migrate", "deploy"]);
  run("seed", "pnpm", ["--filter", "api", "seed"]);
  process.stdout.write("[e2e:setup] ready\n");
}
