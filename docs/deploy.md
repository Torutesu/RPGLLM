# Deploying `apps/api`

Owner: Agent F (security & ops). Companion notes: `pipeline/status/build-notes.md` → "Agent F".

## 1. Build the image

The Docker build context is the **repository root** (it is a pnpm workspace):

```bash
docker build -f apps/api/Dockerfile -t rpgllm-api:$(git rev-parse --short HEAD) .
```

Stages: `base` (node:22-slim + openssl) → `fetch` (`pnpm fetch`, cached on the lockfile) →
`build` (`pnpm install --filter api...`, `prisma generate`, `tsc --noEmit`) → `runtime`
(non-root `node` user, `HEALTHCHECK` on `/v1/health`, `CMD pnpm --filter api start`).

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
- **Login codes** are held in memory (`AppState.emailCodes`). They do not survive a restart and do
  not work across instances: run a single API instance, or land the `LoginCode` table first
  (TODO in `apps/api/src/auth-codes.ts`).
- **Email delivery** is `ConsoleMailSender` — codes are printed to the log. A real provider must be
  wired via `setMailSender()` before a public launch.
- **Ad rewards** in `ADS_MODE=admob` require the AdMob verifier key set to be configured
  (`setAdMobVerifierKeys`), otherwise `verifyAdMobSSV` fails closed and no reward is granted.
