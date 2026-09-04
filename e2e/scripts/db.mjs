// The E2E database lifecycle, in one place.
//
// Every run gets its **own** database (`rpgllm_test_e2e_<pid>` unless E2E_DATABASE_URL says
// otherwise), so two agents — or two CI jobs — can run `pnpm e2e` at the same time without
// truncating each other. Historically `globalSetup` dropped and recreated the shared `rpgllm_test`
// *after* Playwright had already started the API webServer, which left the API connected to a
// database that no longer existed and made `POST /__test/reset` answer 500 for the first tests
// (build-notes: Agent K, Agent I, Agent M).
//
// The fix is ordering: preparation happens **inside the API webServer command** (`api.mjs`), before
// the API process starts, and `global-setup.ts` only makes sure it has happened. Whichever of the
// two gets there first does the work under an exclusive lock file; the other waits for the marker.
//
//   node e2e/scripts/db.mjs prepare   # create (if managed) + migrate + seed
//   node e2e/scripts/db.mjs drop      # drop, when managed
//
// Env: DATABASE_URL (required), E2E_DB_MANAGED=1|0, E2E_SKIP_DB=1 to bypass everything.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const log = (m) => process.stdout.write(`[e2e:db] ${m}\n`);

const dbNameOf = (url) => new URL(url).pathname.replace(/^\//, "");
const adminUrl = (url) => {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
};

const psql = (url, sql) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", url, "-c", sql], { stdio: ["ignore", "ignore", "inherit"] });

const markerFor = (url) => path.join(os.tmpdir(), `rpgllm-e2e-${dbNameOf(url)}.ready`);
const lockFor = (url) => path.join(os.tmpdir(), `rpgllm-e2e-${dbNameOf(url)}.lock`);

const run = (label, cmd, args, env) => {
  log(`${label} — ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, ...env } });
};

/** Postgres must be up before anything else; `db.sh start` is a no-op when it already is. */
function ensureServer() {
  run("postgres up", "bash", ["scripts/db.sh", "start"], {});
}

export function prepareDatabase(url, { managed }) {
  if (process.env.E2E_SKIP_DB === "1") {
    log("E2E_SKIP_DB=1 — skipping create/migrate/seed");
    return;
  }
  const marker = markerFor(url);
  if (fs.existsSync(marker)) {
    log(`${dbNameOf(url)} already prepared by this run`);
    return;
  }
  const lock = lockFor(url);
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
  } catch {
    // Someone else is preparing the same database: wait for their marker instead of racing them.
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(marker)) return;
      execFileSync("sleep", ["0.25"]);
    }
    throw new Error(`[e2e:db] timed out waiting for ${dbNameOf(url)} to be prepared`);
  }

  try {
    ensureServer();
    const name = dbNameOf(url);
    if (managed) {
      log(`private database ${name}`);
      psql(adminUrl(url), `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      psql(adminUrl(url), `CREATE DATABASE "${name}"`);
    } else {
      log(`using ${name} as given (E2E_DATABASE_URL) — not created`);
    }
    run("migrate", "pnpm", ["--filter", "api", "exec", "prisma", "migrate", "deploy"], { DATABASE_URL: url });
    run("seed", "pnpm", ["--filter", "api", "seed"], { DATABASE_URL: url });
    fs.writeFileSync(marker, `${new Date().toISOString()} ${url}\n`);
    log("ready");
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lock, { force: true });
  }
}

export function dropDatabase(url, { managed }) {
  fs.rmSync(markerFor(url), { force: true });
  if (!managed || process.env.E2E_SKIP_DB === "1" || process.env.E2E_DB_KEEP === "1") {
    if (managed && process.env.E2E_DB_KEEP === "1") log(`E2E_DB_KEEP=1 — keeping ${dbNameOf(url)}`);
    return;
  }
  const name = dbNameOf(url);
  psql(adminUrl(url), `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  log(`dropped ${name}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2] ?? "prepare";
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("DATABASE_URL is required");
    process.exit(1);
  }
  const managed = process.env.E2E_DB_MANAGED !== "0";
  if (command === "prepare") prepareDatabase(url, { managed });
  else if (command === "drop") dropDatabase(url, { managed });
  else {
    log(`unknown command "${command}" (prepare|drop)`);
    process.exit(1);
  }
}
