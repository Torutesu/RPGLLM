# Running the suites without stepping on anyone

Owner: Agent O (runtime & ops). Companion notes: `pipeline/status/build-notes.md` → "Agent O".

Three test surfaces, one Postgres server:

| suite | command | database |
|---|---|---|
| API unit/integration (vitest) | `pnpm --filter api test` | `rpgllm_test_v<pid>` — created, migrated, dropped per run |
| Playwright E2E | `pnpm e2e` | `rpgllm_test_e2e_p<pid>` — created, migrated, seeded, dropped per run |
| LLM gateway | `pnpm --filter llm test` | none |

**Both harnesses are isolated by default.** Nothing shares `rpgllm_test` any more, so two agents —
or two CI jobs, or a rerun over a run you forgot to stop — cannot truncate each other's data. This
used to be the single most expensive failure mode in this repo: a run would fail with
`POST /__test/reset → 500`, or a seemingly impossible assertion, because someone else's suite had
dropped the database underneath it (build-notes: Agent H, Agent I, Agent K, Agent L, Agent M).

## 1. vitest (`apps/api`)

`vitest.config.ts` asks `test-database.ts` for this run's database and `vitest.global-setup.ts`
creates and migrates it before the first test file, then drops it after the last one.

```bash
pnpm --filter api test                                  # rpgllm_test_v<pid>, dropped at the end
TEST_DB_SUFFIX=alice pnpm --filter api test             # rpgllm_test_alice (stable name)
TEST_DB_KEEP=1 pnpm --filter api test                   # keep it afterwards, to poke at the rows
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/mydb pnpm --filter api test
                                                        # use mydb as-is: migrated, never dropped
TEST_DATABASE_BASE_URL=postgresql://user@host:5432 pnpm --filter api test   # a different server
```

`DATABASE_URL` is **ignored** by the API test suite — the config always overrides it with the
resolved test database (that is deliberate: it is what stops a stray `DATABASE_URL=…/rpgllm` from
truncating the development data).

## 2. Playwright (`e2e`)

```bash
pnpm e2e                                     # private database, API :4000, web :8082
API_PORT=4300 WEB_PORT=8390 E2E_WEB_DIST=dist-me pnpm e2e     # private ports and web bundle too
E2E_DB_SUFFIX=me pnpm e2e                    # a stable private database name
E2E_DB_KEEP=1 pnpm e2e                       # keep the database for a post-mortem
E2E_DATABASE_URL=…/mydb pnpm e2e             # your database, verbatim: never created or dropped
E2E_SKIP_DB=1 API_URL=… WEB_URL=… pnpm e2e   # against a stack you started yourself
E2E_SKIP_EXPORT=1 pnpm e2e                   # reuse the existing web bundle (same API URL!)
```

Ordering — the part that used to be wrong: Playwright starts its `webServer`s **before**
`globalSetup`, so the old "drop and recreate, then migrate and seed" in `globalSetup` ran *after*
the API had already connected. All of that now happens inside the API webServer command
(`e2e/scripts/api.mjs` → `e2e/scripts/db.mjs`), i.e. **before the API process starts**;
`global-setup.ts` runs the same idempotent preparation (a marker file makes the second call a
no-op, a lock file makes a race impossible), and `global-teardown.ts` drops the database with
`WITH (FORCE)` so a lingering connection cannot block it.

Two more consequences worth knowing:

- A server on the port is only reused when you pass `E2E_SKIP_DB=1`. Otherwise Playwright starts
  its own — reusing a foreign API would mean testing against *its* database, not this run's.
- The web bundle bakes `EXPO_PUBLIC_API_URL` in, so a run on a private API port needs its own
  export directory: `E2E_WEB_DIST=dist-me`. `API_PORT`/`WEB_PORT` are enough for everything else —
  the config writes `API_URL`/`WEB_URL` back into the environment for `fixtures.ts`.

## 3. Which knobs exist

| variable | suite | meaning |
|---|---|---|
| `TEST_DATABASE_URL` | vitest | use this database verbatim; the run never creates or drops it |
| `TEST_DB_SUFFIX` | vitest | name the private database `rpgllm_test_<suffix>` |
| `TEST_DB_KEEP=1` | vitest | do not drop it afterwards |
| `TEST_DATABASE_BASE_URL` | vitest | server for the private database (default `postgresql://postgres@127.0.0.1:5432`) |
| `E2E_DATABASE_URL` | e2e | use this database verbatim |
| `E2E_DB_SUFFIX` / `E2E_DB_KEEP` / `E2E_DATABASE_BASE_URL` | e2e | as above |
| `E2E_SKIP_DB=1` | e2e | touch no database; also the only way an existing server is reused |
| `E2E_SKIP_EXPORT=1` | e2e | serve the existing bundle instead of re-exporting |
| `E2E_WEB_DIST` | e2e | export/serve directory under `apps/mobile` (default `dist`) |
| `API_PORT` / `WEB_PORT` | e2e | ports; `API_URL`/`WEB_URL` are derived and exported |
| `PW_CHROMIUM_PATH` | e2e | Chromium binary (this sandbox: `/opt/pw-browsers/chromium`; **never** run `playwright install`) |

## 4. Housekeeping

Private databases are dropped automatically. If a run was killed hard, they are easy to spot and
remove:

```bash
psql -h 127.0.0.1 -U postgres -tc \
  "select datname from pg_database where datname like 'rpgllm_test_%'"
psql -h 127.0.0.1 -U postgres -c 'drop database "rpgllm_test_v12345" with (force)'
```

`scripts/db.sh reset` still exists and still targets the shared `rpgllm_test`; nothing in either
harness uses it any more.
