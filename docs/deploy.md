# Deploying `apps/api`

Owners: Agent F (security & ops) and Agent O (runtime & ops). Companion notes:
`pipeline/status/build-notes.md` → "Agent F" and "Agent O". Test-database recipes: `docs/testing.md`.

**There are two processes**, built from the same image:

| process | command | what it does | how many |
|---|---|---|---|
| API | `pnpm --filter api start` | serves `/v1/**` on `PORT` | as many as you like |
| worker | `pnpm --filter api worker` | runs the `JOBS` cron table (digests, memory consolidation, ambient refill, purges, bandit update) | **one is enough**; more is safe |

Neither runs migrations — that is a release step (§2).

## 1. Build the image

The Docker build context is the **repository root** (it is a pnpm workspace):

```bash
docker build -f apps/api/Dockerfile -t rpgllm-api:$(git rev-parse --short HEAD) .
```

Stages: `base` (node:22-slim + openssl) → `fetch` (`pnpm fetch`, cached on the lockfile) →
`build` (`pnpm install --filter api...`, `prisma generate`, `tsc --noEmit`) → `runtime`
(non-root `node` user, `HEALTHCHECK` on `/v1/health`).

The image's default command starts the **API**. The **worker** is the same image with a different
command:

```bash
docker run --rm -e DATABASE_URL -e JWT_SECRET -e NODE_ENV=production … rpgllm-api:<tag> \
  node --import tsx src/worker.ts
```

Both entrypoints are `node` directly (not `pnpm run …`) so the app is **PID 1** and receives
`SIGTERM` from the orchestrator: a `pnpm`/`sh -c` wrapper swallows the signal and you lose the
graceful drain.

## 2. Migrate, then release

Migrations are **not** run by the container start command — N replicas would race. Run them once
per release, before the new image takes traffic:

```bash
docker run --rm -e DATABASE_URL="$DATABASE_URL" rpgllm-api:<tag> \
  pnpm --filter api exec prisma migrate deploy
```

## 3. Required production environment

`assertProductionConfig()` (`apps/api/src/config-guard.ts`) runs at boot and **refuses to start**
when any of these is wrong. `.env.example` is development-only and is not read when
`NODE_ENV=production` (S0-3).

| Variable | Production value | Why |
|---|---|---|
| `NODE_ENV` (or `APP_ENV`) | `production` | turns on every check below |
| `JWT_SECRET` | random, **≥ 32 chars**, not `dev-secret-change-me` | session forgery (S0-2) |
| `AUTH_DEV_CODE` | unset / `0` | `1` accepts the constant code `000000` for any account (S0-1) |
| `TEST_HOOKS` | unset / `0` | `1` exposes `/__test/*`: DB truncate, time travel, energy grants |
| `BILLING_MODE` | `revenuecat` | `test` lets any user grant themselves a subscription |
| `ADS_MODE` | `admob` | `test` accepts the constant `TEST_AD_TOKEN` as ad proof (S0-6) |
| `DATABASE_URL` | Postgres 16 URL | — |
| `LLM_MODE` | `live` | `replay` serves fixtures |
| `ANTHROPIC_API_KEY` | real key | required by `LLM_MODE=live` |
| `LLM_MODEL_HIGH/MID/LIGHT` | `claude-opus-5` / `claude-sonnet-5` / `claude-haiku-4-5` | never hardcoded in call sites |
| `CORS_ORIGINS` | comma-separated app origins | `*` is only kept while `TEST_HOOKS=1` (S0-5) |

Optional, with safe defaults:

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `4000` | |
| `AUTH_CODE_TTL_MS` / `AUTH_CODE_MAX_ATTEMPTS` | `600000` / `5` | one-time login codes |
| `RATE_LIMIT_ENABLED` | on unless `TEST_HOOKS=1` | `1`/`0` forces it |
| `RATE_LIMIT_AUTH_PER_MIN` | `5` | per IP **and** per email |
| `RATE_LIMIT_WRITE_PER_MIN` | `20` | per user; posts, replies, DM sends (each costs an LLM call) |
| `RATE_LIMIT_AD_PER_MIN` | `10` | per user; the ad-reward grant |
| `RATE_LIMIT_DEFAULT_PER_MIN` | `120` | per user, or per IP when unauthenticated |
| `REQUEST_LOG` | `1` | JSON access log with `x-request-id` |
| `HEALTH_DB_TIMEOUT_MS` | `1500` | `SELECT 1` budget for `/v1/health` |
| `SHUTDOWN_GRACE_MS` | `10000` | SIGTERM → let in-flight SSE finish → `prisma.$disconnect()` → exit 0 |
| `ADMIN_TOKEN` | unset | `x-admin-token` for `/v1/cost` **and `/v1/jobs`**; unset means nobody but `TEST_HOOKS` |
| `SCHEDULER_TICK_MS` | `30000` | worker: how often it looks for a due job |
| `JOB_TIMEOUT_MS` | `600000` | worker: how long one job may hold its advisory lock |
| `JOBS_DISABLED` | empty | comma-separated job names the worker skips (still runnable by hand) |
| `JOB_RUN_RETENTION_DAYS` | `14` | how long `JobRun` rows are kept |
| `WORKER_SHUTDOWN_GRACE_MS` | `30000` | worker: how long SIGTERM waits for the in-flight job |

## 4. Operating notes

- **Health**: `GET /v1/health` → `{ ok, llmMode, champion, db }`. `db:"down"` answers **503** so a
  load balancer removes the instance instead of serving 500s.
- **Shutdown**: send `SIGTERM`; the process stops accepting connections, gives streaming responses
  up to `SHUTDOWN_GRACE_MS`, disconnects Prisma and exits 0. Give the orchestrator a
  `terminationGracePeriodSeconds` above that (15s+).
- **Logs**: one JSON line per request (`msg:"http"`, `requestId`, `method`, `path`, `status`,
  `durationMs`, `userId`). `authorization`/`cookie` headers and `?token=`/`?code=` values are
  redacted. Every JSON error body carries the same `requestId`.
- **Rate limits** are in-process. Behind N instances the effective budget is N× — move the buckets
  to Redis before scaling out (TODO in `apps/api/src/middleware/rate-limit.ts`).
- **Login codes** live in the `LoginCode` table (`apps/api/src/services/login-codes.ts`): salted
  sha256 only, 10-minute TTL, ≤5 attempts, single use, one active code per address. They survive a
  restart and work across instances, so the API scales out. Expired and consumed rows are swept by
  the `purge-login-codes` job — if you do not deploy the worker, run it from cron
  (`POST /v1/jobs/run {"job":"purge-login-codes"}`) or the table grows forever.
- **Email delivery** is `ConsoleMailSender` — codes are printed to the log. A real provider must be
  wired via `setMailSender()` before a public launch.
- **Ad rewards** in `ADS_MODE=admob` require the AdMob verifier key set to be configured
  (`setAdMobVerifierKeys`), otherwise `verifyAdMobSSV` fails closed and no reward is granted.

## 5. The worker

```bash
pnpm --filter api worker                       # run the schedule (long-lived)
pnpm --filter api worker --once                # run every job once, then exit (0 = all clean)
pnpm --filter api worker --once=ambient-refill # one job, then exit
pnpm --filter api worker --jobs=offline-director,purge-login-codes
JOBS_DISABLED=bandit-update pnpm --filter api worker
```

The schedule is `JOBS` in `packages/shared/src/constants.ts` — the worker has no table of its own:

| job | cron (UTC) | what it does |
|---|---|---|
| `offline-director` | `0 * * * *` | While-you-were-away digests for players who have been away (AIF-001) |
| `memory-consolidate` | `*/30 * * * *` | folds memory notes into summaries with G7 (AIF-002) |
| `ambient-refill` | `0 3 * * *` | tops the ambient post pool back up |
| `purge-deleted` | `30 3 * * *` | hard-deletes accounts past the 30-day grace window (S1-1) |
| `purge-login-codes` | `*/15 * * * *` | drops expired/consumed login codes, prunes old `JobRun` rows |
| `bandit-update` | `15 * * * *` | refreshes arm posteriors and checks the guardrails |

**Only one instance of a job runs at a time.** Each run takes a Postgres *advisory* lock keyed on
the job name (`pg_try_advisory_xact_lock`, `apps/api/src/jobs/runs.ts`), so a second worker, an
overlapping redeploy or an operator's manual trigger **skips** rather than double-running. Skips are
logged (`msg:"job.skipped"`) and never queued — the next tick tries again.

**Failure isolation.** A job that throws is written to `JobRun` with its error and the loop
continues; nothing a generator does can take the worker down. Failures are one JSON line
(`msg:"job.failed"`, `job`, `durationMs`, `error`) — alert on those, and on `lastRun.ok = false` in
`GET /v1/jobs`.

**Shutdown.** `SIGTERM` stops the loop, waits for the job in flight (up to
`WORKER_SHUTDOWN_GRACE_MS`, default 30s), disconnects Prisma and exits 0. Give it a
`terminationGracePeriodSeconds` above that.

**Visibility and manual triggers** (admin-gated exactly like `/v1/cost` — `x-admin-token` must equal
`ADMIN_TOKEN`, or `TEST_HOOKS=1`):

```bash
curl -H "x-admin-token: $ADMIN_TOKEN" https://api.example.com/v1/jobs
curl -H "x-admin-token: $ADMIN_TOKEN" "https://api.example.com/v1/jobs?job=offline-director"   # + history
curl -H "x-admin-token: $ADMIN_TOKEN" -X POST https://api.example.com/v1/jobs/run \
     -H 'content-type: application/json' -d '{"job":"ambient-refill"}'
```

`GET /v1/jobs` answers `JobsResZ`: every job with its cron line, whether it is enabled, its last run
(start, finish, processed count, error) and when it is next due.

## 6. The `JobRun` table (a known piece of schema debt)

The run log has to be readable from a different process than the one that wrote it, and
`prisma/schema.prisma` was frozen for this pass, so `apps/api/src/jobs/runs.ts` creates it with
`CREATE TABLE IF NOT EXISTS` on first use and reads it with parameterised raw SQL. It is a plain
table with no foreign keys and no Prisma model. Nothing breaks — but `prisma migrate dev` will want
to drop it, because the schema does not mention it.

**The fix, next time the schema is touched:** add the model, generate the migration, then delete
`ensureJobRunTable()` and replace the raw queries with `prisma.jobRun`.

```prisma
/// スケジューラの実行履歴 (docs/deploy.md §6)
model JobRun {
  id         String    @id @default(cuid())
  job        String
  startedAt  DateTime
  finishedAt DateTime?
  ok         Boolean   @default(false)
  processed  Int       @default(0)
  error      String?
  trigger    String    @default("schedule")
  host       String?

  @@index([job, startedAt])
}
```

## 7. Release checklist

1. `prisma migrate deploy` (once, before the new image takes traffic).
2. Roll the **API** — health check `/v1/health` (`db:"ok"`, 503 when the database is unreachable).
3. Roll the **worker** — check `GET /v1/jobs`: every job should show a recent `lastRun.ok = true`
   (or a `nextRunAt` in the future if it has not been due yet).
4. Smoke: sign in with a real email code (`POST /v1/auth/email/start` → the address receives it —
   `ConsoleMailSender` prints it to the log until a real `MailSender` is wired), post once, and
   confirm a `GenerationLog` row with a non-zero cost.
