# Build notes (append-only)

## Agent C — requests to Agent A (posted early, 2026-09-04)

1. **SSE auth via query param (blocking for Web E2E).** Browsers' `EventSource` cannot send an
   `Authorization` header. Please accept `?token=<jwt>` (in addition to the bearer header) on the two
   stream routes: `GET /v1/posts/:id/stream` and `GET /v1/dms/:threadId/stream`. The web client sends
   `${streamUrl}?token=${jwt}`. Native uses the header.
2. **`streamUrl` shape.** The client accepts either an absolute URL or a path (`/v1/posts/:id/stream`
   or `/posts/:id/stream`); it joins relative paths onto `EXPO_PUBLIC_API_URL + /v1`. Prefer returning
   a path beginning with `/v1/` so it works unchanged across hosts.
3. **SSE frame format.** The client parses both shapes: (a) `data:` payload already carrying the
   discriminator (`{"type":"reply",...}`), and (b) named frames `event: reply` + `data: {"post":...}`
   (the discriminator is injected from the event name). Either is fine; (a) is preferred because it
   round-trips `PostStreamEventZ` / `DMStreamEventZ` verbatim.
4. **Email auth start endpoint.** `AuthEmailStartReqZ` exists in the contract but `spec/03-api.md` only
   lists `POST /auth/:provider`. The client calls `POST /v1/auth/email/start {email}` first and
   **ignores any failure** (404/405 tolerated), then `POST /v1/auth/email {email, code}`. If you name the
   start route differently, tell me in this file; the verify route must stay `POST /v1/auth/email`.
5. **CORS.** Web export is served from `http://localhost:8082`; keep `cors()` permissive and make sure
   it applies to the SSE routes too (`text/event-stream`).

## Agent D — E2E (Playwright) — 2026-09-04

### How to run
```
pnpm e2e                     # = pnpm --filter e2e test; globalSetup + both webServers + 16 P0 cases
pnpm --filter e2e test:headed
pnpm --filter e2e report     # opens e2e/playwright-report
pnpm --filter e2e typecheck
cd e2e && npx playwright test --list      # 16 P0 + 4 skipped P1 = 20
pnpm --filter e2e test:smoke              # config/webServer wiring only (skips db + export)
```
Escape hatches (all default off): `E2E_SKIP_DB=1` (skip reset/migrate/seed), `E2E_SKIP_EXPORT=1`
(serve the existing `apps/mobile/dist`), `E2E_SMOKE=1` (include `tests/smoke.spec.ts`, otherwise
`testIgnore`d so it does not pollute the case list), `API_URL` / `WEB_URL` / `API_PORT` / `WEB_PORT`,
`E2E_PROD_WEB_URL` (registers the extra `web-prod` project that runs only E2E-012 against an export
built without the ads flag; unset ⇒ project not registered, nothing is skipped).

`e2e/global-setup.ts` runs `scripts/db.sh start`, `scripts/db.sh reset`,
`pnpm --filter api exec prisma migrate deploy`, `pnpm --filter api seed` — all with
`DATABASE_URL=postgresql://postgres@127.0.0.1:5432/rpgllm_test`. **It drops `rpgllm_test`**, so do not
run `pnpm e2e` while your own vitest run is in flight.
API webServer env: `PORT=4000 DATABASE_URL=…/rpgllm_test TEST_HOOKS=1 LLM_MODE=replay BILLING_MODE=test
ADS_MODE=test LLM_REPLAY_LATENCY_MS=0 JWT_SECRET=test`; readiness probe `GET /v1/health`.
Web webServer: `node e2e/scripts/web.mjs` → `expo export -p web` with
`EXPO_PUBLIC_API_URL=http://localhost:4000 EXPO_PUBLIC_ADS_MODE=test EXPO_PUBLIC_BILLING_MODE=test`,
then `pnpm --filter mobile serve:web` on `WEB_PORT=8082`.
Config: chromium 1280×800, `fullyParallel:false`, `workers:1`, `retries:0`, `trace:"on-first-retry"`,
60s timeout, HTML report → `e2e/playwright-report`. Every test calls `POST /v1/__test/reset` in
`beforeEach` and uses a fresh `e2e+<random>@test.local` address.

### Requests to Agent A (apps/api)
1. **`GET /v1/__test/generations` (TEST_HOOKS only) — blocking for E2E-009/013/014.** There is no
   public endpoint for `GenerationLog` and three P0 cases assert on it. Please add, bearer-authed,
   scoped to the caller:
   `GET /v1/__test/generations?postId=&generator=&userId=` →
   `{data:{logs:[{id, generator, variantId, model, inputTokens, cacheReadTokens, cacheWriteTokens,
   outputTokens, costUsd, escalatedFrom, safetyVerdict, createdAt}]}, error:null}`
   (a bare `{data:[...]}` array is also accepted by the fixture). `?postId=` must match both the log
   that produced a post's replies (E2E-013 expects exactly one `G1` row for the user post) and the log
   attached to a single reply post (E2E-014 reads `?postId=<replyPostId>` and expects a row whose
   `escalatedFrom` equals the reply's previous `generationId`). `?generator=G8` is used by E2E-009 to
   count `safetyVerdict="block"` rows.
2. **`POST /v1/__test/reset` must keep the seed.** It has to truncate user data (User, Persona, Post,
   DMThread/Message, GenerationLog, Rating, Event, StatSnapshot, MemoryEntry, Wallet, Subscription,
   ExperimentAssignment) but leave (or immediately re-seed) `World`, `WorldCharacter` and the
   `AmbientPost` pool — every case re-runs onboarding after the reset.
3. **`costUsd > 0` in replay (E2E-013).** `PRICING["replay"]` is all zeros, but the spec asserts
   `costUsd > 0`. Price replay usage with the champion tier's real model row (`LLM_MODEL_*`), not the
   `replay` row. Same for the 4 token counts: `inputTokens > 0` and `outputTokens > 0` are asserted.
4. **Auth route naming.** The fixture posts `POST /v1/auth/email/start {email}` (failure tolerated),
   then tries `POST /v1/auth/email {email, code}` and falls back to `POST /v1/auth/email/verify` on
   404/405 — either naming works, matching Agent C's note above.
5. **Age gate.** `POST /v1/auth/age-gate` with an under-13 birth year must be **403 `UNDER_13`**, and
   `GET /v1/me` must stay **401** until the gate passes (E2E-001 asserts both).
6. **Status codes asserted:** 422 + `SAFETY_BLOCKED` on a blocked `POST /v1/posts` (E2E-009), 402
   `ENERGY_REQUIRED` on an empty tank, 200 + refund on LLM fallback (E2E-010).
7. `POST /v1/__test/time-travel {days:1}` is called with the user's bearer token and must make the
   next `/v1/wallet` read reflect the daily refill (E2E-015).
8. SSE `?token=` (Agent C's request 1) is needed for the browser to receive replies at all — every
   streaming case depends on it.

### Requests to Agent C (apps/mobile)
1. **Storage key `rpgllm.jwt`** — already matches `apps/mobile/src/auth/token.ts`. The suite seeds it
   with `page.addInitScript` before boot, so the app must read it on first render (no login round-trip).
2. **Every id in `testids.ts` must be a real `data-testid` on web.** Selectors the suite depends on:
   - a feed/thread cell is `data-testid="post-<id>"` and *contains* `post-kind-<kind>`, `post-text`,
     `post-author`. The id is parsed off that attribute, so no other element may use a `post-` prefix
     beyond those three.
   - a character reaction is either a cell with `post-kind-character` or a `reply-<id>` row
     (`reply-btn` is excluded by name).
   - `energy-badge` / `energy-value` must contain the number as digits (first integer in the text is
     parsed); `energy-badge` opens SCR-032.
   - `event-choice-<i>` is **0-based**; E2E-005 clicks index 1 ("Drop receipts").
   - `rate-down-<id>`: the suite tries the reply's post id, then its `generationId`, then any
     `rate-down-*` inside the reply cell. Post id preferred.
3. **`globalThis.__ADS_MODE`** (already in `src/env.ts`) is how E2E-012 reproduces a production web
   build inside the ads-enabled export: it sets `"off"` via `addInitScript` and asserts `watch-ad`
   has count 0 on SCR-032 while `get-plus` is still visible. Please keep that override.
4. **`globalThis.__lastAdRequest = { npa: boolean }`** must be set at ad *load* (on the `watch-ad`
   click), before the reward call. E2E-016 asserts `npa === true` for a 16-year-old.
5. **E2E-007 requires the deferred post to auto-send**: composing with energy 0 opens SCR-032; after
   the rewarded ad completes, the modal closes *and the pending post is submitted* without retyping.
6. **`dm-typing`** must render as soon as Send is pressed (before TTFT) — `LLM_REPLAY_LATENCY_MS=0`
   makes a server-driven-only indicator unobservable. **`dm-affinity`** must re-render when the SSE
   `affinity` event arrives (E2E-006 asserts its text changes).
7. **`safety-error`** shows `t(locale,"safetyBlocked")` inline and the composer stays open with the
   text intact; **`fallback-toast`** shows `t(locale,"fallbackNotice")`.
8. Routes assumed: `/auth`, `/onboarding/scenario`, `/feed`, `/post/[id]`, `/energy`, `/dms`. Booting
   `/` with a valid token and no persona must land on SCR-003 (the suite falls back to
   `/onboarding/scenario` if it does not, but E2E-002 reads better without the fallback).
9. Onboarding must seed exactly **5 ambient posts + 1 welcome post from @hivequeenbea** (E2E-002).

### Requests to Agent B (packages/llm)
- Replay fixtures must be **locale-keyed**: E2E-011 asserts a character reply to 「新曲、金曜に出します」
  contains CJK. G1 must return ≥2 replies for a first post (E2E-003 asserts ≥2 within 5s).
- `LLM_MODE=fail` (set at runtime via `POST /v1/__test/llm-mode`) must still yield canned per-character
  replies + `fallback:true` so E2E-010 sees new character posts, a fallback toast and no charge.
- G8 in replay blocks on `SAFETY_BLOCK_TEST_PHRASES` (all 20, EN and JA) and logs `verdict=block`.

### Deviations / decisions
- **No `test.skip` on any P0 case** (CLAUDE.md rule 3). The brief suggested skipping E2E-012 when no
  prod export exists; instead E2E-012 always runs in `chromium` and turns ads off through the runtime
  `__ADS_MODE` override, and the optional `web-prod` project is simply not registered unless
  `E2E_PROD_WEB_URL` is set. P1 cases E2E-017/018/019/020 are `test.skip` stubs so they show in the report.
- No `waitForTimeout` anywhere; all waiting is `expect`/`expect.poll` with explicit budgets
  (1.5s first reply, 5s second reply, 1s event result, 2s regeneration, 10s feed after Enter the world).
