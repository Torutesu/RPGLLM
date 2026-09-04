/**
 * vitest global setup: give this run its own database, and take it away again.
 * See `test-database.ts` for the naming rules and the escape hatches.
 */
import { createDatabase, dropDatabase, migrate, resolveTestDatabase } from "./test-database";

export async function setup(): Promise<void> {
  const db = resolveTestDatabase();
  if (db.managed) {
    process.stdout.write(`[api:test] private database ${db.name}\n`);
    createDatabase(db);
  } else {
    process.stdout.write(`[api:test] using TEST_DATABASE_URL (${db.name}) — not created or dropped by this run\n`);
  }
  migrate(db);
  return Promise.resolve();
}

export async function teardown(): Promise<void> {
  const db = resolveTestDatabase();
  if (!db.managed || process.env.TEST_DB_KEEP === "1") {
    if (db.managed) process.stdout.write(`[api:test] TEST_DB_KEEP=1 — keeping ${db.name}\n`);
    return Promise.resolve();
  }
  dropDatabase(db);
  return Promise.resolve();
}
