// Playwright webServer entry for the API.
//
// It exists so that **all database work finishes before the API process starts**: create the
// per-run database, migrate it, seed it, and only then exec the server. Playwright launches its
// webServers before `globalSetup` runs, so any reset done from `globalSetup` used to land after the
// API had already connected — see `db.mjs` for the full story.
//
// Env: everything `pnpm --filter api start` needs (DATABASE_URL, PORT, TEST_HOOKS, …) plus
//      E2E_DB_MANAGED=1|0 and E2E_SKIP_DB=1.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareDatabase } from "./db.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const log = (m) => process.stdout.write(`[e2e:api] ${m}\n`);

const url = process.env.DATABASE_URL;
if (!url) {
  log("DATABASE_URL is required");
  process.exit(1);
}
prepareDatabase(url, { managed: process.env.E2E_DB_MANAGED !== "0" });

log(`starting the API on :${process.env.PORT ?? 4000}`);
// node directly, not `pnpm --filter api start`: pnpm → sh → tsx does not forward SIGTERM, so
// Playwright's teardown would leave an orphaned API holding the port for the next run.
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: path.join(REPO_ROOT, "apps/api"),
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
