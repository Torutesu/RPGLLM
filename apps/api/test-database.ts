/**
 * Where the API test suites point, and how that database comes into existence.
 *
 * Before this, `vitest.config.ts` hard-defaulted to the **shared** `rpgllm_test` and forced it onto
 * `DATABASE_URL`, so two agents (or two CI jobs) running `pnpm --filter api test` at the same time
 * truncated each other mid-run — a failure that looks like a product bug and has cost several
 * agents hours (build-notes: Agent H, Agent I, Agent K, Agent L).
 *
 * Now every run gets **its own database**, created and migrated before the first test file and
 * dropped after the last one:
 *
 *   pnpm --filter api test                        → rpgllm_test_v<pid>   (created + dropped)
 *   TEST_DB_SUFFIX=alice pnpm --filter api test   → rpgllm_test_alice    (created + dropped)
 *   TEST_DATABASE_URL=…/mydb pnpm --filter api test → mydb, untouched: you own its lifecycle
 *   TEST_DB_KEEP=1 …                              → keep the database after the run (post-mortem)
 *
 * `TEST_DATABASE_BASE_URL` (default `postgresql://postgres@127.0.0.1:5432`) says which server.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_BASE = "postgresql://postgres@127.0.0.1:5432";

export interface TestDatabase {
  url: string;
  name: string;
  /** true when this process created the database and must drop it afterwards */
  managed: boolean;
}

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 40);

/**
 * Resolved once per process and memoised in `process.env` so the vitest config and the global
 * setup file cannot disagree about which database this run uses.
 */
export function resolveTestDatabase(): TestDatabase {
  const cached = process.env.RPGLLM_TEST_DB;
  if (cached) return JSON.parse(cached) as TestDatabase;

  const explicit = process.env.TEST_DATABASE_URL;
  const resolved: TestDatabase = explicit
    ? { url: explicit, name: new URL(explicit).pathname.replace(/^\//, ""), managed: false }
    : (() => {
      const base = (process.env.TEST_DATABASE_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");
      const name = `rpgllm_test_${sanitize(process.env.TEST_DB_SUFFIX ?? `v${process.pid}`)}`;
      return { url: `${base}/${name}`, name, managed: true };
    })();
  process.env.RPGLLM_TEST_DB = JSON.stringify(resolved);
  return resolved;
}

/** A connection URL for the same server, pointed at `postgres`, for CREATE/DROP DATABASE. */
export function adminUrlFor(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

const psql = (url: string, sql: string): void => {
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", url, "-c", sql], { stdio: ["ignore", "ignore", "inherit"] });
};

export const databaseExists = (url: string, name: string): boolean => {
  const out = execFileSync("psql", ["-tAq", adminUrlFor(url), "-c", `SELECT 1 FROM pg_database WHERE datname = '${name}'`], {
    encoding: "utf8",
  });
  return out.trim() === "1";
};

export function createDatabase(db: TestDatabase): void {
  if (databaseExists(db.url, db.name)) dropDatabase(db);
  psql(adminUrlFor(db.url), `CREATE DATABASE "${db.name}"`);
}

/** `WITH (FORCE)` (PG13+): an idle Prisma connection must not be able to block the drop. */
export function dropDatabase(db: TestDatabase): void {
  psql(adminUrlFor(db.url), `DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
}

export function migrate(db: TestDatabase): void {
  execFileSync("pnpm", ["--filter", "api", "exec", "prisma", "migrate", "deploy"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, DATABASE_URL: db.url },
  });
}
