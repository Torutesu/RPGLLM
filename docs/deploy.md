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
| `PUBLIC_APP_URL` | the web app's origin | invites and every share card's "Open it" are built from it; unset, they point at the placeholder host `rpgllm.example` |
| `ADMIN_TOKEN` **or** `ADMIN_TOKENS` | a secret / `name:secret` pairs | with neither, no reviewer can reach the moderation queue and no world ever reaches Explore |
| `REVENUECAT_WEBHOOK_SECRET` | the shared secret | required when `BILLING_MODE=revenuecat`: the webhook is the one unauthenticated request that grants entitlements |
| `MAIL_PROVIDER` | `resend` or `postmark` | `console` prints the sign-in code to the log — nobody can sign in, and every credential is in the log pipeline |
| `MAIL_API_KEY` / `MAIL_FROM` | the provider key / a verified sender | the provider refuses every send without them |
| `LLM_DAILY_BUDGET_USD` | a positive number, or `unlimited` | the day's ceiling. No cap is allowed; *not deciding* is not |
| `RATE_LIMIT_STORE` | `shared` (or `memory` for a single instance) | in-process buckets are N× the budget behind N replicas, and the budget that matters is five auth attempts a minute |

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
| `ADMIN_TOKENS` | unset | per-reviewer `name:secret` pairs; see §4 "Who reviewed this" |
| `LLM_BUDGET_REFRESH_MS` | `20000` | how long the day's spend total is cached; the overshoot ceiling is (spend rate × this) |
| `MAIL_REPLY_TO` / `MAIL_TIMEOUT_MS` | unset / `8000` | sign-in email |
| `ADMOB_VERIFIER_KEYS_JSON` | unset | pin the SSV key set (`{"<key_id>":"<pem>"}`) instead of fetching Google's |
| `SCHEDULER_TICK_MS` | `30000` | worker: how often it looks for a due job |
| `JOB_TIMEOUT_MS` | `600000` | worker: how long one job may hold its advisory lock |
| `JOBS_DISABLED` | empty | comma-separated job names the worker skips (still runnable by hand) |
| `JOB_RUN_RETENTION_DAYS` | `14` | how long `JobRun` rows are kept |
| `JOBS_BATCH` | `1` | `0` runs the generative jobs interactively instead of on the Batch tier |
| `PUSH_RECEIPT_DELAY_MS` | `900000` | how long a push ticket settles before its receipt is read |
| `PUSH_RECEIPT_TTL_MS` | `86400000` | Expo's receipt retention; older tickets are forgotten |
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
- **Rate limits.** `RATE_LIMIT_STORE=shared` puts the token buckets in Postgres
  (`middleware/rate-limit-shared.ts`), so N replicas share one budget. The refill, the test and
  the decrement happen inside a single `INSERT … ON CONFLICT DO UPDATE`, which re-evaluates under
  the conflicting row's lock: two requests racing for the last token cannot both win. It **fails
  open** on a database error (`msg:"ratelimit.store.failed"` — alert on it), because a limiter
  that 500s has turned a defence into an outage, and the rows are swept by `purge-login-codes`.
  `memory` keeps the old in-process buckets, which are correct for exactly one instance.
- **Login codes** live in the `LoginCode` table (`apps/api/src/services/login-codes.ts`): salted
  sha256 only, 10-minute TTL, ≤5 attempts, single use, one active code per address. They survive a
  restart and work across instances, so the API scales out. Expired and consumed rows are swept by
  the `purge-login-codes` job — if you do not deploy the worker, run it from cron
  (`POST /v1/jobs/run {"job":"purge-login-codes"}`) or the table grows forever.
- **Email delivery** goes through `MAIL_PROVIDER` (`apps/api/src/services/mail.ts`): one JSON POST
  to Resend or Postmark, no SDK. A send that fails makes `POST /v1/auth/email/start` answer **502**
  rather than `{sent:true}` — a person told to check their inbox will check it for a long time.
  The code is never logged and never put in a link. `console` is dev-only and the boot gate says so.
- **Ad rewards** in `ADS_MODE=admob` verify the SSV signature against Google's published key set,
  which is fetched on a cache miss and kept across a failed refresh (`ADMOB_VERIFIER_KEYS_JSON`
  pins it instead). Each callback's `transaction_id` is recorded in `AdRedemption` **inside the
  granting transaction**, so a replayed callback answers 409 and grants nothing; a verified
  callback that carries no transaction id is refused, because a reward that cannot be deduplicated
  can be replayed.
- **The day's LLM ceiling** (`LLM_DAILY_BUDGET_USD`, `apps/api/src/services/budget.ts`) wraps the
  gateway in both processes. Past it every generator throws, which every call site already handles
  as an outage: the player gets a fallback reply and their energy back. It counts `live` spend only
  — an imaginary budget is not a reason for a real outage — and reads the day's total from
  `GenerationLog`, the same rows the invoice is reconciled against. `GET /v1/cost/live` reports
  `budget: { limitUsd, spentUsd, remainingUsd, exhausted }`; a day that trips logs
  `msg:"llm.budget.exhausted"` **once**, so alert on that line.
- **Who reviewed this.** `ADMIN_TOKENS=rina:secret1,koji:secret2` gives every reviewer a revocable
  credential, and the name written to `World.reviewedBy` (and held by a review claim) comes from
  the secret that matched — the `x-reviewer` header is ignored. With the shared `ADMIN_TOKEN` there
  is no person to name, so decisions are recorded as `shared:<label>`: a queue that cannot name its
  reviewers looks like one instead of carrying names anybody past the gate could have typed.

## 5. The worker

```bash
pnpm --filter api worker                       # run the schedule (long-lived)
pnpm --filter api worker --once                # run every job once, then exit (0 = all clean)
pnpm --filter api worker --once=ambient-refill # one job, then exit
pnpm --filter api worker --jobs=offline-director,purge-login-codes
JOBS_DISABLED=bandit-update pnpm --filter api worker
```

The schedule is `JOBS` in `packages/shared/src/constants.ts` — the worker has no table of its own:

| job | cron (UTC) | what it does | tier |
|---|---|---|---|
| `offline-director` | `0 * * * *` | While-you-were-away digests for absent players (AIF-001) | **batch** (G10) |
| `memory-consolidate` | `*/30 * * * *` | folds memory notes into summaries (AIF-002) | **batch** (G7) |
| `ambient-refill` | `0 3 * * *` | tops the ambient post pool back up | **batch** (G2) |
| `purge-deleted` | `30 3 * * *` | hard-deletes accounts past the 30-day grace window (S1-1) | — |
| `purge-login-codes` | `*/15 * * * *` | expired login codes + old `JobRun` rows + the **Expo receipt second pass** | — |
| `bandit-update` | `15 * * * *` | `refreshBandit`: fold posteriors, guardrails, promotion, then refresh the allocator snapshot | — |

**The Batch tier (cost-architecture §5.4).** The three generative jobs run their batched variants —
half price, because nobody is waiting on them. `JOBS_BATCH=0` reverts all three to the interactive
composition; use it if a batch ever stalls (a batch may take up to 24 hours in live mode). The
interactive paths are still what serves `GET /v1/digest`, `GET /v1/memory/:characterId` and the E2E
hook `POST /v1/__test/run-job`, which cannot wait on a queue.

**Thompson sampling.** The API passes `banditAllocate` into the gateway at boot and warms the arm
snapshot; `bandit-update` refreshes it in whichever process runs the job. A snapshot is per-process
memory, so an API instance picks up promotions at its next restart (or the next time it runs the job
itself) — the arms move slowly by design (500 calls minimum before a promotion), so that is fine.

**Push receipts.** Expo fills delivery receipts in asynchronously, so the read inside `sendPush`
almost always comes back empty. `sendPush` records its ticket ids (`recordPushTickets`) and the
15-minute pass re-reads the settled ones, deletes every token reported `DeviceNotRegistered`, and
forgets tickets older than Expo's 24-hour retention.

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

## 6. Schema debt: paid

`JobRun` and `PushTicket` used to be created at runtime with `CREATE TABLE IF NOT EXISTS` and read
with raw SQL, because the schema was frozen for that pass — which meant `prisma migrate dev` wanted
to drop them on sight. The models and their migration exist now
(`20260904110536_job_runs_and_push_tickets`), and `jobs/runs.ts` / `jobs/push-receipts.ts` use
`prisma.jobRun` / `prisma.pushTicket`; `ensureJobRunTable()` and `ensurePushTicketTable()` are gone.

The one piece of raw SQL left in the job machinery is `pg_try_advisory_xact_lock`, which has no
Prisma equivalent and is the whole point of `withJobLock`.

`AdRedemption` (`20260910120000_ad_redemption`) is the nonce table behind the ad-reward grant.


## 7. Release checklist

1. `prisma migrate deploy` (once, before the new image takes traffic).
2. Roll the **API** — health check `/v1/health` (`db:"ok"`, 503 when the database is unreachable).
3. Roll the **worker** — check `GET /v1/jobs`: every job should show a recent `lastRun.ok = true`
   (or a `nextRunAt` in the future if it has not been due yet).
4. Smoke: sign in with a real email code (`POST /v1/auth/email/start` → **the address receives
   it**; a provider failure answers 502, so a 200 here means it was really handed over), post once,
   and confirm a `GenerationLog` row with a non-zero cost.
5. Read `GET /v1/cost/live` once: `budget.limitUsd` is the ceiling you set and `budget.exhausted`
   is false. Alert on `msg:"llm.budget.exhausted"` and on `msg:"mail.send.failed"` — the first
   means the product is serving fallbacks, the second means nobody can sign in.
