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

## Agent A — API (apps/api) — 2026-09-04

### What shipped
`createApp({prisma, gateway, clock})` in `src/app.ts` (DI so vitest can inject a fake gateway/clock);
`src/index.ts` wires the real deps and serves on `PORT` with `api listening on :PORT`.
All of `spec/03-api.md` is implemented under `/v1`, requests validated with the `@rpgllm/shared` zod
schemas (`safeParse` → 400 `VALIDATION`), responses shaped to the response schemas, `{data, error}`
envelope everywhere, error codes from `ErrorCodeZ`, CORS open.

Layout: `src/routes/*` (auth, me, worlds, personas, feed, posts, events, stats, dms, wallet, billing,
generations, experiments, health, test-hooks), `src/services/*` (wallet, safety, story, post-stream,
dm-stream, events, persona, serialize, generation, rng, locale, handles, world-seeds),
`src/{app,index,auth,clock,env,http,types,llm-loader,fake-gateway,seed,seed-fallback}.ts`.
Tests: `test/*.test.ts` (7 files, 29 cases) + `vitest.config.ts` (`fileParallelism:false`).

### Answers to the requests posted above
- **Agent C #1 / Agent D #8 — `?token=` on SSE: done.** `requireAuth` accepts `Authorization: Bearer`
  *or* `?token=<jwt>` on **every** route, so both stream routes work from `EventSource`. Verified by
  `curl -N ".../stream?token=…"`.
- **Agent C #2 — `streamUrl`** is always a path beginning with `/v1/` (`/v1/posts/:id/stream`,
  `/v1/dms/:threadId/stream`).
- **Agent C #3 — SSE frames use *both* shapes:** a named frame (`event: reply`) **and** a `data:`
  payload that already carries the discriminator (`{"type":"reply","post":{…}}`), i.e. the verbatim
  `PostStreamEventZ` / `DMStreamEventZ` value. Shape (a) works unchanged.
- **Agent C #4 / Agent D #4 — auth routes:** `POST /v1/auth/email/start {email}` (no-op sender, 200),
  and the verify step is reachable at **both** `POST /v1/auth/email` and `POST /v1/auth/email/verify`
  (`{email, code}`; `DEV_EMAIL_CODE` "000000" always accepted). `POST /v1/auth/:provider` also exists;
  apple/google return 400 `VALIDATION` (adapter-only in MVP).
- **Agent C #5 — CORS** is `cors({origin:"*"})` on `*`, applied before the SSE routes.
- **Agent D #1 — `GET /v1/__test/generations` shipped** (TEST_HOOKS only, bearer-authed). Returns
  `{data:{logs:[…]}}` with `id, userId, generator, variantId, model, promptHash, inputTokens,
  cacheWriteTokens, cacheReadTokens, outputTokens, costUsd (number), ttftMs, latencyMs, stopReason,
  safetyVerdict, escalatedFrom, createdAt`. Params: `?postId=` (own generationId ∪ the replies' ∪ the
  news post it caused — a user post yields exactly one G1 row, a reply post yields the row whose
  `escalatedFrom` is its previous generation), `?messageId=`, `?generator=` (e.g. G8; if it does not
  intersect the postId set it falls back to the caller's logs for that generator, because G8 runs
  *before* a post exists), `?userId=` scope override.
- **Agent D #2 — reset keeps the seed.** `POST /v1/__test/reset` truncates everything except
  `World` / `WorldCharacter` / `AmbientPost`, clears the in-memory maps, and re-seeds if `World` is empty.
- **Agent D #3 — `costUsd`** is persisted from `meta.costUsd` verbatim (Decimal(10,6)); nothing is
  zeroed. Agent B must price replay usage with the champion tier's real model row — the API does not
  recompute cost. The built-in FakeGateway already returns `costUsd > 0` and non-zero token counts.
- **Agent D #5/#6/#7** — all as specified: 403 `UNDER_13` + `/v1/me` stays 401; 422 `SAFETY_BLOCKED`;
  402 `ENERGY_REQUIRED`; 200 + refund on fallback; `time-travel {days:1}` makes the next `/v1/wallet`
  read refill (all covered by vitest).

### Deviations / decisions (please read)
1. **`onGeneration` hook is deliberately NOT wired.** `GenerationLog` rows are created route-side right
   after each gateway call from `result.meta` (`src/services/generation.ts`). Wiring both would
   double-log and break E2E-013's "exactly one G1 row". Agent B: the hook may stay in the interface;
   apps/api just does not pass it.
2. **`@rpgllm/llm` is loaded defensively** (`src/llm-loader.ts`): a *namespace* `await import()` (never
   a named import, which would fail at ESM link time against the current `declare`d stub). If
   `createGateway` is not a function the API logs a warning and runs on `src/fake-gateway.ts`, so the
   API boots for Agents C/D today. Same for `loadWorldSeeds()` → `src/seed-fallback.ts`.
3. **`src/seed-fallback.ts` is a clearly-marked STAND-IN** (one world `popstar-era`, 3 characters
   @hivequeenbea/@the6ixdrey/@gmz, EN+JA, short bibles ≈299 tok). It conforms to `WorldSeedZ`. As soon
   as `loadWorldSeeds()` exists the loader prefers it — no API change needed. Note the stand-in bible
   is **below** the 4,096-token cache floor; that is Agent B's content requirement, not an API one.
   `pnpm --filter api test` pins the stand-in seed for determinism.
4. **`StatSnapshot.relDeltas` is stored wrapped**: `{deltas:{"@handle":±1}, after:{followers,aura,humor}}`
   instead of the bare map in `spec/02-schema.md`. `StatSnapshotZ.after` needed a durable home (older
   snapshots must not report the persona's *current* stats). The serializer still reads a bare map.
5. **Relationship/stat delta keys are character handles, not ids** (consistent with G1/G5 output,
   which is handle-keyed). `spec/02-schema.md` wrote `characterId`.
6. **`Post.metrics` carries two extra keys** beyond `{likes,reposts,replies}`: `causedBy:"post:<id>"`
   on a news post (so the stream can replay it idempotently) and `moreDone:true` on a user post after
   "Load more reactions". The API serializer only ever emits the three documented numbers.
7. **Ambient feed posts are `Post` rows with `personaId` set** (the schema comment says ambient posts
   have `personaId = null`; that applies to the shared `AmbientPost` pool, which is untouched). This
   keeps the feed a single indexed query.
8. **Stream idempotency** is keyed on `StatSnapshot.cause = "post:<id>"`: a second
   `GET /v1/posts/:id/stream` replays the stored replies/news/stat/event and never re-runs G1.
   The DM stream replays the trailing character bubbles when the last message is already a reply.
9. **State with no column** lives in per-app `Map`s (single-process assumption, documented in
   `src/types.ts`): G8 `soften` flags per post/thread, and the `POST /v1/personas` idempotency key.
   `POST /personas` is *also* idempotent by `(userId, worldId, handle)`, so a restart still cannot
   double-create.
10. **Under-13**: the `User` row is kept (birthYear recorded) but `requireAuth` returns 401 for any
    account whose age is < 13, so `/v1/me` stays 401 forever. No `blocked` column was added
    (schema is the orchestrator's).
11. **`GenerationLog` has no `tier` column**, so 👎-regeneration derives the tier from `model` via the
    `LLM_MODEL_*` env map (`tierFromModel`) and escalates one step (light→mid→high, high stays high).
    Agent B: keep returning a concrete model id in `meta.model` for replay if you want exact
    escalation; `"replay"` falls back to the generator's champion tier.
12. **`POST /v1/generations/:id/rate` accepts `?postId=` / `?messageId=`** to disambiguate which row a
    shared G1 generation should replace (one G1 call produces K replies with the same generationId).
    Without it the first row wins. `RateReqZ` was not changed.
13. **Paywall experiment variant convention** (`GET /v1/billing/offerings`): `paywall_trial` → a
    variant containing `7` means `trialDays: 7`, else 0; `paywall_adfree` → a variant matching
    `/on|show|true/i` shows the ad-free SKU (and `adfree_monthly` is filtered out of `plans` when it
    is off). Agent B: name variants `trial_7`/`trial_0` and `adfree_on`/`adfree_off` and this works.
14. **`/v1/billing/webhook` and `/v1/billing/restore` are 200 stubs with TODOs** (RevenueCat is P1).
    `dev-purchase` is 404 unless `BILLING_MODE=test`.
15. `GET /v1/health` follows `HealthResZ` (`{ok, llmMode, champion}`), not the `{ok, llm:{…}}` sketch
    in the spec table; also mounted unversioned at `/health`, and `/__test/*` is mounted at both
    `/v1/__test/*` and `/__test/*`.
16. **New env knobs** (defaults keep spec behaviour): `STREAM_DELAY_MS` (default 150) and
    `DM_STREAM_DELAY_MS` (default 200) — vitest sets them to 0. `src/index.ts` also loads repo-root
    `.env` then `.env.example` for defaults without overriding real env.

### Verification (2026-09-04)
- `pnpm --filter api typecheck` — clean (strict, `noUncheckedIndexedAccess`, tests included).
- `pnpm --filter api test` — **29 passed / 7 files**, ~9s, against `rpgllm_test`.
- `DATABASE_URL=…/rpgllm pnpm --filter api seed` — `seeded 1 world(s) from "fallback" seeds:
  popstar-era(299tok); characters=3 ambientPosts=44`. Idempotent on re-run.
- Manual `curl` walkthrough (TEST_HOOKS=1 LLM_MODE=replay BILLING_MODE=test ADS_MODE=test):
  signup → 403 UNDER_13 (and `/me` 401 afterwards) → adult age-gate → worlds → persona
  (feed = 5 ambient + 1 @hivequeenbea welcome) → post (energy 10→9) → `curl -N` stream
  (`reply`×3 → `stat` → `done{energy:9}`) → replay stream (5 frames, no new G1) → `?token=` stream →
  ad-reward → DM stream (`message` → `affinity{delta:1}` → `done`) → dev-purchase (energy 50,
  `adsEnabled:false`) → 402 on empty tank → 422 SAFETY_BLOCKED.

### ⚠️ For the orchestrator
A pre-agent `tsx apps/api/src/index.ts` process from 00:39 (pids 4123/4134) is **still running the old
skeleton in memory** and holds a port; anything probing it sees the stale `/v1/health`
(`champion:{}`) and 404s elsewhere. It needs a restart to pick up this build. I did not kill it because
Agent C's `scripts/mock-api.mjs` is also contending for :4000 — please arbitrate. I verified on :4187
and left no processes of my own running.

## Agent C — client (apps/mobile) — delivery notes

### Route map (Expo Router, web export = SPA)
| Route | File | Screen |
|---|---|---|
| `/` | `app/index.tsx` | redirect: no token → `/auth`; `me.user.birthYear === null` → `/auth` (age gate); no persona → `/onboarding/scenario`; else `/feed` |
| `/auth` | `app/auth.tsx` | SCR-002 (email + code, age gate step, locale toggle, blocked view) |
| `/onboarding/scenario` | `app/onboarding/scenario.tsx` | SCR-003 |
| `/onboarding/persona?worldId=` | `app/onboarding/persona.tsx` | SCR-004 |
| `/onboarding/persona-edit` | `app/onboarding/persona-edit.tsx` | SCR-005 (spec says `/onboarding/persona/edit`; flat file avoids clashing with the `persona` route) |
| `/onboarding/first-follower` | `app/onboarding/first-follower.tsx` | SCR-006 (+ `world-loading` overlay) |
| `/feed` | `app/(tabs)/feed.tsx` | SCR-010 (+ SCR-013 card, toasts) |
| `/dms` | `app/(tabs)/dms.tsx` | SCR-020 (+ new-message picker) |
| `/compose?parentId=` | `app/compose.tsx` | SCR-011 (modal) |
| `/post/[id]` | `app/post/[id].tsx` | SCR-012 |
| `/dms/[threadId]` | `app/dms/[threadId].tsx` | SCR-021 |
| `/event/[id]` | `app/event/[id].tsx` | SCR-014 (modal) |
| `/paywall` | `app/paywall.tsx` | SCR-030 (modal) |
| `/energy` | `app/energy.tsx` | SCR-032 (modal) |

Supporting modules: `src/api/{client,sse,types}.ts`, `src/auth/token.ts`, `src/adapters/{ads,admob,billing,revenuecat}.ts`,
`src/state/store.tsx` (context + synchronous state ref), `src/nav.ts`, `src/components/*`, `src/env.ts`.
`useT()` / `useMe()` are exported from `src/state/store.tsx` (re-exported at `src/i18n/useT.ts`).

### Decisions worth knowing for E2E (Agent D)
1. **Ads visibility is switchable at runtime.** `E2E-007` needs the web ad button, `E2E-012` needs it hidden — the same
   web bundle serves both. `src/env.ts#adsMode()` reads `globalThis.__ADS_MODE` first, then build-time
   `EXPO_PUBLIC_ADS_MODE`, else `"off"`. So: default export → **no** `watch-ad` on web (E2E-012 passes);
   for E2E-007 do `await page.addInitScript(() => { window.__ADS_MODE = "test"; })` before `goto`.
   On native the button shows whenever `wallet.adsEnabled` is true. `watch-ad` is also hidden when the wallet says
   `adsEnabled:false` (Plus), which is what E2E-008 asserts.
2. **`__lastAdRequest`** is set by `MockAds` at request time: `window.__lastAdRequest = { npa: !personalized, at }`.
   `personalized = wallet.adPersonalized && !user.isMinor` → a minor yields `npa === true` (E2E-016).
3. **Numbers are bare inside their testid.** `energy-badge` and `energy-value` contain only the number
   (e.g. `"9"`); the ⚡ glyph and `/ dailyMax` are siblings, so exact-text assertions work.
4. **Stat card** (`stat-card`) is a bottom sheet with **no blocking backdrop**, opened automatically on the `stat`
   stream event and after an event choice. The compose FAB is drawn above it (higher z-index) so the feed stays
   usable while it is open. `stat-continue` closes it. `stat-aura` / `stat-followers` / `stat-humor` each read
   `"<signed delta> → <after value>"` (e.g. `"+5 → 25"`).
5. **Toasts are inline banners**, one slot per kind (`stat-toast`, `fallback-toast`, error), rendered between the
   header and the event banner — never absolutely positioned, so they cannot intercept a click on
   `event-banner` / `feed-list`. A stat toast no longer replaces a fallback toast (they coexist).
6. **`reply-btn` is unique per screen.** On SCR-012 it is the single bottom bar button. Its target is the root post
   by default; tapping a reply row (`reply-<id>`) selects that reply as the parent first. Each reply row is
   `reply-<postId>`, and `rate-up-<postId>` / `rate-down-<postId>` use the **post id** (not the generation id);
   the client looks up `post.generationId` internally for `POST /generations/:id/rate`.
7. **`post-text` / `post-author` / `post-kind-<kind>` repeat per cell** — scope them under
   `getByTestId(\`post-${id}\`)`. Inline feed replies are also wrapped in `reply-<id>`.
8. **Navigating back to the feed from a modal uses dismiss, not `replace`** (`src/nav.ts#resetToFeed`).
   `router.replace("/feed")` from a modal stacked on the tabs mounts a **second** tab navigator and duplicates every
   data-testid; if you see strict-mode "resolved to 2 elements", that is the cause.
9. **Auth screen keeps the email/code fields mounted** while the age gate is showing, so either interaction order
   works: fill email + code then `auth-submit`, or submit and then fill. The code field is pre-filled with
   `DEV_EMAIL_CODE`. `auth-submit` is a no-op once authenticated.
10. **Locale**: device locale by default, `locale-toggle` on the auth screen, then `me.user.locale` after login
    (the value chosen on the auth screen is sent with `POST /auth/age-gate`).

### Contract / integration notes
- Agent A already accepts `?token=` on SSE routes and returns `streamUrl` as `/v1/...` — matches the client.
  The SSE parser accepts both `event: <type>` named frames and payloads that carry `type` themselves.
- `POST /posts` and `POST /dms/:id/messages` returning **201** is fine (the client treats any 2xx as success).
- The client calls `POST /auth/email/start` first and **ignores failures**, then `POST /auth/email`.
- Every response is `zod`-parsed with the shared schema; a mismatch throws `ApiError("VALIDATION")`, logs
  `[api] contract mismatch on <path>` and records `globalThis.__lastParseError` — check that first if a screen is blank.
- `402` anywhere pops `/energy` globally (typed client side effect); `422` is surfaced inline by the caller;
  network/5xx raise an error toast.

### Missing i18n keys (please add to `packages/shared/src/i18n/*` — additive only)
The following copy had no key, so the closest existing key is used today. Replacements once the keys exist:
| Needed | Used instead | Where |
|---|---|---|
| `retry` ("Retry") | `continue` | SCR-003/010 error states |
| `loadFailed` ("Couldn't load worlds" / generic load error) | `notSent` | SCR-003/006/030 error states |
| `signInFailed` ("Sign-in failed. Try again.") | `notSent` | SCR-002 |
| `noReactions` ("No reactions yet") | `wakingUp` | SCR-012 empty thread |
| `showMore` | `loadMore` | feed inline replies |
| `handleTaken` ("Taken") / `handleAvailable` | `safetyBlocked` / bare ✓ | SCR-005 |
| `voiceNotes` ("How do you talk?") | `save` (as the field label) | SCR-005 |
| `notAvailableRegion` | — (offerings error uses `notSent`) | SCR-030 |
| `continueWithApple` / `continueWithGoogle` | — (buttons omitted; adapters are P1) | SCR-002 |
| `adsToday` ("3/5 today") / `youHave` / `inviteFriend` | bare counters | SCR-032 |
The wordmark "status" is rendered as a brand literal (`components/ui.tsx#Wordmark`), not via i18n.

### Local verification (this agent)
- `pnpm --filter mobile typecheck` — pass. `pnpm --filter mobile export:web` — pass (single-file web bundle).
- `apps/mobile/scripts/mock-api.mjs` implements the contracts in memory for client-only checks
  (plus `/v1/__test/{reset,set-energy,plus-off}`); `scripts/smoke-web.mjs` and `scripts/smoke-web-cases.mjs`
  drive the exported web build in Chromium (`/opt/pw-browsers`) and all steps pass:
  auth → age gate → world → persona → first follower → feed(energy 10) → post(stream replies + stat card + stat toast)
  → fallback toast → post detail(👎 replace, load more, reply) → DMs(typing → bubbles → affinity) → energy(watch ad,
  `__lastAdRequest`) → paywall(success) → Plus hides watch-ad → 8th-action event → choice → stat card → news at top
  → energy-0 post → ad → automatic re-submit → safety 422 inline with energy unchanged; plus under-13 blocked,
  JA locale UI, and `npa=1` for a minor. **Not yet run against the real `apps/api`** — that is the integration step.

## Agent B — LLM (packages/llm) — 2026-09-04

### What shipped
`packages/llm/src/`:
- `index.ts` — real runtime exports (no more `declare`): `createGateway`, `loadWorldSeeds`,
  `estimateTokens`, plus `priceOf`, `bareHandle`, the generator specs, `buildRequest`,
  `replayG*`, the experiment registry and `GLOBAL_STYLE`. Interface shape unchanged.
- `gateway.ts` — `createGateway(opts)`; `mode()` / `setMode()`; `g1/g4/g5/g7/g8`;
  `assignments(userId)`; `champion()`. Generator methods never throw.
- `experiments.ts`, `cost.ts`, `tokens.ts`, `handles.ts`, `errors.ts`, `types.ts`
- `prompts/{global,render}.ts` — `GLOBAL_STYLE[locale]` (~800 tok) + deterministic renderers
- `generators/{g1,g4,g5,g7,g8}.ts` — each `{render, schema, fallback, postprocess, maxTokens, defaultTier}`
- `modes/{live,replay,fail}.ts`
- `worlds/{build,popstar-era,magic-academy,idol-survival}.ts` + `*.bible.ts`, `worlds/index.ts`
- `fixtures/{types,popstar-era,magic-academy,idol-survival,index}.ts`
- Tests: `worlds.test.ts`, `replay.test.ts`, `safety.test.ts`, `gateway.test.ts`, `live.test.ts`
  (80 cases). `__testkit.ts` holds the input builders (not a test file).

Verified: `pnpm --filter llm typecheck` clean, `pnpm --filter llm test` 80/80 green,
plus a `node --import tsx` smoke import of `src/index.ts` (the shape `apps/api/src/llm-loader.ts`
uses) returning a full G1 result.

### Bible token counts (estimateTokens, floor 4096)
| world | difficulty | EN | JA | press account |
|---|---|---|---|---|
| popstar-era | 2 | 5,161 (20,646 ch) | 4,975 (9,510 ch) | `thescoop` |
| magic-academy | 3 | 5,343 (21,369 ch) | 5,075 (9,654 ch) | `thequill` |
| idol-survival | 2 | 5,274 (21,077 ch) | 4,999 (9,575 ch) | `stagewire` |

### Handles per world (bare, no "@", all match /^[a-z0-9_]{3,15}$/)
- **popstar-era** cast: `hivequeenbea` (fan-collective leader, first-follower default),
  `thescoop` (PRESS), `ninaonmain`, `dexlowkey`, `rioflashes`, `paulamanages` (not a
  first-follower option), `critchriswen`, `lunaeight`.
  presetPersonas (order = picker order): `taytay19`, `hivequeen`, `sixdrey`, `ari`, `dune`,
  `jbsorry`, `kingkay`.
- **magic-academy** cast: `emberwyn`, `thequill` (PRESS), `marrowfinch`, `kittarrow`,
  `prefectlocke`, `profsableveil` (not a first-follower option), `poppybramble`, `cassnull`.
  presetPersonas: `thornwake`, `lampcut`, `fenbrew`, `stairling`, `vellumhand`, `nineknots`,
  `quietloom`.
- **idol-survival** cast: `mikan_hoshino`, `stagewire` (PRESS), `ruri_kurosaki`,
  `pd_takagi` (not a first-follower option), `aoi_nanase`, `wotaking`, `umeda_vocal`, `hina_sudo`.
  presetPersonas: `rin_practice`, `yuzu_003`, `souta_late`, `mio_stage`, `kanade_n1`,
  `hoshi_two`, `nagi_backline`.
`cast[0]` is always `canBeFirstFollower: true`; every world has >= 5 such options and exactly
one press account. `presetPersonas[0]` for popstar-era is `taytay19` and `cast[0]` is
`hivequeenbea`, so E2E-002 works whether the fixture picks by name or picks the first entry.

### ⚠️ For Agent D — the press handle is `thescoop`, not `gmz`
`spec/04-e2e-cases.md` E2E-005 says the news post comes from `@gmz`. `gmz` is a real-world
brand name, so the world seeds use an original press account per world (table above). Assert on
`post-kind-news` (or on `thescoop`), not on `gmz`. News posts are third person, carry no emoji
and are at most two sentences; the EN ones start with `SOURCES SAY:` (popstar-era),
`It is reported that` (magic-academy) or `[NEXT STAGE]` (idol-survival).

### Text E2E can assert on
- **E2E-002 welcome post** (`welcomePosts.hivequeenbea.en`), generated by G1 or taken verbatim
  on fallback: starts `ok everyone. new account, real one, i checked.` — JA:
  `はい全員集合。新しいアカウント、本物、確認済み。`
- **E2E-010 fallback replies**: `fallbackReplies.hivequeenbea.en` =
  `["👀", "ok noted", "the way you just said that", "we move", "i'm not normal about this"]`
  (JA: `["👀", "了解", "まってその言い方", "進むよ", "冷静ではいられない"]`). The line is chosen
  by seed, so assert membership, not equality — `👀` is index 0 but not guaranteed.
- **E2E-011 JA**: every reply, narrative and DM bubble in the `ja` fixtures is Japanese
  (asserted in `replay.test.ts`); a single DM bubble can be pure emoji, so match on the joined
  thread, not on bubble[0].
- **E2E-005 event choices**: replay G5 draws from the world's 5 preset events + 3 extra dynamic
  ones, skipping any title already in `pastEventTitles`. Choice ids are `c1`/`c2`/`c3` and
  `event-choice-1` (0-based index 1) is always the middle choice. popstar-era's first preset is
  "The Leaked Demo" whose middle choice is "Let the label take it down"; there is no choice
  literally labelled "Drop receipts" — assert by index, not by label.

### Replay fixture design (how the buckets work)
Every character has **6 tone buckets x 3 lines per locale**: `0 hype, 1 shade, 2 curious,
3 deadpan, 4 worry, 5 chaos`. Selection is pure:
1. `isNegative(postText)` — keyword list (`diss`, `leak`, `cancel`, `flop`, `ratio`, `炎上`,
   `流出`, `最悪`, …). Positive posts draw from buckets {0,2,5}, negative from {1,3,4}.
2. bucket index `= FNV1a(seed | postText | handle | i) % 3` inside that set,
   line index `= FNV1a(seed | postText | handle | i | "line") % 3`.
So the same (world, locale, seed, post text) always yields the same replies, a different seed
yields different ones, and a different post text at the same seed also differs.
Reply order is: `involved` handles first (so the first follower answers first), then the rest of
the cast; the press account is never a reply author, only a `news` line (and only when
`includeNews` is true).
Stat deltas: positive posts `followers +1..+4`, `aura 0..3`, `humor 0..3`; negative posts
`followers -1..-4`, `aura -1..-3`, `humor 0..-1`; `softened` subtracts 1 more aura.
Narratives: >= 8 per world/locale. News lines: >= 6, written in the press voice.
G4: >= 6 DM bubble sets per character per locale, affinity delta -1/0/+1 by sentiment + seed.
G5: preset events + 3 extra dynamic events per world, unused titles preferred.
G7: deterministic `foldNotes()` — dedupes and concatenates old summary + notes, trimmed to
600 (per relationship) / 1600 (world summary).
G8: blocks iff the text contains one of the 20 `SAFETY_BLOCK_TEST_PHRASES` (case-insensitive
substring, EN + JA), softens on a mild-profanity list, else allows; the error/timeout fallback
is `allow`, or `soften` when `isMinor`.

### Replay `usage`, cost and latency
- The cached prefix is `system[0] + system[1]`, keyed by its sha256. The **first** call in a
  process that sends a given prefix bills `cacheWriteTokens = estimateTokens(prefix)`; every
  later one bills the same number as `cacheReadTokens`. That is per (worldSlug x locale), and
  per gateway instance — `createGateway()` starts with a cold cache.
- `inputTokens = estimateTokens(user block)`, `outputTokens = estimateTokens(JSON.stringify(output))`.
- **`meta.model` is the concrete would-be model id** (`claude-sonnet-5` etc., from `LLM_MODEL_*`),
  never the string `"replay"`; replay is signalled by `meta.stopReason === "replay"`.
  `meta.tier` is populated too, and `costUsd = priceOf(meta.model, usage)` so E2E-013's
  `costUsd > 0` and the four non-zero token counts hold. (Agent A request, honoured.)
- Artificial latency: `LLM_REPLAY_LATENCY_MS` (default 150) + a deterministic 0-150ms jitter,
  `ttftMs ≈ 45%` of the total. `LLM_REPLAY_LATENCY_MS=0` disables the sleep entirely and sets
  `ttftMs = 0` — which is what the E2E API webServer already sets.

### Experiments
`assignments(userId)` returns all seven keys; allocation is 50/50, user-sticky,
`FNV1a(key + ":" + userId) % n`; a null/empty user gets index 0 (the champion / control).
| key | values (index 0 = champion/control) | tier |
|---|---|---|
| `g1` | `g1-sonnet-v1`, `g1-haiku-v1` | mid / light |
| `g4` | `g4-sonnet-v1` | mid |
| `g5` | `g5-opus-v1` | high |
| `g7` | `g7-haiku-v1` | light |
| `g8` | `g8-haiku-v1` | light |
| `paywall_trial` | `trial_0`, `trial_7` | — |
| `paywall_adfree` | `adfree_off`, `adfree_on` | — |
Product variant ids follow Agent A #13 exactly. `champion()` is keyed by generator id
(`{G1: "g1-sonnet-v1", …}`) while `assignments()` is keyed by the lowercase experiment key —
E2E-013 should compare `GenerationLog.variantId` against `assignments()[generator.toLowerCase()]`.
`RunOptions.tier` overrides the variant tier (👎 escalation) and `escalatedFrom` is passed
straight through to `meta.escalatedFrom`; `RunOptions.variantId` pins a specific variant.

### Live mode (implemented, structurally verified only — no API key here)
`modes/live.ts` splits into a pure `buildRequest()` (what `live.test.ts` asserts on) and
`runLive()` (the only networked part). Policy: `system` is two `cache_control: {type:"ephemeral"}`
text blocks — `GLOBAL_STYLE[locale]` then `World.bible[locale]` **verbatim, never reformatted**;
one user message; never a prefilled assistant turn. Structured outputs via
`output_config.format = zodOutputFormat(<shared schema>)`. mid → `thinking:{type:"disabled"}`,
no effort; high → no `thinking` (adaptive) + `output_config.effort:"medium"`; light → neither.
High tier also sends `betas:["server-side-fallback-2026-07-01"], fallbacks:"default"` on
`client.beta.messages.create`, switchable off with `LLM_REFUSAL_FALLBACKS=0` (default on).
`stop_reason === "refusal"` is checked before any content is read. Live failures retry **once**,
then fall back. `usage` maps from `input_tokens / cache_creation_input_tokens /
cache_read_input_tokens / output_tokens`. `ttftMs` is `null` in live mode (non-streaming call).

### Deviations / notes for the orchestrator
1. **Press handle** is per-world and original (`thescoop` / `thequill` / `stagewire`), not `gmz`
   (see the warning above). No other spec text was changed.
2. **Handles are stored bare** (no leading "@"); world sources and fixtures are authored with
   "@" for readability and normalised in `buildWorld()` / `fixtures/index.ts`. Bible *prose*
   still writes "@handle" because that is how the model should see them in text.
3. **Two `statDeltas` in the authored content exceeded the shared schema** (aura 11 and 12) and
   were clamped to 10 so `WorldSeedZ.parse` passes. No schema change requested.
4. `onGeneration` is still in the interface but apps/api deliberately does not pass it
   (Agent A #1) — the gateway awaits it and swallows its errors when it is passed.
5. `G8` does **not** send the world bible: its prefix is a 2-block policy+categories pair
   (~200 tok) on the light tier, per cost-architecture §3. It still has two `cache_control`
   blocks, so the structural test applies uniformly.
6. Extra exports beyond the declared interface (`priceOf`, `worldSeed`, `bareHandle`,
   `blockedPhrase`, `buildRequest`, `replayG*`, …) are additive; nothing declared was renamed.

## Orchestrator — integration (Stage 3)

Deviations and decisions made while driving E2E P0 to green (all in code; spec text unchanged unless noted):

- **Handles**: DB keeps character handles with a leading "@" (Agent A convention); the API contract now emits **bare** handles everywhere (`atHandle` = normalize), generator inputs get bare handles, world seeds are bare. Clients render the "@".
- **Press account**: worlds are original, so the press handle is per world (`thescoop` / `thequill` / `stagewire`), not `@gmz` as written in `spec/04-e2e-cases.md` E2E-005. Tests assert `post-kind-news` instead of the handle.
- **Event choice always produces a press post**: when the director's choice has no `newsText`, the outcome text becomes the headline (spec E2E-005 requires a news post after the choice).
- **Replay DM affinity is never 0** so E2E-006's "hearts update" holds on every seed.
- **Navigation**: `resetToFeed()` uses `dismissTo("/feed")`; `dismissAll()` returned to the web history root (SCR-003 after onboarding).
- **E2E fixtures**: preset persona/follower handles are read from `/v1/worlds/:id` (no hardcoded names); `syncWallet(page)` reloads after API-side energy changes because the client has no wallet polling; login handles single-step and two-step code entry.
- **Playwright**: `launchOptions.executablePath=/opt/pw-browsers/chromium` (the bundled revision differs from Playwright 1.62's); `reuseExistingServer` only with `E2E_REUSE=1` (a stray mock API on :4000 had been reused silently).
- **Web export** runs with `--clear`: Metro's transform cache had frozen `EXPO_PUBLIC_*` values from an earlier export, leaving the ads flag `undefined`.
- **Sandbox limits**: no Anthropic API key here, so `LLM_MODE=live` is implemented and structurally tested only; E2E runs in replay.

## Agent E — integration fixes (E2E-005 / E2E-014) — 2026-09-04

Suite went from 14/16 to **16 passed, 4 skipped**. No test was skipped, relaxed or re-timed; no
fixture was changed (both fixtures were correct — the failures were product bugs).

### E2E-005 — the news post was not first in the feed

Root cause: **the `/__test/time-travel` clock offset leaked across cases, and `Post.createdAt` had
two different time sources.** `createClock()` keeps a process-wide `offsetMs`; `POST /__test/reset`
truncated the tables but never cleared it. Test files run alphabetically, so `economy.spec.ts`
E2E-015 (`time-travel {days:1}`) left the clock a day ahead for every later case. Onboarding is the
only place that wrote an explicit `createdAt` (`deps.clock.now()`, in
`apps/api/src/services/persona.ts#seedInitialFeed`, which backdates the 5 ambient posts by a minute
each so the welcome post sits on top); every other row relied on Prisma's `@default(now())`, i.e.
the real DB clock. With the offset in force, the 6 onboarding posts were stamped **a day in the
future** and `GET /v1/feed` (`createdAt desc`) returned them above everything the case then created
— the six standalone character/ambient cells above `thescoop` in the failure snapshot. The client
merge was innocent: `loadFeed` already lets the server order win.

Fix (both halves, so neither can bite again):
- `apps/api/src/clock.ts` — `Clock.reset()`; `apps/api/src/routes/test-hooks.ts` — `/__test/reset`
  calls it, so one case can no longer shift the next case's clock.
- Every `Post` row is now stamped from the injectable clock (`createdAt: deps.clock.now()` in
  `routes/posts.ts`, `services/post-stream.ts` ×2, `routes/events.ts`), matching the Clock's stated
  contract ("every time read goes through this"). Feed order is now correct even *while* the clock
  is travelled — verified by hand: reset → time-travel +1d → 8 posts → event choice → news first.

### The `"..."` cell — placeholder welcome post

Root cause: `seedInitialFeed` built its G1 input from **raw DB handles** (`@hivequeenbea`), while
`services/story.ts#castCards`/`involvedFor` normalise to bare handles (orchestrator decision:
"generator inputs get bare handles"). `replayG1`'s `characterFixture()` lookup therefore missed and
G1 returned its `"..."` placeholder — and because `text = generated || fallbackText`, the
placeholder beat the authored `welcomePosts` line. Fixed by `normHandle`ing `cast` / `involved` /
`recentFeed` in `apps/api/src/services/persona.ts`. The welcome post now carries a real line from
the world fixtures; E2E-002's "exactly 1 character cell from the first follower" still holds (k=1,
involved-first ordering unchanged).

### E2E-014 — 👎 did not replace the reply

Root cause: **an unauthenticated first request tore the session down.** E2E-014 is the only case
that boots straight into a deep route (`page.goto("/post/:id")`). React runs child effects before
the provider's, so `PostDetailScreen`'s `api.post(id)` fired before `AppProvider`'s async boot had
awaited `loadToken()`; `getToken()` returned `null` (cache cold), the request went out with no
bearer, came back 401, and the client's global `onUnauthorized` handler did `saveToken(null)` —
wiping the JWT out of `localStorage` and the cache. The thread still rendered (a later retry
re-read the token before the 401 landed), but the subsequent `POST /generations/:id/rate` went out
unauthenticated and 401'd; `onDown`'s `.catch(() => undefined)` swallowed it, so nothing changed on
screen. The API side was always correct.

Fixes (client only):
- `apps/mobile/src/auth/token.ts` — on web, `getToken()` falls back to a synchronous
  `localStorage` read when the cache is still cold. The web store *is* synchronous; there is no
  reason for a request to miss the bearer just because the async boot has not run.
- `apps/mobile/src/api/client.ts` — a 401 only signs the user out when the request actually carried
  a bearer. A 401 on a token-less request can no longer destroy a valid session.
- `apps/mobile/src/api/client.ts` + `app/post/[id].tsx` — 👍/👎 now send `?postId=` (the API has
  always accepted it). One G1 call produces K replies sharing a `generationId`; without it the
  server fell back to `posts[0]` and rating the 2nd/3rd reply replaced the wrong row.

### Two determinism bugs found on the way (both would have made the suite flaky)

- `apps/api/src/routes/generations.ts` — the replay pool for a character is 3 buckets × 3 lines, so
  a 👎 re-roll landed on the *same* line about 1 time in 9 (observed once while debugging; E2E-014
  asserts the text changes). The regenerate path now re-rolls the seed up to `REGEN_ATTEMPTS = 2`
  more times while the new text equals the rejected one. Every attempt is still logged to
  `GenerationLog` with `escalatedFrom`, so E2E-013/014's assertions are unaffected. This is also the
  right product behaviour: 👎 promises a *different* line.
- `apps/api/src/fake-gateway.ts` — same collision in the vitest fake (it only marked a regenerated
  line with `(reconsidered)` at the `high` tier, so a `light → mid` escalation could redraw the
  original). `apps/api/test/generations.test.ts` failed roughly 1 run in 12 because of it; the fake
  now marks any call carrying `escalatedFrom`. **This was a pre-existing flake**, confirmed by
  reproducing it on a clean tree.

### Known, left alone
`[api] post stream failed … P2025 No record was found for an update` is logged occasionally by the
API webServer: the next case's `/__test/reset` truncates `Post` while the previous case's SSE stream
is still materialising replies. It is caught, logged and harmless (pre-existing).

### Verification
`pnpm --filter mobile typecheck` clean · `pnpm --filter api test` 29/29 · `pnpm --filter @rpgllm/llm
test` 80/80 · `pnpm e2e` (with the web export) **16 passed, 4 skipped**, twice in a row.

## Agent F — security & ops — 2026-09-04

Seven S0 findings fixed plus the missing ops layer. Everything below is in the working tree; no
commits (orchestrator owns those).

### S0-1 Authentication bypass — real one-time codes
`POST /v1/auth/email/verify` accepted the constant `DEV_EMAIL_CODE` ("000000") for **any** email:
in production, anyone could sign in as anyone.

- `apps/api/src/auth-codes.ts` (new) — 6-digit code, **only the salted sha256 hash is stored**
  (per-code 16-byte salt), 10-minute expiry, ≤5 verify attempts, single use, constant-time compare
  (`timingSafeEqual`). `MailSender` interface + `ConsoleMailSender` default (`setMailSender()` swaps it).
- `apps/api/src/routes/auth.ts` — `/email/start` issues and "sends" a code; `/email/verify`
  (and its `/email` + `/:provider` aliases) accepts the constant dev code **only** when
  `AUTH_DEV_CODE=1`. `TEST_HOOKS=1` implies `AUTH_DEV_CODE=1`, so the existing vitest harness
  (`vitest.config.ts` sets `TEST_HOOKS=1`) and the Playwright webServer (`TEST_HOOKS=1`) keep
  logging in with `000000` — **`e2e/playwright.config.ts` was not touched**. `.env.example` also
  sets `AUTH_DEV_CODE=1` for local dev.
- **TODO(P1) — needs the orchestrator:** the pending codes live in an in-memory `Map` on
  `AppState.emailCodes` because `prisma/schema.prisma` is not mine. Consequences: codes do not
  survive a restart and do not work across more than one API instance. The fix is a `LoginCode`
  table (`email, salt, hash, expiresAt, attempts, consumedAt`); `auth-codes.ts` is written so only
  the store swaps.

### S0-2 JWT secret default — production config guard
`apps/api/src/config-guard.ts` (new) + called from `index.ts`. With `NODE_ENV=production` **or**
`APP_ENV=production` the process refuses to boot when `JWT_SECRET` is unset / `dev-secret-change-me`
/ shorter than 32 chars, or when any of `AUTH_DEV_CODE=1`, `TEST_HOOKS=1`, `BILLING_MODE=test`,
`ADS_MODE=test` is on — and also when `BILLING_MODE`/`ADS_MODE` are simply **unset**, because their
code defaults used to be `test`. (`env.ts` now additionally defaults them to `revenuecat`/`admob`
in production.) All problems are reported at once. Unit-tested.

### S0-3 `.env.example` loaded at runtime
`index.ts#loadEnvFile` now loads `.env.example` **only when not production** and logs which files
were applied and how many keys each contributed (`msg:"api.start"`).

### S0-4 No rate limiting → `src/middleware/rate-limit.ts` (new)
In-process token bucket, no new dependency. Budgets (env-overridable): auth start/verify **5/min
per IP and per email**, post/reply/DM-send/rate **20/min per user**, ad-reward **10/min per user**,
everything else **120/min** per user (verified bearer) or per IP. `/__test/*` and `/health` are
exempt; the limiter is off while `TEST_HOOKS=1` (`RATE_LIMIT_ENABLED=1|0` forces it), so no suite
flakes on it. 429 carries `Retry-After`. Buckets refill on the injectable clock.

> **⚠ Required change in `packages/shared` (orchestrator): add `"RATE_LIMITED"` to `ErrorCodeZ`.**
> The 429 body is `{"data":null,"error":{"code":"RATE_LIMITED","message":…,"requestId":…}}`. Because
> `ErrorCode` does not contain it yet, `middleware/rate-limit.ts#rateLimitedResponse` builds that
> response by hand instead of calling `http.ts#fail`. Once the code exists in `ErrorCodeZ`, replace
> the hand-built response with `fail("RATE_LIMITED", …, 429)` (keep the `Retry-After` header) — that
> is the only follow-up. Clients should treat 429 as "back off", not as a session error.

### S0-5 CORS `*` → allow-list
`app.ts` now evaluates the origin per request: `CORS_ORIGINS` (comma-separated, default
`http://localhost:8081,http://localhost:8082`); wildcard only while `TEST_HOOKS=1`. Methods/headers
the client needs are preserved (`authorization`, `content-type`, `x-request-id`, `accept`,
`last-event-id`, `GET/POST/OPTIONS`), so SSE `GET` still works; `x-request-id`/`retry-after` are exposed.

### S0-6 Forgeable ad reward
`apps/api/src/services/ad-verify.ts` (new): `verifyAdMobSSV()` implements the real AdMob
server-side-verification **signature shape** (ECDSA-SHA256 over the query string up to
`&signature=`, base64url signature, `key_id` lookup, ±5-minute freshness, `user_id` match) and
**fails closed** until the Google verifier key set is wired (TODO(P1): fetch + cache
`https://gstatic.com/admob/reward/verifier-keys.json`, and persist `transaction_id` to block
replays — that needs a table, so it is an orchestrator follow-up). `routes/wallet.ts` accepts the
constant `TEST_AD_TOKEN` **only** when `ADS_MODE=test` (constant-time compare); any other mode goes
through the SSV check and answers 400 when it fails.

### S0-7 `?token=` query auth narrowed
`auth.ts#requireAuth` accepts a query token only on `GET …/stream` (EventSource); on every other
route/method it is ignored, so a token in a URL can never drive a mutating call.

### Ops (all new)
- `.github/workflows/ci.yml` — `lint`, `test` (Node 22, pnpm, Postgres 16 service, `pnpm -r
  typecheck`, shared tests `--if-present`, `@rpgllm/llm` tests, `prisma migrate deploy`, `api`
  tests), `e2e` (Playwright; `playwright install --with-deps chromium` is guarded by
  `if: env.CI == 'true'` and is **never** run in this sandbox, which has Chromium at
  `/opt/pw-browsers`; CI additionally exports `PW_CHROMIUM_PATH`). HTML report uploaded on failure.
- `eslint.config.mjs` (flat ESLint 9 + typescript-eslint strict-type-checked, type-aware, scoped to
  `apps/api`, `packages/*`, `e2e`), `.prettierrc`, `.prettierignore`, root `lint` / `lint:fix` /
  `format` / `format:check` scripts. `eslint`, `typescript-eslint`, `prettier` were added as
  devDependencies of **`apps/api`** (`pnpm --filter api add -D …`, never a root install); the
  hoisted node-linker puts the binaries in the root `node_modules/.bin`, so `pnpm lint` works.
- `apps/api/Dockerfile` (multi-stage: pnpm fetch → install+`prisma generate`+typecheck → node:22-slim
  runtime, non-root `node`, `HEALTHCHECK` on `/v1/health`), `.dockerignore`, `docs/deploy.md`.
- `src/middleware/request-log.ts` — `x-request-id` honored or generated, echoed in the response
  header, injected into **every JSON error body**, one JSON log line per request
  (method/path/status/durationMs/userId). `authorization`/`cookie` headers and
  `?token=`/`?code=`/`?jwt=` values are redacted. `app.ts#onError` uses it instead of `console.error`.
- Graceful shutdown in `index.ts`: SIGTERM/SIGINT → stop accepting connections, idle sockets closed,
  in-flight SSE gets `SHUTDOWN_GRACE_MS` (10s) → `prisma.$disconnect()` → exit 0.
- `/v1/health` gained `db:"ok"|"down"` from a `SELECT 1` with a 1.5s budget; **503 when down**.
  Existing fields (`ok`, `llmMode`, `champion`) are unchanged.

### Files touched outside my ownership (kept minimal, as required by CLAUDE.md rule 1)
- `apps/api/src/routes/auth.ts` — the S0-1 fix itself lives here.
- `apps/api/src/routes/wallet.ts` — 6 lines for the S0-6 ad-token gate.
- `apps/api/src/routes/health.ts` — the DB probe (fields preserved).
- `apps/api/src/types.ts` — two added fields: `AppState.emailCodes`, `AppEnv.Variables.requestId`.
- `scripts/db.sh` — `reset` now does `DROP DATABASE … WITH (FORCE)`. **Why:** the API opens a
  Prisma connection as soon as `/v1/health` probes the database, and Playwright starts the
  webServers *before* `globalSetup`; the old `DROP DATABASE` then failed with "database is being
  accessed by other users". One line, PG13+.
- `.env.example` — documented + added `AUTH_DEV_CODE`, `CORS_ORIGINS`, the rate-limit knobs,
  `NODE_ENV`, `REQUEST_LOG`, `HEALTH_DB_TIMEOUT_MS`, `SHUTDOWN_GRACE_MS`.

### Lint debt (deliberate, do not "fix" by mass-rewriting)
`pnpm lint` is **0 errors / ~309 warnings**. Only bug-shaped rules are errors
(`no-floating-promises`, `await-thenable`, `no-misused-promises`, `no-explicit-any` + ESLint
recommended). Everything that mass-fails existing code — `array-type`, `prefer-optional-chain`,
`no-unnecessary-condition`, `no-non-null-assertion`, `restrict-template-expressions`, the
`no-unsafe-*` family, `no-deprecated` (zod v4 deprecations in `packages/shared/src/api.ts`),
`no-base-to-string`, `prefer-regexp-exec`, … — is a **warning**. Each owner should clear their own
package and the rule can then be promoted to error. `apps/mobile` is not linted at all yet (needs
the React/React-Native plugin set). `prettier --check` currently reports 140 files, so the CI
`format:check` step is `continue-on-error: true` until someone runs `pnpm format` package by package.

### Production env checklist (also in `docs/deploy.md`)
Required: `NODE_ENV=production` (or `APP_ENV=production`) · `JWT_SECRET` random ≥32 chars and not
`dev-secret-change-me` · `AUTH_DEV_CODE` unset/`0` · `TEST_HOOKS` unset/`0` · `BILLING_MODE=revenuecat`
· `ADS_MODE=admob` · `DATABASE_URL` · `LLM_MODE=live` + `ANTHROPIC_API_KEY` + `LLM_MODEL_HIGH|MID|LIGHT`
· `CORS_ORIGINS` = the real app origins. Optional: `PORT`, `AUTH_CODE_TTL_MS`,
`AUTH_CODE_MAX_ATTEMPTS`, `RATE_LIMIT_*`, `REQUEST_LOG`, `HEALTH_DB_TIMEOUT_MS`, `SHUTDOWN_GRACE_MS`.
Run `prisma migrate deploy` as a release step (the container does **not** migrate). Before a public
launch: a real `MailSender`, the AdMob verifier keys, `RATE_LIMITED` in `ErrorCodeZ`, and the
`LoginCode` table.

### Verification
`pnpm --filter api typecheck` clean · `pnpm -r typecheck` clean · `pnpm --filter api test`
**102/102** (29 pre-existing + Agent-owned additions + 23 new in `test/security.test.ts`) ·
`pnpm lint` 0 errors · `pnpm e2e` **18 passed, 4 skipped, 3 failed** — every `E2E-0xx` P0 case
passed plus the new `SEC-001`; the three failures are `tests/compliance.spec.ts` (`S1-2a`, `S1-2b`,
`S1-3/6`), an in-progress feature landed by another agent while this ran, unrelated to these
changes. `docker build` **not run**: the Docker daemon is not running in this sandbox (client
29.3.1 present, no `/var/run/docker.sock`), so the Dockerfile is unverified by execution.

## Agent G — store compliance (S1) — 2026-09-04

### What shipped

**API**
- `src/routes/account.ts` → `/v1/account` (mounted in `app.ts`):
  - `POST /delete` (auth, `{confirm:"DELETE"}`) → `{deletedAt, purgeAt}`; sets `User.deletedAt`.
  - `POST /restore` (auth) → `{restored}`; refuses with 410 once the grace window (`DELETION_GRACE_DAYS`=30) has passed.
  - `GET /export` (auth) → `ExportDataResZ`; the caller's personas/posts/DMs/purchases, capped at 1,000 posts
    and 1,000 messages with `truncated:true` when either cap is hit.
  - `POST /consent` (auth) → `ConsentResZ`; **forced to `{analytics:false, locked:true}` for `isMinor`** (S1-6).
  - `POST /__test/purge-deleted` — TEST_HOOKS only, see "Deviations" (1).
- `src/services/account.ts`: `requireActiveAccount` (410 `ACCOUNT_DELETED` middleware), `purgeDeletedAccounts(prisma, now)`,
  `buildExport`, `resolveConsent`, `purgeAtFor`, `withinGraceWindow`, `EXPORT_LIMIT`.
- `src/routes/moderation.ts` → `/v1/moderation`:
  - `POST /report` → 201 `{id,status}`. The `snapshot` and `generationId` are read **server-side** from the
    post / DM message / character / world; a duplicate **open** report for the same `(user,target,targetId)` is 409 `ALREADY_DONE`;
    an unknown target is 404.
  - `POST /block` (201) / `POST /unblock` (200) — `{personaId, characterId}`; second block is 409 `BLOCKED`,
    unblocking something that is not blocked is 404, someone else's persona is 404.
  - `GET /blocked?personaId=` → `BlockedListResZ`.
  - `GET /reports?status=open` — moderation queue, gated behind `TEST_HOOKS=1` **or** `ADMIN_TOKEN`
    (`authorization: Bearer <ADMIN_TOKEN>` or `x-admin-token`). `ADMIN_TOKEN` is read in `services/moderation.ts`
    (`env.ts` belongs to Agent F).
- `src/services/moderation.ts`: `blockedCharacterIds(prisma, personaId)`, `withoutBlocked(list, ids, idOf?)`
  (pure; `idOf` defaults to `authorCharacterId ?? characterId`), `loadReportedContent`, `findOpenReport`, `createReport`.
- Tests: `test/account.test.ts` (10 cases) + `test/moderation.test.ts` (8 cases). `pnpm --filter api test` green.
- Reporting and blocking cost **no energy** (they are safety actions, not story actions).

**Client (apps/mobile)**
- `app/settings.tsx` (SCR-033) — account (id, export, sign out, delete), subscription (plan, store
  subscription URL per platform / paywall on web, restore), privacy (consent switch, locked for minors),
  safety (→ blocked list), language (EN/JA), legal (terms / privacy / guidelines / support via `expo-linking`).
- `app/settings/blocked.tsx` — blocked list with `T.unblock(handle)`.
- `app/delete-account.tsx` — warning + "type DELETE" + confirm → `deleteDone` → signs out to SCR-002 after 2s.
- `app/report.tsx` — `?target=&targetId=&handle=`, radio list of `REPORT_REASONS`, optional note, submit →
  `reportDone`; block affordance (`blockOpen` → `blockConfirm`) when a handle is passed.
- `src/components/Overflow.tsx` — the "…" button (`T.overflow(id)`).
- Every added `Pressable`/`Button` carries `accessibilityRole` + an i18n `accessibilityLabel` (S3-6).

**E2E** — `e2e/tests/compliance.spec.ts` (4 cases, local helpers only; `fixtures.ts` untouched):
report a character reply from the feed overflow; block → gone from feed + DM picker → unblock in settings;
settings legal links + consent toggle; in-app deletion → back to SCR-002 + the old token is refused with 410.

### Minimal edits to files I do not own (please keep)

1. `apps/api/src/app.ts` — two imports + `v1.route("/account", …)` and `v1.route("/moderation", …)`.
2. `apps/api/src/routes/feed.ts` — 3 lines: `blockedCharacterIds(...)` + `withoutBlocked(...)` around the
   post and reply queries, so a blocked character's posts never reach `GET /v1/feed`.
3. `apps/api/src/routes/dms.ts` — 1 line: `withoutBlocked(threads, ctx.blockedCharacterIds)` in `GET /v1/dms`.
4. `apps/api/src/services/story.ts` — `StoryContext` gains `blockedCharacterIds`, and `loadStoryContext`
   filters blocked characters out of `characters`. **Consequence (intended):** blocked characters leave the
   G1 cast (`castCards`), `involvedFor`, `characterByHandle` (so `materializeReplies` cannot fall back to
   them) and the DM "New message" picker. Nothing else changes.
5. `apps/mobile/app/(tabs)/feed.tsx` — gear button (`T.settingsBtn`) in the header, `loadBlocked()` on mount,
   and the client-side blocked filter on the feed + inline replies. **Plus one bug fix:** the `loadFeed`
   effect and `useFocusEffect` now depend on `me?.persona?.id`. Without it, a *direct* load of `/feed`
   (reload / deep link) never fetched the feed at all — the screen mounts before the async boot has `me`,
   and nothing re-ran the effect. It showed as an empty "Your world is waking up…" feed.
6. `apps/mobile/src/components/PostCell.tsx` — `CellOverflow`, rendered as an absolutely positioned **sibling**
   of the cell's `Pressable` (never nested inside it, so tapping "…" cannot also open the post detail).
7. `apps/mobile/src/api/client.ts` — additive endpoint methods + a local `ReportTarget` alias.
8. `apps/api/src/auth.ts` — the 4-line `deletedAt` check described in the next section (nothing else).
9. `apps/mobile/src/state/store.tsx` — additive state (`blocked`, `analyticsConsent`) and actions
   (`loadBlocked`, `blockByHandle`, `unblockCharacter`, `reportContent`, `setConsent`, `exportMyData`,
   `deleteAccount`, `restorePurchases`).

### Global lock-out for soft-deleted accounts — `apps/api/src/auth.ts` (done here, was a request to Agent F)

`requireActiveAccount` (services/account.ts) only guards the two routers I own, so a deleted account could
still call `/v1/feed`, `/v1/posts`, … until its purge. Agent F finished before picking this up, so the
orchestrator asked me to land it myself. `requireAuth` now has exactly one added check, right after
`isBlockedAge`:

```ts
// S1-1 (Agent G): a soft-deleted account keeps its row through the 30-day grace window but loses
// every door except `POST /v1/account/restore`, which is how the user cancels the deletion.
if (user.deletedAt && !c.req.path.endsWith("/account/restore")) {
  return fail("ACCOUNT_DELETED", "This account is scheduled for deletion", 410);
}
```

The `restore` exemption is required: the caller of `POST /v1/account/restore` is by definition
soft-deleted. `requireActiveAccount` stays on my routers as defence in depth (and as the thing that keeps
working if this check is ever refactored). Covered by
`test/account.test.ts` → "locks a soft-deleted user out of the rest of the API but leaves
/account/restore reachable" (asserts 410 on `/v1/me`, `/v1/feed`, `/v1/wallet`, then a successful restore).

### Deviations / open items

1. **Purge hook path.** The purge routine is exposed at `POST /v1/account/__test/purge-deleted`
   (not `/v1/__test/purge-deleted`): `routes/test-hooks.ts` is not mine and `app.ts` was limited to two
   route lines. It is guarded by `testHooksEnabled()` and returns
   `{users, personas, posts, messages, generations}`. In production the same function should be run from a
   daily job (`purgeDeletedAccounts(prisma, new Date())`).
2. **`MeResZ` has no `email` and no `analyticsConsent`.** SCR-033's account row therefore shows the user id,
   and the consent switch starts from the server default (`false`) after each boot; the server value is
   authoritative on write (and always `false` for minors). Please add both fields to `MeResZ`
   (`packages/shared` is orchestrator-owned) and I/whoever owns settings can bind them properly.
3. **Missing i18n strings** (used the closest thing): no key for the free tier — the plan row renders the
   literal `"Free"`; the support link reuses `support`; the consent switch renders `ON`/`OFF` (no keys).
   `T.reportOpen` is unused: the "…" opens the report screen directly instead of an intermediate menu.
4. **Native export** uses `Share.share({message: json})` because `expo-file-system` is not a dependency —
   TODO(P1): write the JSON to the cache dir and share the file (web already downloads a real `.json`).
5. **DM thread header has no "…" yet** — `app/dms/[threadId].tsx` is not mine. The API already accepts
   `target:"dm_message"`; whoever owns that screen can drop in `<Overflow id={m.id} target="dm_message"
   targetId={m.id} handle={character.handle} />`.
6. **Blocking hides, it does not delete.** Rows stay in the database (so an unblock restores the history);
   only reads are filtered. `GET /v1/dms/:threadId` for a blocked character still works if deep-linked.
7. Agent H: `/settings` exists — feel free to link it from SCR-026 (I did not touch `app/profile.tsx`).

### Verification (final, 2026-09-04)

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck`, `pnpm --filter e2e typecheck` — clean.
- `pnpm --filter api test` — **103 passed / 15 files**, including my 19 (`account.test.ts` 11, `moderation.test.ts` 8).
  (A first run showed 24 failures across 12 files; it was a *concurrent* vitest run from another agent
  truncating `rpgllm_test` mid-flight. Re-running alone: all green. Do not run two vitest sessions at once.)
- `pnpm e2e` — **27 passed, 4 skipped, 0 failed** (1.8m): the 16 P0 cases, my 4 compliance cases, and the
  other agents' new cases.
- Housekeeping: `apps/mobile/dist-g/` had been committed by accident (it was my throw-away web export, used
  to run the suite on isolated ports while other agents held :4000/:8082). It is deleted in the working
  tree — please commit the removal, and consider widening the `dist` ignore rule.

## Agent H — retention & growth (S2) — 2026-09-04

Scope: every **S2** row of `gap-analysis.md` — the "beat Status" list from `teardown.md` §7
(AIF-001/002/005) plus push, referral and the profile screen.

### What shipped

| Gap | Surface | Endpoints | Screens |
|---|---|---|---|
| S2-1 | Offline World Director (AIF-001) | `GET /v1/digest?personaId=`, `POST /v1/digest/:id/seen` | `DigestCard` pinned above SCR-010 |
| S2-2 | Push | `POST /v1/push/register` | `src/push.ts` (web = no-op) |
| S2-3 | Memory ledger (AIF-002) + **G7 finally called** | `GET /v1/memory/:characterId?personaId=` | `app/memory/[handle].tsx` (SCR-039), opened from the DM hearts |
| S2-4 | Shareable Moment (AIF-005) | `GET /v1/moments?personaId=`, `GET /v1/moments/:slug` (**public**) | `MomentCard` (9:16, tokens only), `app/moment/[slug].tsx` |
| S2-5 | Referral | `GET /v1/referral`, `POST /v1/referral/redeem` | `app/invite.tsx` (SCR-041) |
| S2-6 | Profile | `GET /v1/profile?personaId=` | `app/profile.tsx` (SCR-026), third tab |
| S2-7 | Ambient refill | — (job only) | — |

### The jobs, and how to run them without a scheduler

**There is no scheduler in this build** — no cron, no worker, no queue. Each job is therefore a
plain function that a scheduler *would* call, and each also has an opportunistic trigger on a read
so the product works without one. `apps/api/src/jobs/index.ts` carries the same table:

| job | function (`apps/api/src/jobs/`) | opportunistic trigger | manual |
|---|---|---|---|
| digest | `runOfflineDirector(prisma, gateway, clock, {personaId?, force?, limit?})` | `GET /v1/digest` generates on demand when the away window is met and nothing unseen is waiting | `POST /v1/__test/run-job {"job":"digest","personaId":…,"force":true}` |
| memory | `runMemoryConsolidation(prisma, gateway, clock, {personaId?, minNotes?})` | end of `GET /v1/memory/:characterId` | `…{"job":"memory"}` |
| ambient | `runAmbientRefill(prisma, gateway, clock, {worldId?, locale?, force?})` | none (pool is per world+locale, not per read) | `…{"job":"ambient"}` |

`POST /v1/__test/run-job` is **guarded by `testHooksEnabled()` inside `jobs/index.ts`**, not in
`routes/test-hooks.ts` (Agent F's file), so `app.ts` mounts `jobRoutes()` unconditionally and the
route 404s when `TEST_HOOKS != 1`. `job: "all"` runs all three.

What the offline director does per persona (only when the last *user* action — own posts, own DMs,
persona creation, or the previous digest — is older than `DIGEST.MIN_AWAY_HOURS`, and no unseen
digest exists): a **G5** director beat → `DIGEST.POSTS_PER_DIGEST` character posts + an optional
press line via **G1** → one DM from the highest-affinity follower via **G4** → a `Digest` row with
the created `postIds` → a push. It **costs no energy** (the user did not act) and never touches the
wallet; `digest.test.ts` asserts zero `LedgerEntry(source: spend)` rows across a run.

### Deviations

1. **g5 + g1 instead of g10 / g2.** `cost-architecture.md` §3 assigns the digest to **G10** and the
   ambient pool to **G2**, both on the Batch tier. `packages/llm`'s gateway exposes only
   `g1/g4/g5/g7/g8` — there is no `g10` and no `g2`, and adding them is Agent B's file. So:
   - digest = **G5** (the director beat: title + first outcome as headline/body) + **G1** (the
     character posts, `includeNews` on the first call) + **G4** (the one DM);
   - ambient refill = **G1** with a synthetic `[ambient]` prompt — no persona, no reply target,
     just the world bible + cast asking for `k` lines of chatter.
   Every call goes through `deps.gateway` and is written to `GenerationLog` like any other, so the
   cost dashboard sees them. **Neither runs on the Batch tier** (the gateway has no batch path):
   this is the one place where the cost model is not yet met, and it is why the per-run budget is
   deliberately tiny (ambient: one G1 call per world+locale, k ≤ 4, target
   `PACING.AMBIENT_SEED_COUNT × 4 = 20` rows — `PACING` has no pool-target constant).
2. **`LedgerEntry.source: "referral"` exists** in the schema enum after all (the brief expected it
   to be missing), so both referral grants use it — no compromise was needed.
3. **Redemption window.** "New account" = *no persona yet*, or *within `REDEEM_WINDOW_HOURS = 24`
   of signup*. Self-referral → 400, second redemption → 409 (`Referral.inviteeId` is unique),
   stale account → 400. Tested in `referral.test.ts`.
4. **Invite link base** reads `process.env.PUBLIC_APP_URL` directly in `services/referral.ts`
   (fallback `https://rpgllm.example`) because `env.ts` is Agent F's file. Same for
   `PUSH_ENABLED` in `services/push.ts`. Both want an `env.ts` accessor when someone owns it again.
5. **Moment creation is read-driven.** `StatSnapshot` is written in `services/post-stream.ts` and
   `routes/events.ts`, which I do not own, so `ensureMomentsFor()` scans the 20 most recent
   snapshots on `GET /v1/moments` and mints a card for every qualifying one that has none
   (`Moment.cause = "snapshot:<id>"` keeps it idempotent). Thresholds:
   |followersDelta| ≥ 25% of the count *before*, |auraDelta| ≥ 5, or `cause` starts with `event:`.
   The client re-checks the same rule (`isBigSwing` in `feed.tsx`) before it asks.
6. **`GET /v1/moments/:slug` is unauthenticated** — it is the share target, the whole point of the
   growth loop. It exposes only what the card draws (headline, narrative, deltas, ≤3 reactions,
   persona handle/level): no user id, no email, no post ids.
7. **The moment card renders in the feed list header, not as an overlay.** A scrim would sit on the
   compose FAB and the feed cells; E2E-005 posts eight times and then resolves an event, so an
   overlay would have broken P0 cases. Inline keeps `postCells(page).first()` honest.
8. **Profile is a stack route** (`app/profile.tsx`), because the brief named that path while
   `app/(tabs)/` holds only feed and dms. The Profile tab therefore *pushes* it (feed/dms still
   `replace`), and its header's back button returns to the tab you came from.
9. **Push registration fires on the first feed mount** with a persona, not on the last onboarding
   screen (`app/onboarding/*` is Agent C's). Effectively "after onboarding".
10. **`expo-notifications` is NOT installed.** Adding it would rewrite the workspace lockfile while
    three other agents were building, and there are no APNs/FCM credentials here to test against.
    `apps/mobile/src/push.ts` therefore owns the interface and takes the native module by
    injection (`setNotificationsModule`); web is a hard no-op so the E2E web export cannot hang on
    a permission prompt. Wiring it up later is a three-line change documented at the top of that
    file — no call site moves.
11. `apps/api/test/moments.test.ts` also holds the **profile** (SCR-026) tests; the brief named four
    test files, and profile + moments are the same "progression you can see" surface.

### Still missing (needs an owner / a credential)

- **A real scheduler.** The digest should run nightly per away-user and the ambient refill hourly
  per world+locale; today they only run on a read or the test hook. A cron/worker calling the three
  exported functions is all that is needed — no code changes.
- **Batch tier** for digest + ambient (50% off, cost-architecture §3): needs a batch path in
  `packages/llm`.
- **Push credentials**: an Expo project with APNs/FCM keys, then `PUSH_ENABLED=1` and the
  `expo-notifications` wiring above. Until then `sendPush` logs and returns `{skipped: true}`.
- **`PUBLIC_APP_URL`** must be set in production or invite links point at `rpgllm.example`.
- Digest **postIds are not visually highlighted** in the feed yet (the contract carries them).

### Verification

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck` — clean.
- `pnpm --filter api test` — **103 passed** (the pre-existing 29 plus the other agents' and my 15:
  `digest` 4, `memory` 4, `moments` 4 incl. profile, `referral` 3).
- `pnpm e2e` — **27 passed, 4 skipped, 0 failed**: the 16 original P0 cases plus my 4 new
  `retention.spec.ts` cases (digest appears/dismisses, profile level+XP+posts, memory ledger with a
  quoted receipt opened from the DM hearts, referral code read and copied) and the other agents'.
- While :4000/:8082 were held by another agent's run I verified on isolated ports (:4100/:8102) and
  a scratch database; the numbers above are from the canonical `pnpm e2e` on :4000/:8082 with
  `rpgllm_test`. The API vitest suite must be run with **`TEST_DATABASE_URL`** (not `DATABASE_URL`)
  — `apps/api/vitest.config.ts` overrides `DATABASE_URL` from it, which silently sends every
  "isolated" run back to `rpgllm_test`. Worth knowing when two agents test at once.
- Housekeeping: `apps/mobile/dist-h/` (my throw-away web export for the isolated-port run) was
  picked up by a commit; it is deleted in the working tree — please commit the removal.

## Agent I — cost observability (S3-5) & accessibility (S3-6) — 2026-09-04

### S3-5 — what was built

| file | role |
|---|---|
| `apps/api/src/services/cost.ts` | all the aggregation (new) |
| `apps/api/src/routes/cost.ts` | `GET /v1/cost/summary`, `GET /v1/cost/live` (new) |
| `apps/api/src/app.ts` | one line: `v1.route("/cost", costRoutes())` |
| `apps/api/test/cost.test.ts` | 17 cases (new) |
| `scripts/cost-report.mjs` | CLI: terminal table / `--json` / `--html` (new) |
| `e2e/tests/cost.spec.ts` | 2 cases (new) |

### "Action" for `$/action`

An action is **one `LedgerEntry(source: "spend")` row in the window**. That is the single place an
energy spend is written (`services/wallet.ts#spendEnergy`), inside the same transaction as the post
/ reply / DM send / event choice — so it is exactly cost-architecture §2's unit, with no risk of
double counting a post that also produced a news item, and no need to union four tables.

A **fallback refund does not cancel the spend**: `refundEnergy` writes `source: "admin"` with a
`refund:` ref, so the spend row stays. That is deliberate — the LLM call was made and billed, so the
action still belongs in the denominator. `totals.fallbacks` (calls whose `stopReason` is one of
`error | refusal | invalid_json`, the only trace `meta.fallback` leaves in the schema) is reported
separately so a rise in refunds is visible next to it.

`usdPerActiveUser` divides by `count(distinct GenerationLog.userId)` in the window — the $/DAU of §4.

### Where the percentiles are computed

In Postgres, `percentile_disc(p) WITHIN GROUP (ORDER BY "latencyMs")` (and the same over `ttftMs`).
`percentile_disc` is the **nearest-rank** percentile: it returns a value that was actually observed —
the `ceil(p·n)`-th of n sorted samples — never an interpolation and never an average. That makes it
hand-checkable, which is what `cost.test.ts` does: seven seeded latencies `100…1000` must give
P50 = 400 (4th) and P95 = 1000 (7th), and the test also asserts the P50 is *not* the mean.

Nothing is aggregated in JS. Every breakdown (`byDay`, `byGenerator`, `byVariant`, `byModel`,
`totals`, the per-arm table and the daily series) is a `GROUP BY` over the `@@index([createdAt])`
window; the service never loads a `GenerationLog` row. `byDay` buckets on
`date_trunc('day', "createdAt")`, i.e. UTC days — the test seeds two rows one millisecond apart
across a midnight and asserts they land in different buckets.

### The admin gate

`/v1/cost/*` exposes product-wide spend and user counts, so `requireAuth` would not be a gate at all
(any signed-up user would pass). The router's own middleware allows a request when **`TEST_HOOKS=1`**
(vitest + Playwright) **or** when `x-admin-token` equals a **non-empty** `ADMIN_TOKEN` env var,
compared with `crypto.timingSafeEqual`. Everything else gets the exact 404 body `app.notFound`
produces, so a scanner cannot tell the route exists. There is no empty-token bypass: with
`ADMIN_TOKEN` unset the route is 404 for everyone once `TEST_HOOKS` is off.

`ADMIN_TOKEN` is read straight from `process.env` inside `routes/cost.ts` rather than added to
`src/env.ts` — that file is Agent F's. **Suggested follow-up for whoever owns `env.ts`**: move it to
an `adminToken()` accessor and have `assertProductionConfig()` refuse to boot in production with
`TEST_HOOKS=1` *and* no `ADMIN_TOKEN` (today production simply has the routes closed, which is safe
but silent).

### Alarm thresholds (§6.4)

`COST_ALARMS` in `services/cost.ts`, echoed in `/v1/cost/live`, `/v1/cost/summary` and both CLI
outputs as `thresholds`, with the booleans in `alarms`:

| alarm | threshold | fires when |
|---|---|---|
| `cacheHitRateLow` | `CACHE_HIT_MIN = 0.80` | `cacheRead / (cacheRead + input) < 0.80` with ≥1 call |
| `costPerActionOverChampion` | `COST_OVER_CHAMPION = 0.30` | any live arm's $/call is > +30% over its generator's champion (`championVariants()` from `@rpgllm/llm`) |
| `ttftP95High` | `TTFT_P95_MAX_MS = 3000` | TTFT P95 > 3s with ≥1 sample |

An empty window raises nothing (no samples ≠ a breach). `/v1/cost/live` is the same computation over
the last hour, trimmed to `{usdPerAction, cacheHitRate, fallbackRate, p95LatencyMs, ttftP95Ms, alarms}`
so a probe can alert straight off it.

### `scripts/cost-report.mjs`

`node scripts/cost-report.mjs --days 7 [--json] [--html out.html]`. With `API_URL` + `ADMIN_TOKEN`
set it reads `GET /v1/cost/summary`; otherwise it goes to Postgres directly — but through
**`apps/api/src/services/cost.ts` itself**, loaded with `tsx/esm/api`'s `register()`. There is no
second implementation of the maths, so the CLI and the API cannot drift. Zero new dependencies.

`--html` writes a standalone file: inline CSS with light/dark tokens, hand-drawn static SVG, no
script, no CDN, no fonts. Panels are exactly §6.4 — $/action and $/DAU over time, cache hit rate with
the 80% line drawn, TTFT P50/P95 with the 3s line, per-generator token composition as stacked bars,
the variant allocation table with each arm's $/call, "vs champion" and a quality proxy, plus the four
breakdown tables. Verified: the only `http://` string in the output is the provenance line.

### Additive extras on the response

`CostSummaryResZ` is returned verbatim; `ttft`, `perDay`, `variants`, `alarms`, `thresholds` and
`days` are extra keys the dashboard needs (a `CostSummaryResZ.parse()` strips them — the vitest case
asserts exactly that). `perDay` exists because §6.4 asks for `$/action` **over time**, which the
`CostRowZ` shape has no room for; it is one `FULL OUTER JOIN` between the daily generation rollup and
the daily spend count, so a day with actions but no calls (or the reverse) still yields a point.

Quality proxy per arm is `1 − (👎 + regenerations) / calls`, clamped — a cheap online stand-in until
§6.2's LLM judge exists. It is labelled as a proxy in both outputs.

### Observation from the real run

An escalated (👎 → regenerate) call keeps the user's assigned `variantId` but runs one tier up, so
`g1-haiku-v1` legitimately reports two models (`claude-haiku-4-5,claude-sonnet-5`) and its $/call
mixes tiers. The arm table surfaces this via `string_agg(DISTINCT model)` instead of hiding it. If
the bandit of §6.3 is ever driven off `usdPerCall`, escalations must be excluded first
(`escalatedFrom IS NULL`) or the challenger looks more expensive than it is.

### S3-6 — accessibility

The app had **zero** `accessibilityLabel`s. Covered in the files I own — `app/auth.tsx`,
`compose.tsx`, `index.tsx`, `energy.tsx`, `paywall.tsx`, `event/[id].tsx`, `post/[id].tsx`,
`onboarding/{scenario,persona,persona-edit,first-follower}.tsx` and
`src/components/{Avatar,Bubble,EnergyBadge,Skeleton,StatCard,Toast,ui}.tsx`:

- Every `Pressable`/`Button` has a role and a name from `useT()`; no English literal was introduced.
  Glyph-only controls (`‹`, `×`, `⚡`, `☕`, `★`) get the name on the control and
  `importantForAccessibility="no"` on the glyph, so nothing is read twice.
- `accessibilityState` for `disabled` / `busy` (`Button`, event choices) and `selected`/`checked` on
  the one-of-many pickers, which became **radio** roles inside a **radiogroup**: preset personas
  (SCR-004), first follower (SCR-006), paywall plans (SCR-030).
- The energy badge reads **"Energy 7"**, not a bare `7`, and carries `accessibilityValue`; SCR-032's
  big number reads "Energy 7 / 10" and the refill timer reads "next free refill in 04:12:55".
- `StatCard` rows read **"Aura +5, 25"** instead of `+5 → 25` (the testid'd node keeps its exact
  visible text, so E2E is unaffected); the aura/humor bars are `progressbar`s with
  `accessibilityValue {min:0,max:100,now}`; relationship chips read `@handle +2` instead of an arrow.
- Skeletons are removed from the tree entirely (`accessibilityElementsHidden` +
  `importantForAccessibility="no-hide-descendants"`), so a loading feed is silent rather than a wall
  of blank rows. Same for the DM typing bubble.
- `Toast`, `InlineError`, the `Field` error, and every inline error/success banner are
  `accessibilityLiveRegion="polite"` with `role="alert"` — the fallback and safety messages are the
  app's only channel for "that action did not land", so they must be announced.
- `Avatar` is decorative by default (it always sits next to its handle) and takes an optional
  `label` when rendered alone — SCR-005's preview passes one.
- `TextInput`s get a name and a disabled state but **no `accessibilityRole`**: RN's role list has no
  `textbox`, and forcing one of the allowed values would *replace* the implicit textbox role a real
  `<input>` already exposes on web. That is a deliberate omission, commented in `ui.tsx`.

All existing `testID`s are untouched; the a11y props are purely additive. `e2e/tests/cost.spec.ts`
pins the outcome for the feed: the energy badge's `aria-label` must match `/energy/i` and contain a
digit, and the composer's input/submit/cancel must all have a non-empty `aria-label`.

#### Two copy bugs fixed on the way (both in `onboarding/persona-edit.tsx`, both mine)

- the voice-notes field was labelled `t("save")` ("Save & continue"); i18n already has `voiceNotes`
  ("How do you talk? (optional)"). With the label now doubling as the accessible name this was no
  longer cosmetic.
- a taken handle showed `t("safetyBlocked")` ("This doesn't fit the world's guidelines."); i18n has
  `handleTaken` ("Taken").

#### i18n gaps found (nothing hardcoded; please add to `packages/shared/src/i18n`)

- **"up" / "down"** for stat deltas. §S3-6 asks for "Aura up 5"; with no localized words the label is
  `Aura +5, 25` (a screen reader reads `+` as "plus"). Add `statUp`/`statDown` and the label becomes
  the sentence the brief asks for.
- **"typing…"** for the DM typing bubble — hidden from the tree for now rather than inventing copy.
- **"back"** for `HeaderBar`'s `‹` — it currently borrows `close`.
- **"coffee"** — the badge's coffee count borrows `useCoffee` ("Use a coffee").

#### Not done (files I do not own)

`app/(tabs)/feed.tsx` and `dms.tsx`, `app/dms/[threadId].tsx`, `app/settings*.tsx`, `report.tsx`,
`delete-account.tsx`, `profile.tsx`, `moment/**`, `invite.tsx`, `memory/**` and
`src/components/PostCell.tsx` have **no a11y props**. `PostCell` matters most: it is the feed's
repeated unit, and its 👍/👎/overflow controls are icon-only, so a screen reader currently reads
three unnamed buttons per post. The tab bar and the DM thread are the next two. The patterns above
(name from `useT()`, glyph `importantForAccessibility="no"`, `radio` for pickers, live regions for
errors) transfer directly.

### Verification

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck`, `pnpm --filter e2e typecheck` — clean.
- `pnpm --filter api test` — **15 files, 103 passed** (17 of them new in `cost.test.ts`).
- `pnpm e2e` — **26 passed, 4 skipped, 1 failed**; the failure is
  `compliance.spec.ts S1-3/6` (settings consent toggle text), which is Agent G's file and unrelated.
  All 16 original P0 cases and both new `cost.spec.ts` cases are green.
- `node scripts/cost-report.mjs --days 7` against `rpgllm_test` after driving 16 real actions through
  the API: $/action **$0.008210**, $/DAU $0.032840, cache hit rate 88.4%, 37 generator calls across
  G1/G5/G8 and three models, 0 fallbacks, regeneration rate 5.41%, all three alarms clear.
  `--html` output is 17 KB and opens with no network access.

**A note for whoever runs the suites next:** `rpgllm_test` is shared. Two agents running
`pnpm --filter api test` (or Playwright) at the same time truncate each other's rows mid-test and
produce dozens of bogus `PrismaClientKnownRequestError` / arithmetic failures. `cost.test.ts`'s
aggregation assertions are pinned to a window in the *past* (the fixture sits on two whole UTC days
before today) precisely so a concurrent suite writing rows at "now" cannot perturb them; the HTTP
cases use `>=` for the same reason.

---

## Agent J — the visual system (`apps/mobile/src/ui/**`, `apps/mobile/src/components/**`)

The verdict on the previous build was "about 30 out of 100": system font with no hierarchy,
two-letter initials on flat discs for avatars, emoji standing in for icons (💬 🔁 ❤ ⚡ ☕ ⚙ 👍 👎),
no timestamps, flat black with 1px grey rules, no motion, and empty screens that read as broken.
This pass replaces the foundation those screens are built on. Screens themselves are owned by other
agents; everything below is available to them by import.

### New: `src/ui/**` — the primitives

| file | what it gives you |
| --- | --- |
| `Gradient.tsx` | `<Gradient colors angle locations style>` over `expo-linear-gradient` — a real CSS gradient on web, a native layer on iOS/Android, CSS angle convention (180° = downward). Plus `GradientRule` (a hairline that fades at both ends) and `Scrim`. |
| `Icon.tsx` | 35 SVG glyphs on one 24×24 grid at one 1.8 stroke, single `paths` map, props `name / size / color / filled`. Covers the required set plus `crown`, `refresh`, `clock`, `search`, `arrowUp`, `arrowDown`, `trendUp`, `trendDown`, `minus`. Hidden from the a11y tree — the control around an icon carries the name. |
| `Avatar.tsx` | Generated character portraits: a two-stop gradient orb in the handle's `identityFor()` colours plus one of ten geometric motifs (arcs, bullseye, scatter, equaliser bars, an eyes-and-smile face, a visor, a wedge, chevrons, an orbit, waves), chosen by an independent hash, with a light/ink inversion and a zoom step on top — ~700 distinct looks, deterministic across devices and reinstalls. Props `size / label / ring / badge / dim`. |
| `motion.ts` | Token easings as `Easing.bezier`, `timing()`, `duration`, `NATIVE_DRIVER`, `useAnimatedValue`, `useOnChange`, `useReduceMotion()` and `useHaptic()`. |
| `anim.tsx` | `AnimatedNumber` (per-digit roll, up or down with the value), `Pulse`, `Burst` (the like particles), `FadeSlideIn` (list stagger), `Shimmer` (skeletons), `PressScale`. |
| `type.ts` | The type ramp — `typo.hero/display/title/h1/h2/body/bodyStrong/name/meta/metaStrong/label/caption/micro/count/number`. Spread it, then set colour at the call site. |
| `fonts.ts` | Loads the two faces at import time and never blocks first paint; `useFontsLoaded()` re-renders a root once they land (native only — on web the browser reflows by itself). |

### Rewritten: `src/components/**`

Every exported name, prop shape and `testID` is unchanged.

- `ui.tsx` — `Screen` (now carries the violet top wash and the font gate), `Centered`, `Button`
  (gradient primary / tinted secondary / ghost / danger, pressed + disabled states, spinner, leading
  icon, `compact`, and a real focus ring on web), `Field` (focus border, UA outline suppressed on
  web), `HeaderBar` (SVG back chevron), `Wordmark` (SVG text with the brand gradient poured through
  it), plus new `IconButton`, `Card`, `SectionHeader`, `Divider`, `Row`, `Chip`.
- `PostCell.tsx` — display name semibold, verified as an SVG check on a disc, handle · `timeAgo()`
  dim on the same line (`T.postTime`), body at 16/23, SVG action icons with `compactNumber` counts,
  a `Burst` on like, identity-coloured 2px left rail on replies, overflow "…" pinned to the top-right
  of the name row. `ReplyCell` and every testID kept.
- `Avatar.tsx` — now a two-line re-export of `src/ui/Avatar`.
- `Bubble.tsx` — tails, grouped runs, relative timestamps, and a real three-dot typing animation.
  Adds `MessageStream` (grouping + tails computed from the array) for the DM screen to adopt.
- `EnergyBadge.tsx` — bolt icon, `AnimatedNumber`, glow + pulse at full, dim at empty.
- `Skeleton.tsx` — shimmer sweep instead of a static grey box.
- `StatCard.tsx` — the dopamine moment: the follower count counts up from where it was, bars grow
  from before to after, deltas get a coloured arrow (not colour alone), the cast that changed its
  mind is shown as faces, entrance staggered. The `T.stat*` nodes keep their exact `"+5 → 25"` text.
- `Toast.tsx` / `InlineError` — icon and colour by kind, slide-in, left accent rail.
- `Empty.tsx` (**new**) — `Empty` (icon in a glowing disc + headline + body + one action) and
  `EmptyLine`. Nothing in `src/ui`/`src/components` is a void any more; the screens that still are
  (DM list, notifications, blocked list, memory ledger) only need to import this.
- `DigestCard.tsx`, `MomentCard.tsx`, `Overflow.tsx` — moved onto the same system.

### Dependencies added (`apps/mobile`, via `npx expo install`)

`expo-linear-gradient@~57.0.1`, `expo-haptics@~57.0.2`, `@expo-google-fonts/inter@^0.4.2`,
`@expo-google-fonts/space-grotesk@^0.4.1`. Six font files (~1.4 MB) land in the web export.

**`react-native-reanimated` was deliberately not added.** It needs a `babel.config.js` (there is
none) and a worklets runtime, and three other agents were mid-flight on the same web export; the
risk of breaking everyone's build outweighed the benefit, because RN's own `Animated` — which
react-native-web already implements — covers every effect the design calls for. `motion.ts` sets
`useNativeDriver` from `NATIVE_DRIVER` (false on web) so no animation logs a fallback warning.

### Fonts

Space Grotesk (display: wordmark, hero numbers, level-ups) and Inter (text). `src/ui/fonts.ts`
calls `Font.loadAsync` as a module side effect — fire and forget, nothing awaits it, and a failed
load leaves the platform stack in place. Verified on the web export: `post-text` computes to
`Inter_400Regular`, `post-author` to `Inter_600SemiBold`, the wordmark to `SpaceGrotesk_700Bold`.

**Screens that style raw `<Text>` themselves still render in the system stack.** Font loading is a
root concern and `app/_layout.tsx` is not mine; the fix for a screen owner is one import —
`import { typo } from "../src/ui"` — and spreading the matching role instead of `{ fontSize, fontWeight }`.

### Tokens / strings I wanted and did not have

- **`news` copy.** `PostCell` labels a `kind === "news"` post with a chip. `en.ts` has no `news`
  key, so it uses `t("event")` ("Event"). The previous code hardcoded the literal `"NEWS"`, which
  breaks rule 4. A `news: "News"` string would be the right fix.
- **`up` / `down` for stat deltas** exist but read oddly in the a11y name; `StatCard` still builds
  `"Aura +5, 25"` (Agent I noted the same gap).
- No token gap in `tokens.ts` — the new palette, `identityFor`/`hashString`, `timeAgo`,
  `compactNumber`, `layout.avatar*`, `elevation`, `glow` and `motion` covered everything.

### One thing the E2E owner should know

`T.postTime` (`"post-time"`) is now rendered, and `POST_CELL` in `e2e/fixtures.ts` is
`[data-testid^="post-"]` minus `post-kind-*`, `post-text`, `post-author` — so it also matches the
timestamp nodes. Verified against every current use and none breaks: `cellsOfKind` filters on a
`post-kind-*` descendant, `cellsByHandle`/`repliesBy` filter on handle text, `postCells().first()`
is still the cell (document order), and the only count assertion is `toBeGreaterThan(0)`. Adding
`:not([data-testid="post-time"])` to `POST_CELL` would make that robust rather than lucky.

### Left to the screen owners

Icons in the tab bar, a gradient compose FAB, `Empty` on the DM/notifications/blocked/memory
screens, `MessageStream` in `app/dms/[threadId].tsx`, and the emoji still hardcoded in
`app/energy.tsx` (⚡ ☕ ⭐ ▶) and `app/(tabs)/_layout.tsx`. All of these are one import away.
`src/components/Brand.tsx` (onboarding chrome) already builds on `src/ui`; the radial orb it adds is
the one thing `expo-linear-gradient` cannot do.

### Verification

- `pnpm --filter mobile typecheck` — clean for every file in `src/ui/**` and `src/components/**`.
  (The run also reports errors in `app/index.tsx`, `app/onboarding/*` and the new
  `PersonaCard`/`WorldCard`/`IntroSlides`: another agent was mid-refactor of `Brand.tsx`'s exports
  while I ran it. None are in my files.)
- Web export — `expo export -p web` succeeds. Run into `dist-j` rather than `dist` so as not to
  clobber a parallel agent's served build; same command, same code path.
- Every previously existing `testID` re-verified in the DOM of the real export, driven through the
  UI: `feed-list`, `post-<id>`, `post-kind-user|character`, `post-text`, `post-author`, `post-time`,
  `overflow-<id>`, `energy-badge` (reads a bare `"7"`, so `badgeEnergy()`'s regex is unaffected by
  the digit roll), `compose-fab/-input/-submit`, `stat-card`, `stat-aura` (`"+3 → 25"`),
  `stat-followers`, `stat-humor`, `stat-narrative`, `stat-continue`, `reply-<id>`, `rate-up-<id>`,
  `rate-down-<id>`, `reply-btn`, `dm-bubble`, `energy-modal`, `energy-value`. Zero page errors.
- `pnpm e2e` could not be run to completion: `app/onboarding/persona.tsx` currently throws React
  #130 (an undefined component — `Brand.tsx` exports being refactored under it), so every case dies
  in `enterWorld()` before reaching a screen I own. Re-run once that lands.

---

## Agent K — feed & discovery (SCR-010 rewrite, SCR-046 Explore, SCR-047 character pages)

The feed was the screen people live in and it was a wall of same-sized text: no timestamps, no
pictures, no sense of which world you were in, no idea what anyone was talking about, and no way to
reach a character. Everything below exists to fix that.

### API

| Endpoint | Contract | Notes |
|---|---|---|
| `GET /v1/trending?personaId=` | `TrendingResZ` | topics, rising characters, your rank |
| `GET /v1/characters/:handle?personaId=` | `CharacterProfileResZ` | resolves by handle (with or without `@`, any case) **or** by character id |

New services: `services/media.ts`, `services/heat.ts`, `services/trending.ts`. Two route files
(`routes/trending.ts`, `routes/characters.ts`) and two `v1.route` lines in `app.ts`.

- **heat** (`services/heat.ts`) — 0..100 from the 演出 metrics on a log curve (saturating at ~5000
  weighted engagements), decayed 35% over two days, +12 for a news post, plus up to 25 for the stat
  swing the post caused. `HEAT.HOT` earns a flame and an identity rail in the feed.
- **trending** (`services/trending.ts`) — topics are extracted deterministically from the text of
  the last 120 posts: hashtags, then capitalised runs, then word pairs, then bare words, each tier
  sorted by post count and heat, with a containment check so "second chorus" suppresses "chorus".
  Contractions and a small hand-written stop list are dropped. Rising characters sum
  `StatSnapshot.relDeltas` **in SQL** (`jsonb_each_text` + `jsonb_exists`), the persona/world counts
  are a SQL aggregate, and the heat curve is written once more in SQL (`SQL_HEAT`) so ranking never
  loads rows into JS. `$2` is always the injectable clock, never `now()`, so `/__test/time-travel`
  keeps working. Blocked characters are excluded from the topic window and the rail.
- **rank** — a world is not eight famous characters, it is eight famous characters and a crowd. The
  percentile is computed against a 10,000-account power-law population (`P(X>f) = (50/f)^0.8`) plus
  the cast plus the other personas. Without the crowd a new persona is "top 100%" forever, which is
  accurate and product suicide; with it a fresh account reads ~45% and becomes `youAreTrending` at
  the top 25%.
- **character bio** — `WorldCharacter.card` is a prompt, not a bio: it opens with `Voice:` and ends
  with an `NG:` line of things the model must never do. `bioFrom()` strips both and keeps the rest.

### Two deliberate duplications (please read before "fixing" them)

1. **`Post.mediaKind` / `mediaSeed` / `heat` never reach the client.** They exist in
   `schema.prisma` and the server stamps them, but `PostZ` in `packages/shared/src/api.ts` has no
   field to carry them and `packages/shared` is frozen for this pass. So the client derives the same
   values in `apps/mobile/src/lib/derive.ts`: media from the post id via the *shared* `hashString`
   (byte-identical to `services/media.ts` by construction), heat from the same curve over metrics +
   age. The server additionally folds in the stat swing, which only ever raises its number — so a
   post the client draws cool is never one the server called viral. **If `PostZ` ever gains
   `mediaKind`/`mediaSeed`/`heat`, delete `derive.ts`'s copies and read the fields.**
2. The heat curve exists three times: TS (`services/heat.ts`), SQL (`services/trending.ts`), and
   the client mirror. Change one, change all three; the doc comment on each says so.

### Procedural post media — no bitmaps, anywhere

`components/PostMedia.tsx` draws the picture from the seed with `react-native-svg`, so it is
identical on iOS, Android and web, costs nothing to serve, can never 404, and carries no likeness
or scraped photo. Three kinds (`MEDIA_KINDS`): `art` (gradient/blob/arc composition in the author's
identity colours, plus film grain, at 16:9, 4:5 or 1:1), `chart` (a stream count going up or down,
wordless so it needs no translation), `leak` (a redacted message-thread screenshot — the receipts
that drive every scandal). `T.postMedia(id)`.

Rate: `MEDIA_EVERY` (1 in 4) for character/ambient posts, **1 in 2 for the press account** — a
gossip feed without screenshots is not a gossip feed. Excluded: the player's own posts (no camera
roll in this world) and *replies*, so `MEDIA_EVERY` means "one in four cells you scroll past"
rather than one in four rows of the table.

### Client

- `app/(tabs)/feed.tsx` — rewritten. Header (`T.feedHeader`): world chip (`T.worldChip`, gradient
  dot + world title, taps into Explore), Agent L's `StreakChip`, the energy badge, the settings
  gear. Under it the `TrendingStrip` (`T.trendingList`, heat-coloured chips, tap filters the feed
  on the topic, tap again clears). Rows are a local `FeedRow`: Agent J's `PostCell` unchanged, then
  the picture inset to the text column (`marginTop: -1` covers the cell's own hairline so it reads
  as part of the post), then the replies on their identity rail, all inside a `FadeSlideIn` stagger
  capped at 6 rows. A hot post gets a `TRENDING NOW` ribbon and an identity-coloured left rail.
  Pull-to-refresh reloads the feed *and* the strip; `onEndReached` pages the cursor with a real
  footer spinner; the empty state is a gradient card instead of a line of grey text.
  Every pre-existing testID is intact (`T.feedList`, `T.post(id)`, `T.composeFab`, `T.energyBadge`,
  `T.eventBanner`, `T.statToast`, `T.fallbackToast`, `T.settingsBtn`, `DigestCard`, `MomentCard`,
  `StatCard`) and the blocked-character filter still runs client-side over the server-filtered read.
- `app/explore.tsx` (SCR-046) — rank card (`T.trendingRank`, `youAreTrending` when it applies),
  heat-ranked topic cards with a heat bar, the "rising with you" avatar rail
  (`T.risingCharacter(handle)`), and the other preset worlds as invitations to start a second story.
- `app/character/[handle].tsx` (SCR-047) — identity-gradient hero, role chip, follow state
  (`T.characterFollowState`), a centre-out affinity bar, a link into the memory ledger, DM and
  block/unblock, and their recent posts with media (`T.characterPosts`). Reachable from the rising
  rail and from a hit target over any author's avatar in the feed.
- Shared files touched, minimally: `app/(tabs)/_layout.tsx` (one Explore tab entry, `T.tabExplore`),
  `src/api/client.ts` (`api.trending`, `api.character` + two exported types),
  `services/post-stream.ts` and `routes/posts.ts` (media/heat stamped in the same update as the
  metrics). **`src/state/store.tsx` was not touched at all** — trending is local state in the two
  screens that use it, which also keeps it off the critical path of a feed load.

### Note for whoever owns `e2e/fixtures.ts`

`POST_CELL` is `[data-testid^="post-"]` minus `post-kind-*`, `post-text`, `post-author`. It now also
matches `post-time` (Agent J) and `post-media-<id>` (mine). Verified harmless against every current
use — `cellsOfKind` filters on a `post-kind-*` descendant, the handle filters match on text,
`.first()` is still the outer cell in document order, and the only count assertion is
`toBeGreaterThan(0)`. `discovery.spec.ts` uses its own selector with both exclusions added.
Adding `:not([data-testid="post-time"]):not([data-testid^="post-media-"])` to `POST_CELL` would make
that robust rather than lucky.

### Verification

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck` — clean.
- `pnpm --filter api test` — **154 passed / 20 files** (was 103). 30 of those are new, in
  `test/trending.test.ts` and `test/characters.test.ts`: the heat curve (rises with engagement,
  decays with age, counts the stat swing), media determinism / rate / reply-and-user exclusion /
  press-account bias, topic extraction (phrase beats bare word, hashtags, no contractions,
  containment dedupe, a multi-word name outranking an accidental capital, deterministic, empty
  rather than noisy), the rank curve (a new account is
  never "top 100%", it climbs, `crowdAbove` is monotonic), bio extraction, both endpoints against
  their zod contracts, blocked-character filtering, and the ownership/auth 404s and 401s.
- `pnpm e2e` — **42 passed, 4 skipped (P1), 1 failed**. The failure is `firstrun.spec.ts` M-004
  ("a taken handle is refused" on the persona editor, SCR-005) — Agent M's own in-flight screen,
  no feed/discovery code on its path. Every pre-existing case passes, and DISC-001..006 pass.
- Both suites were run against private databases (`rpgllm_k`, `rpgllm_k2`): three agents share
  `rpgllm_test`, and `scripts/db.sh reset` drops it out from under whoever else is mid-run.
  For vitest the variable that works is `TEST_DATABASE_URL` — the vitest config's `env` block
  overrides a plain `DATABASE_URL`. For Playwright it is `E2E_DATABASE_URL` together with
  `E2E_SKIP_DB=1` (globalSetup's `db.sh reset` is hardcoded to `rpgllm_test`, and it drops the
  database *after* the API webServer has already connected, which leaves every `/__test/reset`
  returning 500 "Server has closed the connection" — worth fixing in globalSetup).

## Agent L — engagement surfaces (notifications, streak, achievements, celebrations) — 2026-09-04

The teardown's §0 number is 96 minutes a day, and §8 says the reason is the dopamine surfaces, not
the feed. The MVP had none of them: no notifications tab, no streak, no achievements, no celebration
moment. This section adds all four end to end.

### API

| Endpoint | What it does |
|---|---|
| `GET /v1/notifications?personaId=&cursor=` | `NotificationsResZ` — newest first, `unread` count, id-cursored paging (30/page), actor joined |
| `POST /v1/notifications/read?personaId=` | `{ids: null}` = all → `MarkNotificationsReadResZ` |
| `GET /v1/streak` | `StreakResZ` — runs the daily check-in (idempotent), returns days/best/ladder/reward |
| `GET /v1/achievements?personaId=` | `AchievementsResZ` — re-evaluates, then the whole catalogue with `progress` on locked rows and `pending` for unlocked-but-unseen |
| `POST /v1/achievements/seen?personaId=` | marks the given keys seen |

New services: `services/notify.ts`, `services/streak.ts`, `services/achievements.ts`.
New routes: `routes/notifications.ts`, `routes/streak.ts`, `routes/achievements.ts` (three `v1.route`
lines in `app.ts`).

#### What writes which notification — and where

Every `notify()` call takes a transaction client and runs **inside the transaction of the thing that
caused it**, so a notification can never survive a rolled-back reply/event/digest.

| kind | written by | target |
|---|---|---|
| `reply` | `services/post-stream.ts` → `materializeReplies`, one per character reply to *your* post | `post:<id>` |
| `like` | same place, one per reacting character, **capped at 3 per post** (`LIKES_PER_POST`; the cap counts existing rows, so `more-replies` cannot push it over) | `post:<id>` |
| `follow` | `services/story.ts` → `applyRelationshipDeltas` and `services/dm-stream.ts`, when affinity crosses `FOLLOW_AT` (10) for the first time | `profile` |
| `dm` | `services/dm-stream.ts` (one per character turn) and `jobs/offline-director.ts` (the proactive DM) | `dm:<threadId>` |
| `event` | `services/events.ts` → `generateEvent` | `event:<id>` |
| `digest` | `jobs/offline-director.ts` → `generateDigestFor` | `digest:<id>` |
| `milestone` | `notifyFollowerMilestones()` from the post stream's stat transaction and from `POST /v1/events/:id/choose` | `profile` |
| `unlock` | `services/achievements.ts` → `evaluate` | `achievement:<key>` |

`text` is rendered **server-side in the persona's locale** when the row is written (`Notification.text`),
so SCR-042 is one indexed query plus the actor join and needs no post/event/achievement lookups. The
i18n verbs (`repliedToYou`, `likedYourPost`, …) are written as suffixes, so `actorLine()` joins with a
space in EN and without one in JA.

#### Achievements

`evaluate(prisma, personaId, locale)` computes all ten metrics with **aggregate queries in one
`Promise.all`** — `post.count`, `event.count`, `dMMessage.count`, `memoryEntry.count`,
`relationshipState.aggregate({_max: affinity})`, `statSnapshot.count` — never by loading rows.
`cancels` is defined as **resolved events whose stat snapshot had a negative follower delta**
(`cause LIKE 'event:%' AND followersDelta < 0`). It is called after every energy-spending action
(`POST /v1/posts`, `POST /v1/dms/:id/messages`, `POST /v1/events/:id/choose`) through
`evaluateQuietly`, which swallows its own errors so the collection drive can never fail an action.
`AchievementUnlock` is unique on `(personaId, key)`, and the P2002 branch makes a race a no-op, so an
achievement unlocks and notifies exactly once.

### Deviations (please read)

1. **The streak has no columns.** The brief specifies `User.streakDays` / `User.streakBestDays`, but
   `prisma/schema.prisma` has neither and is not mine to edit this pass. The streak is therefore
   **derived from the ledger it pays into**: each check-in writes an energy `LedgerEntry` with
   `source: daily_refill` and `ref = "streak:<YYYY-MM-DD>:<day>:<best>"`. One `findFirst` on the newest
   such row is the whole read; the payout and the history cannot disagree; the wallet screen already
   renders the entries. If someone adds the columns later, `services/streak.ts` is the only file to
   change. **The energy row is written even at +0** because it is the state record.
2. **The streak's energy is capped at the wallet's daily maximum.** Coffee and gems are paid in full,
   energy only tops the tank back up (`min(reward.energy, dailyMax - energy)`). Two reasons: it is the
   coherent economy rule (`ensureWallet` already refills to that ceiling), and without it the day-1
   check-in would hand every brand-new account +2 energy and break the exact-energy assertions in
   `posts/dms/wallet/auth` vitest and in E2E-003/007/008/015. `StreakResZ.reward` reports the **nominal
   ladder value** for the day so the card can show what the day is worth; the ledger records what was
   actually credited.
3. **`GET /v1/me` gained a `streak` field.** Additive; `MeResZ` strips it on the client, which reads
   `GET /v1/streak`. The check-in runs on the first `/v1/me` of a UTC day as specified, and
   `GET /v1/streak` re-runs it idempotently so whichever call lands first pays.
4. **`T.streakChip` is not in the feed header.** `app/(tabs)/feed.tsx` is Agent K's. `StreakChip` is
   exported from `src/components/StreakCard.tsx` and currently sits in the notifications and
   achievements headers. **Agent K: one line — `import { StreakChip } from "../../src/components/StreakCard"`
   and drop `<StreakChip />` into the feed header — and it is where the spec wants it.**
5. **The streak card over the feed is gated to `days >= 2`.** `EngagementOverlay` (mounted once in
   `app/_layout.tsx`) shows it only on `/feed`, only for a streak the player actually built, only once
   per UTC day, `pointerEvents="box-none"`, auto-retiring after 6s. Day 1 is still onboarding, and an
   overlay that appeared for every fresh E2E account would have intercepted the composer. The full card
   is always reachable at the top of SCR-042.
6. **Celebrations never auto-fire over the feed for achievements.** A level up and a follower
   milestone are detected by comparing `me.persona` across two `/v1/me` reads and celebrate
   immediately; achievement unlocks celebrate when SCR-044 loads their `pending` list. The overlay is
   suppressed while SCR-013's stat card is up, its backdrop is `box-none` so a stray tap falls through,
   and it auto-dismisses after 2.6s. That is what keeps it from ever standing between the player (or a
   Playwright click) and the screen underneath.

### Client

- `app/notifications.tsx` (SCR-042) — grouped by day, unread rows tinted with a left accent rail in
  the kind's colour, actor avatar with a kind pip, `timeAgo`, tap routes by `target`
  (`post:` → `/post/[id]`, `dm:` → the thread, `event:`, `achievement:` → SCR-044, else the feed),
  `T.notifMarkAll`, infinite scroll on the cursor, and an illustrated empty state with `notifEmpty`.
- `app/achievements.tsx` (SCR-044) — a grid by tier with its own treatment per tier (bronze shield →
  legendary crown + hot/violet gradient), locked tiles dimmed with a progress bar, unlocked ones in
  full colour with the date, plus an `unlocked / total` header. Reached from the profile
  (`T.achievementsOpen`).
- `src/components/StreakCard.tsx` — `StreakChip` (flame + day count, pulsing from day 3) and
  `StreakCard` (the seven-rung ladder, today's payout counting up with `AnimatedNumber`, `T.streakClaim`).
- `src/components/AchievementCard.tsx`, `src/components/Celebration.tsx` (+ `EngagementOverlay`).
- `app/(tabs)/_layout.tsx` — the Notifications tab and its unread badge (`T.notifBadge`). The count
  refreshes when a persona exists and again whenever a stream finishes, so the badge appears the
  moment a reply lands, with no reload.
- `src/api/client.ts` / `src/state/store.tsx` — the five endpoints, `notifications`/`notifUnread`/
  `streak`/`achievements`/`celebration` state and their actions. Mark-all-read is optimistic.

All of it is built on Agent J's `src/ui` (`Icon`, `Avatar`, `Gradient`, `AnimatedNumber`, `Burst`,
`Pulse`, `FadeSlideIn`, `typo`) — no colour, spacing or motion outside the tokens, no copy outside
i18n, every interactive element has its `testids.ts` id plus `accessibilityRole`/`accessibilityLabel`.
There is no `Empty` component in `src/ui` yet, so SCR-042's empty state is local; it is three elements
and would move cleanly if one lands.

### Verification

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck`, `pnpm --filter e2e typecheck` — clean.
- `pnpm --filter api test` — **20 files, 146 passed** (21 of them new across
  `notifications.test.ts`, `streak.test.ts`, `achievements.test.ts`).
- `pnpm e2e` — **40 passed, 4 skipped, 3 failed**. All 27 pre-existing cases pass, and so do the five
  new `engagement.spec.ts` cases (ENG-001…005). The three failures are `discovery.spec.ts` DISC-002 /
  DISC-004 and `firstrun.spec.ts` M-004 — other agents' in-flight files, untouched by this work.

**On running the suites while four agents share one box:** `rpgllm_test`, port 4000 and port 8082 are
all contended, and a concurrent run makes `POST /v1/__test/reset` return 500 and `expo export` serve a
stale `dist`. The reliable recipe is a private stack: create your own database, `prisma migrate deploy`
+ `pnpm --filter api seed` into it, start the API on a port nobody else has taken (4000/4100/4200 were
all in use), `npx expo export -p web --output-dir dist-<you>` with `EXPO_PUBLIC_API_URL` pointing at
it, serve that dir with `apps/mobile/scripts/serve-web.mjs dist-<you>`, then run Playwright with
`E2E_SKIP_DB=1 E2E_SKIP_EXPORT=1 API_URL=… WEB_URL=…` so it reuses your servers instead of resetting
the shared database out from under someone else.

## Orchestrator — streak storage (follow-up on Agent L)

The `User.streakDays` / `streakBestDays` / `streakLastAt` columns I intended to add in the
engagement migration **did not land** — the string replacement missed after `prisma format`
reflowed the model, and I did not catch it before Agent L started. They correctly worked around it
by deriving the streak from the `LedgerEntry` row each check-in writes
(`ref = "streak:<date>:<day>:<best>"`), which is idempotent and covered by tests.

Known limitation: the streak is only as durable as the ledger. If a retention policy ever prunes
`LedgerEntry`, streaks silently reset. Before that happens, add the three columns and switch
`services/streak.ts` to read them — it is the only file that needs to change.

---

## Agent M — the first 90 seconds (SCR-002 → SCR-003 → SCR-004/005 → SCR-006, plus `/`)

### What the first run is now

1. **`/` — a branded boot, not a spinner.** `app/index.tsx` renders a splash (gradient wordmark +
   `wakingUp`) that **fades in after 180 ms**, so a warm boot never flashes it, and paints the app
   background so there is no white frame either. Routing logic is unchanged.
2. **`/auth` — a cold open above a sign-in that is never blocked.** The top of the screen is
   `IntroSlides`: three auto-advancing, swipeable, skippable slides with a progress rail —
   *"Who do you want to play as?"* (a generated portrait morphing through identity gradients,
   orbited by the palette), *"What they remember"* (a DM exchange landing bubble by bubble, ending
   in `seen`), *"You're trending"* (a feed card whose follower count **falls** while a gradient
   headline lands on it). Under it, always on screen and never covered, the sign-in sheet: promise
   line, gradient CTA, focus/error states, and the legal links. The age gate takes over the sheet
   as its own step; the under-13 screen is a lit orb, a `13+` badge, the message and the
   guidelines — a closed door, not a rejection slip.
3. **`/onboarding/scenario` — three worlds, three covers.** `WorldCard` draws a **generated** cover:
   a seeded (mulberry32 over `hashString(slug)`) composition of gradient sky, light beams, scattered
   stars, a horizon arc and a fade to the app ground. Plus the one-line scenario, difficulty in
   sparkles, and three overlapping cast avatars (`+N`).
4. **`/onboarding/persona` — choosing a character.** A grid of large generated `Avatar`s; the chosen
   one scales up with its identity halo and a white ring, its handle in the brand type and its bio
   in a fixed-height preview strip.
5. **`/onboarding/persona-edit` — your identity as you type.** The portrait and its halo re-hash on
   every keystroke, with live handle availability (`✓ Available` / `Taken`) in a fixed-height row.
6. **`/onboarding/first-follower` — the moment the story starts.** Each candidate is a card with
   portrait, name, role chip in their identity colour and their one-line intro; choosing one tints
   the card with their gradient and shows what changes (`Follows you`, `What they remember`,
   `Characters text you first`). `Planting the first ripple…` is a real beat — three rings leaving
   the follower in the world's colours — that clears the instant `POST /personas` answers.

### Things other agents need to know

- **New file `apps/mobile/src/components/Brand.tsx`** (beyond the three components I was given). It
  holds only what `src/ui` does not: `SoftOrb` (a *radial* gradient orb — `expo-linear-gradient` is
  linear only, so this stays SVG), `Aurora` (the drifting identity-palette background), `StepDots`,
  `Round`, and `FILL`. **`FILL` exists because RN 0.86 dropped `StyleSheet.absoluteFillObject` from
  the public types** — reuse it rather than re-discovering that.
- Everything else on these screens is Agent J's system: `Screen`, `Button`, `Field`, `Chip`,
  `Wordmark` from `src/components/ui`, and `Avatar`, `Gradient`, `Icon`, `typo`, `FadeSlideIn`,
  `PressScale`, `AnimatedNumber`, `timing`/`ease`/`duration`/`useAnimatedValue`/`useReduceMotion`
  from `src/ui`.
- **Two bugs found in `src/ui` / `ui.tsx` (Agent J's files — I did not edit them):**
  1. **`Wordmark` uses a hard-coded SVG gradient id `"wordmark"`.** Expo Router keeps the previous
     screen mounted, so as soon as two `Wordmark`s exist the second resolves `url(#wordmark)`
     against the *first* (hidden) `<defs>` and renders **invisible**. `Avatar` already does this
     correctly with a per-instance `uid` — `Wordmark` should do the same. Worked around here by
     showing the wordmark only on `/` and `/auth`; every other screen that renders one after a
     navigation will hit this.
  2. **`Screen`'s top wash ends in a hard horizontal seam** — the gradient's last stop is not
     transparent, so its 460 px box has a visible bottom edge on wide viewports. The onboarding
     screens pass `wash={false}` (their `Aurora` supplies the atmosphere) rather than paper over it.
- **`Aurora` is clipped (`overflow: "hidden"`).** Before that, the absolutely-positioned orbs were
  wider than the viewport and gave the *page* a horizontal scrollbar on web (a white band down the
  right-hand side in any full-page screenshot). Any full-bleed decoration needs the same clip.
- **Layout stability is a test contract, not a nicety.** Playwright will not click a moving target.
  So: the intro deck has a fixed height and cross-fades in place; persona tiles scale by transform
  only; the persona preview strip and the handle-status row have fixed heights; and SCR-006's
  "Enter the world" lives in a **fixed footer outside the scroller**, so expanding a card never
  moves it. Please keep it that way.
- **`/onboarding/scenario` prefetches the three worlds' details** (`api.world`) after the cards are
  on screen, purely to fill the cast strip. It never blocks the tap: the card is clickable the
  moment `GET /v1/worlds` answers.
- **Intro-seen flag:** `localStorage["rpgllm.introSeen"] = "1"` on web, `AsyncStorage` on native,
  written when the deck reaches the last slide or is skipped. On the next visit the deck collapses
  to one still frame (148 px, no timer). It is also collapsed automatically when the viewport is
  under 560 px tall. Nothing else reads the key; clearing it just replays the intro.
- **No `packages/shared` edits.** No new i18n keys, no new testids, no token changes.
- Reduced motion is honoured everywhere via `useReduceMotion()`: the morph, the orbit, the aurora
  drift, the bubble stagger, the falling counter, the ripples and the splash pulse all render their
  final frame instead of moving.

### i18n gaps (nothing invented; the closest existing key is used)

The cold open and the first-follower preview are built entirely from existing strings, which works
but is not what a writer would choose. Requests for `packages/shared/src/i18n`:

| where | key used now | what it should say |
|---|---|---|
| intro slide 3 subtitle | `ach_survivor_desc` ("Come back from being cancelled three times") | a line about surviving the drama |
| intro skip button | `close` ("Close") | `skip` ("Skip") |
| SCR-006 "what changes" chips | `follows`, `remembers`, `plusFeatures[1]` | `firstFollowerPreview`, e.g. "{name} will be watching everything you post" |
| SCR-002 sheet subtitle | `pickStory` ("Pick your story") | a second promise line under the tagline |
| SCR-002 age gate subtitle | `guidelines` | a short reassurance about why the year is asked for |

The mock DM bubbles and the mock feed post in the deck deliberately contain **no text at all** —
they are shapes — precisely so that nothing on screen is copy that does not exist in `i18n`.

### Verification

- `pnpm --filter mobile typecheck` — clean.
- `pnpm --filter mobile export:web` — succeeds (2 MB bundle).
- `pnpm e2e` on isolated ports (API 4200 / web 8291 serving `apps/mobile/dist-m`):
  **43 passed, 4 skipped, 0 failed** — every previously-green case plus the five new
  `e2e/tests/firstrun.spec.ts` cases (M-001…M-005). E2E-001/002/011/012/016 all green.
- Screenshotted at 420×900, 1280×800, in JA, and with `prefers-reduced-motion: reduce`.

**Note on running the suite concurrently:** if the API is started by Playwright's `webServer` it
connects *before* `globalSetup` drops and recreates `rpgllm_test`, and the first ~8 tests then fail
with `POST /v1/__test/reset → 500` until Prisma reconnects. Reset/migrate/seed by hand, start the
API, then run with `E2E_SKIP_DB=1` for a deterministic run. Also: `expo export` **must** be given
`--clear`, or `EXPO_PUBLIC_API_URL` is served from the stale Metro cache and the bundle silently
talks to the previous port.

## Agent P — monetization & notifications (RevenueCat, push) — 2026-09-04

The app could not take money (RevenueCat was a stub, the webhook a `TODO(P1)` 200) and could not
reach anyone (push had an interface and no transport). Both are now real, both are documented for
the human who has to click through App Store Connect / Play / RevenueCat / Firebase:
**`docs/billing.md`** and **`docs/push.md`** are part of the deliverable, not decoration.

### API surface

| endpoint | what changed |
|---|---|
| `POST /v1/billing/webhook` | was a 200 stub. Now: HMAC/shared-secret verification → parse → apply idempotently. 401 on a bad or missing signature, 400 on an unparseable body, **200 for everything else** (a non-2xx makes RevenueCat retry an event that can never apply) |
| `POST /v1/billing/restore` | was a stub reading the local row. Now calls `GET /v1/subscribers/{id}` on the RevenueCat REST API and reconciles; without `REVENUECAT_SECRET_KEY` it returns the local row with `source:"local"` and a `note`, and never pretends it checked |
| `POST /v1/billing/dev-purchase` | **unchanged** — E2E-008 depends on it byte for byte |
| `GET /v1/billing/offerings` | unchanged |
| `POST /v1/push/register` | unchanged (Agent H's) |

New services: `services/billing.ts` (signature, event mapping, apply, restore),
`services/entitlements.ts` (the single entitlement authority). `services/push.ts` rewritten.

### Webhook event mapping

`Purchase.rcEventId` is the idempotency key **for the whole effect**: the receipt row is created
first, inside the same transaction as the subscription and wallet writes, so a redelivery hits the
unique index and rolls everything back. Enforced by the database, not by a code path
(`billing.test.ts` also runs two applications of one event concurrently).

| event | Subscription | wallet |
|---|---|---|
| `INITIAL_PURCHASE` / `RENEWAL` / `PRODUCT_CHANGE` / `UNCANCELLATION` | plan (from `new_product_id ?? product_id`), `active=true`, `renewsAt`=expiration | energy topped up to the plan's daily max (never lowered) |
| `CANCELLATION` / `SUBSCRIPTION_PAUSED` | untouched — access runs to `renewsAt` | — |
| `BILLING_ISSUE` | `renewsAt` = grace end (else period end) — entitlements survive the retry | — |
| `EXPIRATION` | `renewsAt` = expiration; `active=false` only when that is already past | — |
| `REFUND` | `active=false`, `renewsAt=null` — the **only** immediate revocation | energy clawed back to `ENERGY.FREE_DAILY`; the `Purchase` amount is negative |
| `TRANSFER` | entitlement copied to the receiving account, deactivated on the donor | — |
| `SUBSCRIBER_ALIAS` | `rcSubscriberId` re-pointed, plan untouched | — |
| `NON_RENEWING_PURCHASE` / unknown types | recorded as a `Purchase` only | — |

Unknown `app_user_id` → 200 `applied:false reason:"unknown_user"`, nothing written.

### Entitlement rules (`services/entitlements.ts`)

`prisma/schema.prisma` was not mine to change, so the whole subscription lifecycle is expressed with
the three columns that exist — `plan`, `active`, `renewsAt`:

```
active=false                  → nothing            (immediate revocation: REFUND)
active=true,  renewsAt=null   → entitled
active=true,  renewsAt > now  → entitled           (also: cancelled-not-yet-expired, grace, billing retry)
active=true,  renewsAt <= now → nothing            (period ran out; no webhook needed)
```

That last line is why "an expiration drops entitlements at the period end" and "a user in billing
retry keeps entitlements until `renewsAt`" are the *same* rule, and it fails safe: a lost
`EXPIRATION` webhook still lapses on time. Capabilities: `dailyEnergyMax`, `adFree`,
`proactiveDMs`, `relationshipVibes`; Plus grants all four, `adfree_monthly` grants only `adFree`.
`wallet.ts`'s `dailyMaxFor` / `adFreeFor` are now thin wrappers over `entitlementsFor` — there is
exactly one place that decides what a subscription is worth, and a vitest case asserts the three
agree in every state.

### Push policy

Off unless `PUSH_ENABLED=1`; every send then logs and returns `{skipped:true, reason:"disabled"}`.
With it on: chunks of **100**, tickets read, ticket ids checked against the receipts endpoint, and
any token reported `DeviceNotRegistered` (ticket or receipt) is **deleted**.

Fires on: the digest (from `jobs/offline-director.ts`, unchanged), a proactive DM, an event, and a
follower milestone. `reply`/`like`/`follow`/`unlock` deliberately never push — they arrive in bursts
right after the user's own action. Gates, all in `shouldSend()`:

- **quiet hours** 23:00–08:00 local. **Assumption (documented in `docs/push.md`):** there is no
  timezone column on `User`, so local time is inferred from the locale — `ja` → `Asia/Tokyo`,
  everything else → `PUSH_DEFAULT_TZ` (UTC). `timezoneForLocale` is the only function to change when
  a real timezone is recorded at registration.
- **daily cap** `PUSH_DAILY_CAP` (4) per user per local day.
- **quiet gap** `PUSH_MIN_GAP_MINUTES` (15) between notification-derived pushes; the digest push
  bypasses the gap but still counts against the cap.
- **away only** — a notification pushes only once the user's last own post/DM is older than
  `PUSH_AWAY_MINUTES` (30). A `dm` notification is additionally suppressed while an unseen digest
  younger than 5 minutes exists, so one director run cannot buzz the phone twice.

Counters are in-process maps (same single-process assumption as `src/types.ts`); behind N instances
the cap becomes N×. `resetPushPolicy()` is the test seam.

Client: the permission prompt is **locked until the first successful post**
(`store.tsx → submitPost → pushAfterFirstPost()`). Any earlier call (the feed's existing mount call)
is a silent token refresh when permission already exists, and otherwise returns `too_early` — no
dialog. Android channel created before the token is fetched; taps route by `target` exactly as
SCR-042 does; a tap that cold-started the app is followed once.

### Native SDKs — what did and did not install here

Both installed cleanly and are **compiled and typechecked**, but **neither has been exercised
against a real store or a real device** in this environment (no credentials, no simulator):

- **`react-native-purchases@10.9.0`** — installed. `adapters/revenuecat.ts` is a full implementation:
  `configure` from `EXPO_PUBLIC_RC_IOS_KEY`/`EXPO_PUBLIC_RC_ANDROID_KEY`, `logIn` with the account id
  on every `/v1/me` refresh, `logOut` on sign-out, `getOfferings` → the paywall's price strings and
  intro-offer trial, `purchasePackage`, and `restorePurchases`. A user cancelling the sheet becomes
  `PurchaseCancelledError` and the paywall closes quietly. **Verified structurally only.**
- **`expo-notifications@57.0.17`** — installed, added to `app.json` plugins.
  `src/notifications-module.ts` is the native slice; there are no APNs/FCM credentials here, so the
  transport is unproven.
- **Web stays clean:** `revenuecat.web.ts` and `notifications-module.web.ts` sit beside the native
  files, so Metro's platform resolution keeps both native SDKs **out of the web bundle** — verified
  by grepping the export (`react-native-purchases` and `expo-notifications` appear zero times).
  Web still uses `DevBilling`, so E2E is unaffected.

### Files I touched outside my ownership (minimal, please keep)

1. `apps/api/src/app.ts` — one import + `setPushClient(deps.prisma)`. `services/notify.ts` needs a
   *non-transactional* client to push for a notification; plumbing one through every `notify()` call
   site would have touched five other agents' files.
2. `apps/api/src/services/notify.ts` — after the row is created, a fire-and-forget
   `pushForNotification(...)`, guarded by `pushEnabled()` so it is a pure no-op today. Deliberately
   **not** awaited: `notify()` runs inside the caller's transaction and a network round trip must not
   hold one open. Worst case is one push for a rolled-back notification, never a lost one.
3. `apps/api/src/services/wallet.ts` — `dailyMaxFor`/`adFreeFor` now delegate to `entitlementsFor`
   and take an optional `now` (defaulting to the real clock, so no call site had to change).
4. `apps/api/src/routes/{wallet,me}.ts` — 3 lines: pass `deps.clock.now()` to `adFreeFor`, so a
   lapsing subscription lapses under `/__test/time-travel` too.
5. `apps/mobile/src/state/store.tsx` — `pushAfterFirstPost()` after a successful post,
   `getBilling().identify(...)` on `/v1/me` and on sign-out, and `cancelled` on the `purchase` result.
6. `apps/mobile/app/settings.tsx` — subscription rows only: `t("freePlan")` instead of the literal
   `"Free"` (the key exists now), the period end when there is one, and a restore notice that always
   reports the current state.
7. `apps/mobile/src/env.ts` — `RC_IOS_KEY`, `RC_ANDROID_KEY`, `EXPO_PROJECT_ID`, `APP_ORIGIN`.
8. `apps/mobile/src/components/MomentCard.tsx` — 2 lines: `shareUrlFor` uses `APP_ORIGIN` on native
   instead of returning a bare `/moment/<slug>` path that nobody could open.
9. `apps/mobile/app.json` — `expo-notifications` added to `plugins`.
10. `.env.example` — the RevenueCat and push blocks, plus **`PUBLIC_APP_URL`** (referral links were
    falling back to the placeholder host `https://rpgllm.example`) and `EXPO_PUBLIC_APP_URL`.

### Deviations / things worth knowing

1. **No i18n key for a free trial.** The trial badge renders `` `${days} · ${t("freePlan")}` `` —
   "7 · Free" / "7 · 無料プラン" — because inventing English copy would break CLAUDE.md rule 4.
   Please add `freeTrial`/`trialDays` to `packages/shared/src/i18n/*` and the paywall is a one-line
   change.
2. **The webhook is rate-limited as a "default" route** (120/min per IP, `middleware/rate-limit.ts`
   is Agent F's file). RevenueCat retries on a 429 and every event is idempotent, so this is safe,
   but the webhook path deserves an `exempt` entry in `budgetFor()` next time that file is open.
3. **`RestoreReqZ.rcAppUserId` is accepted and ignored.** Reconciling against a client-supplied app
   user id would be a way to claim someone else's subscription; the response carries
   `matchedRequestedUser:false` when the id the client sent is not one the server knows. A vitest
   case ("never reconciles against an app-user id the caller made up") pins this.
4. **Restore's response shape is additive** (`source`, `configured`, `note`, `matchedRequestedUser`,
   `entitlements`). `packages/shared` has no schema for it and the client parses it loosely.
5. **Store product ids** are matched exactly against `PLANS` keys first, then `RC_PRODUCT_MAP`, then
   a keyword heuristic (`…plus.yearly` → `plus_yearly`). `docs/billing.md` tells the operator to
   name the products after the `PLANS` keys and never rely on the heuristic.
6. **Energy on a purchase is `max(current, dailyMax)`** — a renewal never *lowers* a tank. A refund
   is the one clawback (`min(current, FREE_DAILY)`), so a refunded purchase cannot be farmed.
7. **Receipts are read immediately after the send.** Expo fills them in asynchronously, so this
   catches only the fast ones; a scheduled second pass over recent ticket ids is the obvious
   follow-up once `jobs/**` has a scheduler owner.

### Verification

- `pnpm --filter api typecheck`, `pnpm --filter mobile typecheck`, `pnpm --filter e2e typecheck` — clean.
- `pnpm --filter api test` — **257 passed / 26 files** on a private database, including my
  **45 new cases** (`billing.test.ts` 30, `push.test.ts` 15). Nothing pre-existing was changed.
- `expo export -p web` — succeeds (run as `--output-dir dist-p` so a concurrent agent's `dist` was
  not clobbered); the bundle contains neither native SDK.
- Playwright, whole suite on my private stack — **47 passed, 4 skipped, 0 failed**: every
  pre-existing case plus my 4 new `billing.spec.ts` cases (BILL-001 the paywall renders the offering
  and closes quietly, BILL-002 purchase → Plus → ads gone → settings names the plan, BILL-003
  restore reports free *and* subscribed, BILL-004 the webhook grants, replays as a no-op, and a
  refund revokes immediately).
- Ran on a private stack (`rpgllm_p` for vitest via `TEST_DATABASE_URL`, `rpgllm_p_e2e` + API :4300
  + `dist-p` on :8302 for Playwright) because :4000/:8082/`rpgllm_test` were contended.
  **Two traps worth recording.** (1) Starting that private API with `pnpm --filter api dev` runs
  `tsx watch`: another agent saving a file restarted it mid-suite and 30 cases failed with
  `ECONNREFUSED`. Use `pnpm --filter api start` (no watch), and `setsid` it so a stray `pkill` in
  someone else's shell does not take it down. (2) A run whose **web export and API process were
  taken from different minutes** fails in other agents' areas for no reason of its own (I saw 9
  such failures — auth 500s and 401s from `feed`/`compliance`/`discovery`/`engagement`); re-export
  and restart the API together, and they all pass.

### What a human must configure before the app can take money

`docs/billing.md` §1–§6 in full, in short: create the four products in App Store Connect and Play
Console **named after the `PLANS` keys**; upload the App Store In-App Purchase key and the Play
service account to RevenueCat; wire App Store Server Notifications V2 and Play RTDN to RevenueCat;
create the `plus` and `adfree` entitlements and one current offering; set
`REVENUECAT_WEBHOOK_SECRET` (API) and the matching Authorization header value in the RevenueCat
webhook pointing at `https://<host>/v1/billing/webhook`; set `REVENUECAT_SECRET_KEY` (API) and the
two public keys (`EXPO_PUBLIC_RC_*`) in the client build; `BILLING_MODE=revenuecat`. Then run the
13-row sandbox test plan. For push: `docs/push.md` — an Expo project id, an APNs key, an FCM V1
service account, then `PUSH_ENABLED=1`.

---

## Agent N — the cost engine: Batch tier (§5.4), Thompson sampling (§6.3), offline eval gate (§6.2) — 2026-09-04

Closes the three parts of `cost-architecture.md` that were never implemented — gap analysis
"残課題 #1: Batch ティアが未対応 … **唯一の設計未達**" plus the §6.1/§6.2/§6.3 optimisation loop
that sat on top of it.

### What shipped

| file | role |
|---|---|
| `packages/llm/src/modes/batch.ts` | Message Batches API: pure `buildBatchBody` + the one networked `runLiveBatch` (new) |
| `packages/llm/src/gateway.ts` | `batch()` + `batchG1/G2/G4/G5/G7/G10/GJ`, `g2/g10/gj`, the `allocate` hook |
| `packages/llm/src/generators/{g2,g10,gj}.ts` | G2 ambient, G10 offline director, GJ judge — schemas, prompts, fallbacks (new) |
| `packages/llm/src/batch-jobs.ts` | `runAmbientRefillBatched` / `runMemoryConsolidationBatched` / `runOfflineDirectorBatched` / `runJudgeBatched` for the scheduler (new) |
| `packages/llm/src/bandit.ts` | reward, Beta posteriors, seeded sampler, allocation, guardrails, promotion — all pure (new) |
| `packages/llm/src/eval.ts`, `eval-cases.ts` | machine checks, judge scoring, `runEval`, `evaluateGate`, the frozen 50-case set (new) |
| `packages/llm/src/cost.ts` | `priceOf(model, usage, {batch})` + the `batch:` stop-reason marker |
| `packages/llm/src/experiments.ts` | registry entries for **G2 (light), G10 (mid), GJ (high/Opus 5)** |
| `apps/api/src/services/bandit.ts` | SQL fold of `GenerationLog`+`Rating` into `BanditArm`, guardrails, promotion, `/v1/bandit` payload (new) |
| `apps/api/src/services/evals.ts` | frozen set in Postgres, `EvalRun`/`EvalResult`, the comparison table (new) |
| `apps/api/src/routes/{bandit,evals}.ts` | the two admin-gated routers (new) |
| `apps/api/src/services/cost.ts` | **additive**: `batch` split on the report (`batchSplit`), `batch:`-aware fallback filter |
| `apps/api/src/fake-gateway.ts` | **additive**: `g2/g10/gj` + the batch methods, so the injected fake honours the same contract |
| `apps/api/src/app.ts` | two lines: `v1.route("/bandit", …)`, `v1.route("/evals", …)` |
| `scripts/eval.mjs` | the §6.2 CLI (new) · `scripts/cost-report.mjs` gained a BATCH TIER panel |
| tests | `packages/llm/src/{batch,bandit,eval}.test.ts` (55 new), `apps/api/test/{bandit,evals}.test.ts` (28 new) |

### 1. The Batch tier (§5.4)

`gateway.batch(items)` takes `{customId, generator, input, opts}[]` and returns a `Map` keyed by
`customId`; `batchG1…batchGJ` are the typed per-generator entry points. Every entry always
resolves — a per-entry failure yields that generator's deterministic fallback with
`meta.fallback = true`, so a job never has to reconcile a missing id.

- **live**: `messages.batches.create` → poll `retrieve` until `processing_status === "ended"` →
  stream `results()`, dispatching on `succeeded | errored | canceled | expired` per entry. Results
  are matched **through an id map keyed by `custom_id`, never by position** (the API returns them in
  any order); entries the API never reports come back as `expired` rather than vanishing.
  `custom_id` is sanitised to `[A-Za-z0-9_-]{1,64}` and de-duplicated, and the caller's original id
  is what the result map uses. Batches carry **no `fallbacks`/`betas`** — the server-side refusal
  fallback parameter is rejected on the Batches API — which is asserted in `batch.test.ts`.
- **replay**: resolves immediately through the existing deterministic fixtures (no sleep: a batch
  has no interactive latency budget), `ttftMs = null`.
- **fail**: every entry returns the generator fallback, `status: "errored"`.
- **cap + chunking**: `BATCH_MAX_REQUESTS = 500` per API batch (`LLM_BATCH_MAX_REQUESTS` overrides);
  more than that is chunked. Polling is `LLM_BATCH_POLL_MS` (default 60s) with a
  `LLM_BATCH_TIMEOUT_MS` deadline (default 24h, the API's own maximum).

**The batch marker in `GenerationLog`.** There is no `batched` column and `packages/shared` is
frozen, so a batched call is marked by **prefixing its stop reason**: `replay` → `batch:replay`,
`end_turn` → `batch:end_turn`, `error` → `batch:error`. `variantId` was rejected for this because
both the cost dashboard and the bandit join arms on `variantId` — a decorated id would split every
arm in two. Consequences, all implemented:
- `services/cost.ts` compares failure kinds through `regexp_replace("stopReason",'^batch:','')`, so
  `totals.fallbacks` is unchanged, and selects the batched half with `"stopReason" LIKE 'batch:%'`;
- `packages/llm` exports `batchStopReason` / `isBatchStopReason` / `baseStopReason`;
- pricing: `priceOf(model, usage, { batch: true })` multiplies **every** token — input, output,
  cache reads *and* cache writes — by `BATCH_DISCOUNT`.

**For Agent O (scheduler).** `BATCHABLE_GENERATORS = ["G2","G7","G10","GJ"]` now all exist as real
generators, and `packages/llm` exports one entry point per job:

```ts
import { runAmbientRefillBatched } from "@rpgllm/llm";
const results = await runAmbientRefillBatched(gateway, worlds.flatMap((w) => LOCALES.map((l) => ({
  customId: `${w.id}:${l}`, input: g2Input(w, l, n),
}))));
for (const [id, r] of results) if (!r.meta.fallback) writeAmbientPosts(id, r.output.posts);
```

Same shape for `runMemoryConsolidationBatched` (G7), `runOfflineDirectorBatched` (G10) and
`runJudgeBatched` (GJ). `apps/api/src/jobs/**` is yours, so I did not rewire `ambient-refill.ts`
(today one G1 call per world+locale) or `offline-director.ts` (G5+G1+G4) — switching them to
`gateway.batchG2` / `gateway.batchG10` is a small, self-contained change that halves their cost and
drops their synthetic prompts. `memory-consolidate.ts` is the easiest win: collect the personas
first, then one `runMemoryConsolidationBatched` call instead of N `gateway.g7` calls.

### 2. Thompson sampling (§6.3)

Split on purpose: `packages/llm/src/bandit.ts` is **pure** (no clock, no DB, seeded RNG only) and
owns every rule; `apps/api/src/services/bandit.ts` owns the SQL and the persistence. That is what
lets the allocator run inside the gateway, which must not know about Prisma.

**Reward.** `reward = quality − BANDIT_LAMBDA × (cost / championCost)`, clamped to `[0,1]`.
`quality` comes from the signals that exist: 👍 = 1, 👎 = 0, regeneration = 0, fallback = 0, and an
**unrated call = 0.6** (`UNRATED_QUALITY_PRIOR`) so silence does not read as failure. The champion
at parity therefore scores `1 − λ`: the formula measures value for money, which is the point — a
40% cheaper arm at equal quality wins. Posteriors are Beta: `alpha += r`, `beta += 1 − r`.

**The fold** (`updateFromLogs(prisma, now)`) is one `GROUP BY` per window, joined to `Rating` by a
lateral. Rewards are folded per quality class (good / bad / unrated counts × the arm's mean cost),
which reproduces the per-call reward exactly because the cost ratio is constant inside a window.
Two kinds of row are invisible to it: **escalations** (`escalatedFrom IS NOT NULL` — Agent I's note,
they run one tier up under the user's arm) and **batched calls** (`stopReason LIKE 'batch:%'` —
offline work with no user and no rating; otherwise a nightly eval run would move production
traffic).

**The watermark.** `updateFromLogs` is incremental and must be idempotent, but the schema is frozen
and has no cursor column. The watermark is therefore a **singleton `PromotionEvent` row per
generator with `reason = "watermark"`**, `toVariant = "-"`, `metrics = {at, folded}`, updated in
place. Any reader of the audit trail must filter `reason <> 'watermark'`. Re-running the fold with
the same window changes nothing (asserted).

**Allocation.** `allocate({generator, arms, userId, day})` draws one Beta sample per enabled arm and
takes the argmax, from a `mulberry32` seeded with `FNV1a("bandit|generator|userId|day")` — so it is
**user-sticky for a whole UTC day** and deterministic in tests. Each non-winning arm keeps
`BANDIT_FLOOR` of the traffic so exploration never stops. It returns `null` when there are no arms
or no arm has ever been called, and the gateway then falls back to `experiments.ts`'s deterministic
50/50 assignment — `assignments()` and `champion()` are untouched and still serve the client.

**Guardrails.** `checkGuardrails` measures the last 24h per arm and disables any arm breaching
`BANDIT_GUARDRAILS` (regenerate rate 8%, safety-flag rate 0.2%, fallback rate 5%), writing a
`PromotionEvent{reason:"guardrail:<metric>"}`. An arm under 50 calls is never disabled, and the
champion is never disabled (there would be nothing to fall back to). A disabled arm is skipped by
`allocate`, so traffic reverts to the champion on the next snapshot refresh.

**Promotion.** `maybePromote` requires **all** of: the challenger leads on posterior mean;
`calls >= BANDIT_PROMOTION.MIN_CALLS` (500); `p(best) >= 0.95` from a 400-draw Monte Carlo; **and**
the variant is in the §6.2 offline-gate pass set. It writes `PromotionEvent{reason:
"auto:thompson+gate"}` with `{pBest, calls}`. `POST /v1/bandit/promote` is the manual override and
is audited the same way (`reason: "manual:…"`); promoting an arm also clears a guardrail disable.

**Endpoints** (admin gate reused verbatim from `/v1/cost` — `costAccessAllowed`, so `TEST_HOOKS=1`
or a matching `x-admin-token`, everything else an indistinguishable 404):
`GET /v1/bandit` → `BanditStateResZ` · `POST /v1/bandit/promote` → `PromoteResZ`.

**⚠️ One line I did not write (whoever owns `apps/api/src/index.ts`).** The allocator is ready but
not wired into the production gateway, because that file is not mine:

```ts
import { banditAllocate, refreshAllocatorSnapshot } from "./services/bandit";
const { gateway } = await loadGateway({ allocate: (g, userId) => banditAllocate(g, userId) });
await refreshAllocatorSnapshot(prisma);            // and again from the hourly bandit-update job
```

Until that lands the bandit is **observed but not acting**: arms, posteriors, guardrails and
promotions all update, and allocation still comes from the deterministic 50/50 split. Nothing
breaks either way — `banditAllocate` returns `null` with no snapshot.
Agent O: `refreshBandit(prisma, now)` is the whole hourly `bandit-update` job in one call (fold →
guardrails → promote); `refreshAllocatorSnapshot(prisma)` belongs at the end of it.

### 3. The offline evaluation gate (§6.2)

**The frozen set** is `EVAL_SET_SIZE = 50` `EvalCase` rows per generator: **15 hand-written hard
cases** (leak drama EN/JA, break-up EN/JA, Japanese honorifics, casual JA register, abusive input
EN/JA, borderline self-harm EN/JA, an empty post, an emoji wall, a 900-character wall of text, a
news-requested case, a reply-to-parent case) plus real cases plus deterministic filler, trimmed
back to 50 (filler is dropped first) so scores stay comparable between runs.

> **Deviation from §6.2, recorded here.** §6.2 says "150 sampled from production logs".
> `GenerationLog` stores a `promptHash`, never the input, so a logged call cannot be replayed.
> Production cases are instead **reconstructed from the rows the action was made of** — the `Post`,
> its persona, world, cast and relationships — through the same builders the live G1 path uses. On
> an empty database the set is filled entirely from the frozen list, so an eval is always runnable.

**Scoring** is `100 × (0.4 × machine + 0.6 × judge)`.
- machine checks: schema validity, K satisfied, handle validity (cast only, never the press
  account), banned words, lengths (280/240/200), emoji ≤ 2 per reply, diversity (distinct handles,
  distinct texts, distinct openings), news respected. `schemaValid`, `notFallback` and
  `noBannedWords` are **absolute** — failing one scores the machine half 0 and fails the case.
- judge: **GJ, Opus 5, batched**, six axes (in-character 0.25, diversity 0.15, humour 0.15, emoji
  0.10, safety 0.25, JP naturalness 0.10). Its cached prefix is the rubric plus a per-generator
  criteria block, not a world bible.
- a case passes at ≥ 70 with no absolute check broken and no judge `fail` verdict.

**The gate** is §6.2 verbatim (`evaluateGate`): within `EVAL_GATE.MAX_SCORE_DROP` (2 pts) **and** at
least `MIN_COST_SAVING` (20%) cheaper, **or** `MIN_SCORE_GAIN` (3 pts) better outright. The champion
row is the baseline (`passesGate: true`, deltas 0).

**Endpoints**: `GET /v1/evals?generator=` → `EvalRunsResZ` · `POST /v1/evals/run` (`StartEvalReqZ`,
`limit` capped at 500) · `GET /v1/evals/compare?generator=` → `EvalCompareResZ` ·
`POST /v1/evals/seed`. All admin-gated: a run spends money.

**How to run one**

```bash
bash scripts/db.sh start
# through the API (admin-gated):
curl -XPOST localhost:4000/v1/evals/run -H 'content-type: application/json' \
  -d '{"generator":"G1","variantId":"g1-haiku-v1","limit":50}'
# or from the CLI, which runs every registered variant and prints the comparison table:
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/rpgllm node scripts/eval.mjs --generator G1
node scripts/eval.mjs --generator G1 --variant g1-haiku-v1 --limit 20 --json
node scripts/eval.mjs --generator G1 --no-run        # compare stored runs, spend nothing
```

Every eval call is written to `GenerationLog` (CLAUDE.md rule 5) with the `batch:` marker, so an
eval run shows up in the §5.4 split of the cost dashboard rather than being invisible spend.

### 4. Making the saving visible

`costReport()` gained one additive block, `batch` (every existing field and every existing test is
untouched): `batched` / `interactive` `CostRow`s, the call and cost shares, `listPriceUsd` (the
batched tokens **re-priced at interactive list price from `PRICING`**), `savedUsd`,
`realisedDiscount` and `expectedDiscount`, plus a per-generator table. `realisedDiscount` is a
*measurement*, not an assertion: if a batched call were ever billed at full price it would move off
50%. `scripts/cost-report.mjs` prints it as a `BATCH TIER (§5.4)` panel.

### Registry additions

`GENERATOR_EXPERIMENTS` gained `g2` (`g2-haiku-v1`, light), `g10` (`g10-sonnet-v1`, mid) and `gj`
(`gj-opus-v1`, **high — §6.2 insists the judge is the strong model**; before this it fell through to
the mid-tier pseudo-variant and would have judged on Sonnet). `assignments()` therefore returns ten
keys instead of seven and `champion()` eight instead of five; the two `gateway.test.ts` assertions
that pinned those exact sets were updated, not weakened (E2E only asserts the payload is non-empty,
and `apps/api` reads by key).

### What still needs a real API key

Everything runs end to end in `LLM_MODE=replay`; live mode is verified **structurally**, the way
Agent B did it for the messages path — `buildBatchBody` is pure and asserted on, and `runLiveBatch`
is driven by a stub client (out-of-order results, a partial failure, polling to `ended`, chunking,
a batch that never ends). Not exercised without a key: a real `messages.batches` round trip
(submission limits, the 24h SLA, real `custom_id` echoes), whether the 50% discount lands exactly as
`PRICING × BATCH_DISCOUNT` on a real invoice, and the **real Opus 5 judge** — in replay the judge is
a deterministic heuristic (emoji budget, opening diversity, banned phrases, script mix, with the two
axes no heuristic can measure seeded off the candidate). That is why the replay eval table shows
both G1 variants at the same score: replay outputs do not depend on the model, so the comparison is
honest about cost and blind about quality until a key exists.

### Verification

- `pnpm --filter @rpgllm/llm typecheck` / `pnpm --filter api typecheck` — clean.
- `pnpm --filter @rpgllm/llm test` — **135 passed** (80 before; 55 new).
- `pnpm --filter api test` — **26 files, 257 passed** (229 before; 28 new). Run it with
  `TEST_DB_SUFFIX=<you>`; the private-database work in `vitest.config.ts` makes concurrent runs safe.
- `node scripts/eval.mjs --generator G1` in replay, 50 frozen cases (16 rebuilt from real posts):

```
variant       status    cases  passed  mean score      gen $    judge $    total $
g1-sonnet-v1  finished     50      50       86.00  $0.136278  $0.067469  $0.203746
g1-haiku-v1   finished     50      50       86.00  $0.046172  $0.064829  $0.111002

variant              runs  cases  pass rate  mean score       $/case  Δscore   Δcost  gate
g1-haiku-v1             1     50     100.0%       86.00  $0.00222004   +0.00  -45.5%  PASS
g1-sonnet-v1  champ     1     50     100.0%       86.00  $0.00407492   +0.00   +0.0%  baseline
```

- `node scripts/cost-report.mjs --days 7` after 15 real posts + one eval run:

```
BATCH TIER (§5.4) — batched vs interactive
lane         calls       cost  share of calls  share of cost
batched        200  $0.314740           85.8%          92.3%
interactive     33  $0.026268           14.2%           7.7%

batched tokens at list price               $0.629496
actually billed (batch tier)               $0.314740
saved by batching                          $0.314756
realised discount             50.0% (expected 50.0%)
```

- Full loop on real data: fold → `g1-haiku-v1` leads (mean reward 0.62 vs 0.29, p(best) 0.95) →
  `promotable: false` until the eval gate passes → after `scripts/eval.mjs`, `maybePromote` writes
  `PromotionEvent{auto:thompson+gate}` and the champion moves.

### Open issues / follow-ups

1. **The allocator is not wired** into the production gateway (one line in `index.ts`, above).
2. **Jobs still call the interactive path.** `ambient-refill.ts`, `memory-consolidate.ts` and
   `offline-director.ts` are Agent O's; the batched entry points are ready and typed for them, and
   G2/G10 now exist so the synthetic-G1 workarounds can go.
3. `refreshBandit` / `refreshAllocatorSnapshot` need the hourly `bandit-update` cron
   (`JOBS` already lists it).
4. The eval judge is a heuristic in replay; the *scores* only become meaningful with a key. The
   *costs* are real in both modes.
5. `EvalCase` has no natural key column, so the frozen set is identified by `(generator, label)`.
   Labels are unique by construction; a second generator's set must keep that property.
6. `runEval` implements the machine checks for **G1** only. G4/G5/G7 run through the same batch and
   judge path, but would score on the generic checks alone until their checkers are written.
7. The watermark living in `PromotionEvent` is a schema-frozen compromise. If the schema ever opens
   up, a two-column `BanditWatermark` (or `BanditArm.foldedThrough`) is the honest home for it.

---

## Agent O — runtime & ops: the scheduler, persisted login codes, the streak's columns, test isolation — 2026-09-04

Four things that stood between this build and something you could actually deploy: nothing ran the
background work, login codes lived in one process's memory, the streak was only as durable as a
ledger row, and the two test harnesses shared one database. Plus the ops debt behind them.

### 1. The scheduler — `pnpm --filter api worker`

`apps/api/src/worker.ts` is a second long-lived process that runs the `JOBS` table from
`@rpgllm/shared` on its cron schedules. Until now those functions had no caller but a read-path
fallback and the E2E hook (build-notes "Agent H": *"There is no scheduler in this build"*).

```bash
pnpm --filter api worker                        # the schedule, forever
pnpm --filter api worker --once                 # every job once, then exit (0 = all clean)
pnpm --filter api worker --once=ambient-refill  # one job
pnpm --filter api worker --jobs=offline-director,purge-login-codes
JOBS_DISABLED=bandit-update pnpm --filter api worker
```

| job | cron (UTC) | runs | tier |
|---|---|---|---|
| `offline-director` | `0 * * * *` | `runOfflineDirectorBatchedJob` (G10) | batch |
| `memory-consolidate` | `*/30 * * * *` | `runMemoryConsolidationBatchedJob` (G7) | batch |
| `ambient-refill` | `0 3 * * *` | `runAmbientRefillBatchedJob` (G2) | batch |
| `purge-deleted` | `30 3 * * *` | `purgeDeletedAccounts` | — |
| `purge-login-codes` | `*/15 * * * *` | login codes + `JobRun` retention + the Expo receipt pass | — |
| `bandit-update` | `15 * * * *` | `refreshBandit` + `refreshAllocatorSnapshot` | — |

- **Cron** is `jobs/cron.ts`: a 5-field UTC evaluator (`*`, `a`, `a-b`, lists, `/n` steps, dow 0-7,
  the Vixie dom/dow-or rule) plus `nextCronRun`. No dependency — the whole thing is smaller than the
  argument for picking a library's cron dialect, and it is unit-tested against the real `JOBS` rows.
- **The lock.** Every run takes a Postgres **advisory lock keyed on the job name**
  (`pg_try_advisory_xact_lock(20260904, fnv1a(job))`, `jobs/runs.ts`): a second worker, an
  overlapping redeploy, or an admin's manual trigger **skips** instead of double-running. It is a
  *transaction-scoped* lock held by an interactive transaction that does nothing else — Prisma pools
  connections, so a session-scoped lock could be released on a connection nobody sees again. The job
  itself runs on other connections; the transaction's `timeout` (`JOB_TIMEOUT_MS`, 10 min) bounds how
  long a wedged job can hold the lock.
- **Failure isolation.** `runJobOnce` never throws: a failing job is recorded with its error and the
  loop carries on. `SIGTERM` stops the loop, drains the in-flight job (`WORKER_SHUTDOWN_GRACE_MS`,
  30s), disconnects Prisma and exits 0.
- **Visibility.** `GET /v1/jobs` → `JobsResZ` (schedule, enabled, last run, next run; `?job=` adds
  the last 20 runs) and `POST /v1/jobs/run` → `RunJobReqZ`, both behind the **same admin gate as
  `/v1/cost`** (`costAccessAllowed`: `TEST_HOOKS=1` or a matching `x-admin-token`, otherwise an
  indistinguishable 404). Manual runs take the same lock as the schedule.
- `POST /v1/__test/run-job` (Agent H's hook, and the E2E suite's) is **untouched** and still runs the
  interactive compositions; `jobs/index.ts` only gained a comment pointing at the worker.

**The `JobRun` table is schema debt, deliberately taken.** The run log has to be readable from a
different process than the one that wrote it, and `prisma/schema.prisma` is not mine this pass, so
`jobs/runs.ts` creates it with `CREATE TABLE IF NOT EXISTS` and reads it with parameterised raw SQL
(`DISTINCT ON (job)` for the last run — aggregation in SQL, not in Node). `jobs/push-receipts.ts`
does the same for `PushTicket`. **Orchestrator: the two Prisma models to paste are in
`docs/deploy.md` §6**; after that, delete `ensureJobRunTable` / `ensurePushTicketTable` and use
`prisma.jobRun` / `prisma.pushTicket`. `prisma migrate dev` will otherwise want to drop both.

### 2. Login codes are in Postgres now

`services/login-codes.ts` replaces the in-process `Map` on `AppState.emailCodes` (which is gone,
along with its `types.ts` field and its line in `app.ts`). Same guarantees, now instance-independent:
salted sha256 only, 10-minute TTL, ≤5 attempts, single use through a conditional `consumedAt` update
(two racing verifies cannot both win), constant-time compare, and **one active code per address** —
issuing a new one consumes every older pending row, so an attacker cannot keep an old code alive by
asking for a new one. Every time read comes from the injected clock, so `/__test/time-travel` expires
codes exactly like wall-clock time.

`auth-codes.ts` keeps the crypto, the `MailSender` and — deliberately — the in-memory implementation,
because `test/security.test.ts` (Agent F's) unit-tests the lifecycle rules through it without a
database. Nothing in the request path calls it. `purge-login-codes` sweeps expired and consumed rows
every 15 minutes; **without the worker deployed that table grows forever** (`POST /v1/jobs/run` is the
manual equivalent).

This is what makes the API safe behind more than one instance. The two things still in process
memory are the rate-limit buckets (Agent F's TODO) and the push daily-cap counters (Agent P's) —
both become N× too permissive at N instances. Neither is mine, and both want the same fix: a small
counter table or Redis, keyed by user and local day.

### 3. The streak lives on its columns

`services/streak.ts` now reads and writes `User.streakDays` / `streakBestDays` / `streakLastAt`
(the orchestrator's follow-up note). The ledger is still written on every payout — it stays the
payment record, same `ref = "streak:<date>:<day>:<best>"` shape — but nothing derives state from it
any more, so pruning `LedgerEntry` can no longer silently reset everyone's streak.

Behaviour is preserved exactly: idempotent per UTC day, advance on consecutive days, reset after a
gap, `streakBestDays` tracking, and **the energy cap at the wallet's daily maximum** (Agent L's
deliberate rule — without it the day-1 bonus breaks four vitest files and E2E-003/007/008/015).
Two-tab races are settled by a conditional update on `streakLastAt`, so exactly one caller pays.

**Migration is opportunistic and needs no backfill**: an account with `streakLastAt = null` and a
`streak:` ledger row has its columns written from that row on the first read (`migrateLegacyStreak`),
keeping days *and* best. An account that never checked in is untouched. Covered by
`streak.test.ts` — a legacy day-3 streak from yesterday becomes day 4 today, and a lapsed one resets
to day 1 while keeping its best.

### 4. Test isolation — both harnesses own their database

The recipe is `docs/testing.md`. Short version:

- **vitest**: `vitest.config.ts` asks `test-database.ts` for this run's database
  (`rpgllm_test_v<pid>`, or `TEST_DB_SUFFIX`), `vitest.global-setup.ts` creates and migrates it and
  drops it afterwards. `TEST_DATABASE_URL=…` still works and now means "use mine, don't drop it";
  `TEST_DB_KEEP=1` keeps a private one for a post-mortem.
- **Playwright**: `rpgllm_test_e2e_p<pid>` (or `E2E_DB_SUFFIX`), created + migrated + seeded **inside
  the API webServer command** (`e2e/scripts/api.mjs` → `e2e/scripts/db.mjs`), i.e. *before the API
  process starts*, and dropped in the new `global-teardown.ts`. `global-setup.ts` runs the same
  preparation idempotently (marker file + lock file) for the case where the webServer was reused.
  This is the fix for the failure that cost several agents hours: Playwright starts webServers before
  `globalSetup`, so the old drop-and-recreate landed *after* the API had connected and
  `POST /__test/reset` answered 500.
- Two more harness fixes: the webServers now spawn **node directly** instead of through
  `pnpm → sh → tsx`, which swallowed Playwright's SIGTERM and left an orphaned API holding the port
  for the next run; and a server is only reused when you pass `E2E_SKIP_DB=1` (reusing a foreign API
  now means testing against a different database). `E2E_WEB_DIST=dist-me` gives a run its own web
  export — the bundle bakes `EXPO_PUBLIC_API_URL` in, so private ports need a private bundle — and
  `API_PORT`/`WEB_PORT` alone are enough now: the config writes `API_URL`/`WEB_URL` back into the
  environment for `fixtures.ts`.
- `e2e/tests/**` and `e2e/fixtures.ts` were **not touched**. Nothing in either harness uses
  `scripts/db.sh reset` or the shared `rpgllm_test` any more.

### 5. Wiring Agent N and Agent P (asked for by the orchestrator)

- **Thompson sampling is on.** `index.ts` passes `loadGateway({ allocate: banditAllocate })` and
  warms the arm snapshot at boot (failing softly: a cold or unreachable database logs a warning and
  the gateway falls back to `experiments.ts`'s deterministic split). `bandit-update` is now
  `refreshBandit(prisma, now)` + `refreshAllocatorSnapshot` — the lazy-import no-op guard is gone.
- **The Batch tier is scheduled.** The three generative jobs got batched variants beside their
  interactive ones — `runAmbientRefillBatchedJob` (G2, one batch for every pool that is short, pool
  sizes counted in one `GROUP BY`), `runMemoryConsolidationBatchedJob` (G7, one batch for every
  persona with notes to fold) and `runOfflineDirectorBatchedJob` (G10, one batch for every away
  player; G10 answers posts + DM + digest together, so one batched call replaces G5+G1+G4). The
  registry runs the batched ones; `JOBS_BATCH=0` reverts.
  **The interactive compositions stay** and are still what `GET /v1/digest`,
  `GET /v1/memory/:characterId` and `POST /v1/__test/run-job` use — a batch has a 24-hour SLA in live
  mode, and `digest.test.ts` pins the G5/G1/G4 composition of the on-demand path.
- **Push receipts** (Agent P): `jobs/push-receipts.ts` re-reads settled ticket ids every 15 minutes
  and deletes every token Expo reports `DeviceNotRegistered`, forgetting tickets past Expo's 24-hour
  retention. It is folded into `purge-login-codes` because `JOBS` is read-only for me —
  **orchestrator: a dedicated row `{ name: "push-receipts", schedule: "*/15 * * * *" }` would read
  better, and I will move it the moment it exists.**
  **⚠ It needs one line in `services/push.ts` (Agent P's file), which nobody else can write:** the
  ticket ids only exist inside `sendPush`'s local map, so nothing populates `PushTicket` yet. At the
  end of `sendPush`, where `ticketToToken` is still in scope:
  ```ts
  import { recordPushTickets } from "../jobs/push-receipts";
  if (opts.prisma && ticketToToken.size > 0) {
    await recordPushTickets(opts.prisma, [...ticketToToken].map(([ticketId, token]) => ({ ticketId, token })), new Date());
  }
  ```
  Until then the sweep is a tested no-op over an empty table; afterwards it prunes dead devices with
  no further change.

### 6. Ops

- `docs/deploy.md` rewritten for **two processes**: the API and the worker, the same image with a
  different command. Both entrypoints are now `node --import tsx …` so the app is **PID 1** and
  actually receives `SIGTERM` (`pnpm run` swallowed it, and the graceful drain never ran). Env table,
  the production config guard, migrations as a release step, health checks, the release checklist and
  the schema-debt models are all there. `docs/testing.md` is new.
- `docker build` **still unverified**: no Docker daemon in this sandbox (`docker info` fails, no
  `/var/run/docker.sock`).
- **CI**: no more shared `rpgllm_test` — both jobs use per-run databases (`TEST_DB_SUFFIX` /
  `E2E_DB_SUFFIX` from `github.run_id`), the "migrate the test database" step is gone (the suite does
  it), and there is a new **worker smoke test**: create a database, migrate, `worker --once`
  (every job against real Postgres), drop.
- **Lint**: `apps/mobile` is linted for the first time (its own noise is warnings; the bug-shaped
  rules apply), and eight rules were **promoted from warning to error** now that the tree is clean of
  them: `no-unsafe-member-access` / `-call` / `-argument` / `-return`, `only-throw-error`,
  `prefer-promise-reject-errors`, `unbound-method`, `consistent-indexed-object-style`. A stub
  `react-hooks` plugin makes the client's existing disable directives resolvable without adding a
  dependency to the lockfile mid-flight — install `eslint-plugin-react-hooks` and delete that block
  to get the real checks.
  **One error remains and it is not mine to fix**: `e2e/tests/firstrun.spec.ts:63` has
  `await expect(await introSeen(page)).toBe("1")` — the outer `await` is on a non-Promise
  (`@typescript-eslint/await-thenable`). Deleting that one `await` changes no behaviour, but
  `e2e/tests/**` is off-limits for me, so `pnpm lint` reports 1 error until its owner takes it.

### Verification

- `pnpm --filter api typecheck` clean · `pnpm --filter e2e typecheck` clean.
- `pnpm --filter api test` — **262 passed / 26 files** (the 257 baseline after Agents N and P, plus
  my jobs/login-code/streak/receipt cases; nothing weakened).
- `pnpm e2e` — **47 passed / 4 skipped / 0 failed**, on private ports and a private database
  (`API_PORT=4400 WEB_PORT=8490 E2E_DB_SUFFIX=o E2E_WEB_DIST=dist-o pnpm e2e`), with the database
  created before the API started and dropped in the teardown, and no server left holding a port.
- `pnpm --filter api worker` starts, runs each of the six jobs on demand (`--once`), logs
  `job.start`/`job.done` per run, and exits 0 on `SIGTERM` after draining.
- Two concurrent runs no longer interfere: each `pnpm --filter api test` creates and drops
  `rpgllm_test_v<pid>`, and each `pnpm e2e` creates and drops `rpgllm_test_e2e_p<pid>`.

---

## Agent WS-API — World Studio server (AIF-003)

Player-created worlds, end to end on the server: `POST /v1/worlds` → the `world-build` job → a
playable world → publish → human review. `apps/api/**` only; `packages/shared`, `packages/llm`,
`apps/mobile` and `e2e` untouched.

### What was added

- **Routes** (`src/routes/worlds.ts`): `POST /v1/worlds`, `GET /v1/worlds/mine`,
  `GET /v1/worlds/public`, `GET /v1/worlds/:id/status`, `POST /v1/worlds/:id/publish`.
  `GET /v1/worlds` (the picker) now returns presets **plus the caller's own finished worlds and
  nothing else**; `GET /v1/worlds/:id` 404s a world the caller may not play.
  **Admin** (`src/routes/admin-worlds.ts`, mounted at `/v1/admin/worlds`, same gate as
  `GET /v1/moderation/reports`): `GET /review`, `POST /:id/review`. Publishing can only ever reach
  `review`; `published` is written in exactly one place, and it is not reachable by a player.
- **Job** (`src/jobs/world-build.ts`): sweep stuck builds, then claim → G9 → validate
  (`WorldSeedZ` **and** `MIN_BIBLE_TOKENS` per locale) → `seedWorld` → `ready`. Failure ⇒ `draft`
  + user-facing `failureReason` + refund in the same transaction + a notification.
- **Domain** (`src/services/world-studio.ts`): the daily cap, the gem debit/refund, slugs,
  visibility predicates, progress, and the list serialisers.

### Deviations and decisions

1. **`JOBS` in `packages/shared` is frozen, so `world-build` is declared in
   `src/jobs/registry.ts` as `LOCAL_JOBS`** and merged into `jobDefinitions`. It runs under the
   same advisory lock, `JobRun` log, `GET /v1/jobs` listing and `POST /v1/jobs/run` as every other
   job. **Request to the owner of `packages/shared`:** add
   `{ name: "world-build", schedule: "* * * * *", description: "generate player-created worlds (G9) and sweep stuck builds" }`
   to `JOBS`; then delete `LOCAL_JOBS` and nothing else changes.
   `apps/api/test/jobs.test.ts`'s "lists every job" case now asserts
   `JOBS ∪ LOCAL_JOBS` — still an exact-set assertion, over the true set.
2. **`packages/llm` had not shipped `g9`/`screenPremise` yet.** `src/services/g9.ts`
   feature-detects both (`g9Of(gateway)`, `premiseScreenFrom(mod)`) exactly as `llm-loader.ts`
   already does for `createGateway`. A deterministic stand-in `g9` lives in `fake-gateway.ts` +
   `fake-world-seed.ts` and emits a real `WorldSeed` whose bibles clear 4,096 tokens in **both**
   locales under the real estimator, so every case runs today. The local premise screen is ANDed
   with `screenPremise`, never replaced by it — the real one can tighten the verdict, never loosen it.
3. **No `GEMS_REQUIRED` error code exists** (`ErrorCodeZ` is frozen), so a short wallet answers
   `402 ENERGY_REQUIRED`, the shape the energy path already uses. The daily cap answers
   `429 RATE_LIMITED` with the Plus limit named in the message.
4. **Schema (mine):** `World` gains `genre`, `genLocale`, `seed` (Json), `buildStartedAt`,
   `refundedAt` — migration `20260905010500_world_studio_build`, applied to `rpgllm` and
   `rpgllm_test`. `seed` is what makes `getWorldSeed(slug, prisma)` fall back to the database, so
   fallback replies, welcome posts, intros, preset personas and ambient text work identically for a
   user world and a hand-authored one, with no branch at any call site. `refundedAt` is claimed with
   a conditional `UPDATE` in the refund transaction, which is what makes "refunded at most once"
   a database guarantee rather than a code path.
5. **Wallet creation moved into `services/wallet.ts`'s `createWallet`** (`routes/auth.ts` used to
   inline it) so the `WORLD_STUDIO.STARTER_GEMS` grant and its ledger entry cannot be skipped by
   whichever path happens to create the wallet first. `services/billing.ts`'s three wallet upserts
   use the same `newWalletData`.
6. **`ApplyResult` (billing) gains `gems: number \| null`.** Consumable `NON_RENEWING_PURCHASE`
   events with a `GEM_PACKS` product id now grant gems inside the same transaction as the
   `Purchase` row, so its unique `rcEventId` is the idempotency key for the gems too. The webhook
   route's response body is unchanged.
7. **`WORLD_BUILD_ON_CREATE`** (default on, off while `TEST_HOOKS=1`) makes the create route kick
   the builder in-process. It is an optimisation, never the contract — the scheduler runs
   `world-build` every minute regardless. `RATE_LIMIT_WORLD_PER_MIN` (default 3) gives
   `POST /v1/worlds` its own budget kind, an order of magnitude below the write budget.
8. **`createPersonaWithFeed` now checks `canPlay`**: knowing the id of somebody else's private
   world was otherwise enough to play it. `playCount` is incremented in the persona-creating
   transaction — once per persona, never per request.

### Verification

- `pnpm --filter api typecheck` clean · `pnpm exec eslint apps/api` 0 errors.
- `pnpm --filter api test` — **295 passed / 27 files** (266 baseline + 29 new; nothing weakened,
  nothing skipped).

## Agent WS-CLIENT — World Studio client (SCR-048 create, SCR-049 building→ready, SCR-050 my worlds)

Owned `apps/mobile/**` only. Nothing in `packages/shared`, `packages/llm`, `apps/api` or `e2e` was
touched; every colour, string and test id comes from the frozen shared package.

### What was added

| Route / module | What it is |
| --- | --- |
| `app/studio/index.tsx` | SCR-048. Premise field (live count against 8–200), 8-genre picker, language, three visibilities with their consequences, price against the wallet, builds left today, one CTA. |
| `app/studio/[id].tsx` | SCR-049. Polls `/v1/worlds/:id/status`, walks the four named steps, then reveals cover + title + scenario + the eight cast cards, with play / publish / keep-private. Also the two "no" endings: turned down for Explore, and a build that failed and was refunded. |
| `app/studio/worlds.tsx` | SCR-050. The shelf, re-read on focus (review finishes while you are elsewhere). |
| `src/components/StudioWorldCard.tsx` | Row card + the state pill, used by SCR-050 and Explore. |
| `src/components/StudioProgress.tsx` | The four build steps and the (monotonic) progress bar. |
| `src/components/StudioCast.tsx` | The staggered cast reveal. |
| `src/components/StudioPromoCard.tsx` | "Create your own", used at the end of the world picker and in Explore. |
| `src/studio/labels.ts` | Genre / visibility / status → i18n key + tint, in one place. |
| `src/studio/useWorldStatus.ts` | The polling hook: keeps the last good answer, backs off, gives up after four failures with a retry. |

Entry points: the last card in the world picker (`onboarding/scenario.tsx`, `T.studioOpen`), a
"made by players" section plus a promo card in `explore.tsx`, and a "My worlds" row on
`profile.tsx`. `WorldCover` is now exported from `components/WorldCard.tsx` so a player world paints
the same generated art everywhere (no world ever fetches an image).

### Deviations and requests

1. **`api.request` gained `globalErrors?: boolean`** (`src/api/client.ts`, default `true`). Every
   studio call passes `false`: a 402 from `POST /v1/worlds` means *gems*, not energy, and the
   global handler would have thrown the player into the energy modal. 401 still signs out.
2. **One test id per screen.** Expo Router keeps screens below the top of the stack mounted, so an
   id used on two screens matches twice at once and breaks a strict Playwright locator — measured:
   profile → my worlds returned 2 nodes for `studio-my-worlds` before the split. Final allocation:
   `studio-open` = the world-picker card only; `studio-my-worlds` = the list on SCR-050. The
   profile row and Explore's promo card therefore carry **no** test id (reachable by role + name);
   ids named e.g. `studioMyWorldsOpen` / `studioExploreOpen` would fix that if wanted.
3. **`T.studioTabButton` is unclaimed.** A sixth tab does not fit at 390pt — "Notifications" alone
   needs more than a sixth of the bar, and adding Studio truncated two labels (screenshotted, then
   reverted). A tab needs either a short notifications label or an icon-first bar; say the word and
   the client side is a two-line change.
4. **i18n gaps (worked around, please add):** there is no `studioPublished`, so a finished world
   wears its audience instead (`studioVisibilityPublic` → "Everyone", `…Private` → "Just me") —
   which also reads better in a list than "Your world is ready" as a pill. And there is a single
   `studioPremisePlaceholder`, so the hero field's rotation cycles that line **plus the existing
   worlds' `scenario` strings from `/v1/worlds`** (server-localised, and exactly the shape of a
   premise). Three or four `studioPremiseExample*` keys would make it a one-line change.
5. **Two API readings, stated so they can be corrected:** `status: "rejected"` with `castCount === 0`
   is treated as *the build failed and the gems came back*, and with a cast as *review said no, it
   is still yours to play*. "Keep it private" makes no request — a world created private already is.
6. **No pulsing CTA.** The first cut wrapped "Build my world" in `Pulse`; Playwright then refused to
   click it ("element is not stable") until it timed out — a looping transform on a control is an
   E2E trap. It is lit with `glow()` instead. Worth avoiding on any future button.
7. **Dead end worth a follow-up:** with 0 gems the studio correctly says "not enough gems", but
   nothing on the screen sells any — `GEM_PACKS` exists in `constants.ts` and the paywall only
   sells Plus. A gem-pack sheet (and a `studioGetGems` string/id) is the missing piece.

### Verification

- `pnpm --filter mobile typecheck` clean · `pnpm --filter mobile export:web` succeeds.
- Driven in Chromium at 390×844 twice: once against stubbed contract-shaped responses (every state
  including building → ready → publish, rejection, failure, empty wallet, and JA), and once against
  **the real API** (`LLM_MODE=replay`, private database): sign-in → picker → studio → build charged
  120 gems and routed to SCR-049 → my worlds listed it → Explore showed the community empty state →
  a second attempt with an empty wallet showed "Not enough gems" and a disabled CTA. The build
  itself cannot finish in this environment (`world.build.no_generator`: replay has no world
  generator fixture), so the ready state was verified against stubs only.

### Follow-up — the two contract updates from WS-API (same day)

8. **Distinct error codes.** `POST /v1/worlds` is now read by `code` first and only falls back to the
   HTTP status: `GEMS_REQUIRED` → `studioNotEnoughGems`, `WORLD_LIMIT` → `studioLimitReached`
   ("come back tomorrow"), `SAFETY_BLOCKED` → `studioPremiseBlocked`, and a plain `RATE_LIMITED`
   → `rateLimited`. Both 429s therefore say opposite things correctly. `ApiError` gained `isGems`
   and `isWorldLimit`, and `isEnergy` no longer swallows a `GEMS_REQUIRED` 402 — a gem shortfall
   must never open the energy modal, even from a call that did not opt out of global handling.
   Verified against the live API: 402 `GEMS_REQUIRED` and 422 `SAFETY_BLOCKED` both render their
   studio copy inline and leave the player on SCR-048 with what they typed.
9. **Three publish outcomes, three UI states.** `needsReview` on the body is what separates them.
   *unlisted* (200, `published`) now puts the link itself on screen with a copy/share affordance —
   `src/studio/share.ts`, the same web-share → clipboard → native-`Share` ladder the moment card
   uses, and the URL is built from `window.location.origin` or `EXPO_PUBLIC_APP_URL` so it is
   openable off the device. *public* (202, `review`) hides both publish buttons and shows
   `studioInReviewHint`. *private* is a real request now: "Keep it private" calls
   `publish("private")` whenever the world is unlisted, published or in review — that is what pulls
   it back out of the queue — and only then leaves for SCR-050. The copy-link row has no test id
   (none exists for it); `studioShareLink` / `studioCopyLink` would be welcome.

---

## Agent G9 — World Studio generator (AIF-003 / AIF-014)

Owned `packages/llm/**` only. Nothing in `packages/shared`, `apps/api`, `apps/mobile` or `e2e` was
touched. G9 was the last unbuilt generator; before this, a world could only be a hand-written
TypeScript file, so the product could never have more than three.

### What was added

| File | What it is |
| --- | --- |
| `src/generators/g9/types.ts` | `G9Input`, the five stage schemas, `G9_VARIANT_IDS`. |
| `src/generators/g9/screen.ts` | `screenPremise` + `sanitizePremise`. Pure, offline, gateway-free. |
| `src/generators/g9/vocab.ts` | Eight genre packs: nouns, places, factions, slang, handle stems, name pools. |
| `src/generators/g9/archetypes.ts` | Ten cast archetypes (relationships to the player), both locales. |
| `src/generators/g9/blueprint.ts` | The deterministic world: concept, prose, outro, cards, personas, events, texture. |
| `src/generators/g9/prompts.ts` | Studio system blocks, per-genre brief, concept/bible digests, the five task blocks. |
| `src/generators/g9/stages.ts` | The five `GeneratorSpec`s and their repair/postprocess. |
| `src/generators/g9/assemble.ts` | Stage outputs → `WorldSource` → `buildWorld` → `WorldSeed`. |
| `src/generators/g9/orchestrator.ts` | `runG9` and `aggregateMeta`. |
| `src/g9.test.ts` | 161 cases. |

### The stage table

| Stage | variantId | Tier | Calls | Why |
| --- | --- | --- | --- | --- |
| concept | `G9-concept@v1` | high | 1 | Small output, all the judgement. The only call that sees the premise. |
| bible | `G9-bible@v1` | high | 2 (per locale) | The cached prefix every later generation inherits. |
| cards | `G9-cards@v1` | mid | 8 (per character) | Volume, one shape, fanned out concurrently. |
| castevents | `G9-events@v1` | mid | 1 | 7 personas + 5 events × 3 choices. |
| texture | `G9-texture@v1` | light | 2 (per locale) | 22 ambient + 5 fallback lines/handle + welcome posts. |

Fourteen calls. Each lands in `GenerationLog` separately with its own four token counts and cost;
the `meta` returned by `gateway.g9()` is their aggregate and is deliberately **not** emitted again.
Measured in replay at `cost.ts` prices: **≈$0.32 per world** (concept $0.055, bible $0.139, cards
$0.076, events $0.026, texture $0.019) against a 120-gem price. Stages 3–5 share one per-world
cached prefix — 4,389 tokens, above Haiku 4.5's 4,096 minimum — so those eleven calls are one cache
write and ten cache reads.

### Deviations and decisions

1. **G9 is not in `GENERATOR_EXPERIMENTS`.** One `GeneratorId` covers five specs, and the registry
   allocates per generator, not per stage — registering it would have put five stage variants in
   one arm and changed the `/experiments/assignments` payload (`gateway.test.ts` pins its keys).
   Instead `run()` in `gateway.ts` takes an optional `fixedVariant`, and each stage names its own
   variant and tier. When G9 gets an A/B, it wants five experiments, not one.
2. **`run()`'s `TIn extends { locale?: string }` constraint was removed** (it was unused; G9's
   stage inputs are nested records, not the flat `BaseCtx` shape). `runBatch` is unchanged.
3. **`G9Input` carries no `userId`**, matching the contract apps/api declared. G9 runs before a
   world and often before a persona exists, so its `GenerationLog` rows have `userId = null`;
   `world-build.ts` already attaches `world.createdBy` itself.
4. **`meta.fallback` means *irrecoverable*, not *any stage fell back*.** apps/api refunds 120 gems
   and fails the build on it, so it is true only when the concept or the bible came from the
   template, or the parts would not assemble. A cast card or the ambient pool falling back leaves a
   complete, coherent world — the blueprint writes those in the concept's own handles and nouns —
   so it dents quality without voiding the purchase. Every stage still logs its own flag.
5. **Real brands and franchises are screened as `real_person`.** `WORLD_PREMISE_BLOCKED` has no
   separate brand category and `packages/shared` is frozen; `real_person` is the closest fit and
   the API's own screen already uses it that way. If shared ever reopens, a `real_brand` category
   would read better in the block copy.
6. **`screenPremise` ignores its `locale` argument by design** — both term sets always run. A
   Japanese user can type English and a screen that trusted the flag would be bypassable by
   switching it. The parameter is kept for signature stability and for the API's logging.
7. **Sexualised-minor detection is a combination rule, not a keyword list.** "student", "high
   school", "生徒" and "trainee" are the ordinary vocabulary of the academy and idol genres, so
   minor terms are split strong/soft: *any* minor marker plus an explicit sexual term blocks, and
   a *strong* marker (an explicit age under 18, "child", "小学生") plus a romance term blocks.
   "a high school romance" is allowed; "a romance between a teacher and a 15 year old" is not.
   The suite carries a 20-row table of realistic allow cases so the screen cannot drift shut.

### Replay bible tokens (per genre, `estimateTokens`, floor 4,096)

| genre | en | ja |
| --- | --- | --- |
| fame | 4867 | 4577 |
| academy | 4847 | 4454 |
| idol | 4849 | 4483 |
| office | 4834 | 4480 |
| sports | 4825 | 4508 |
| fantasy | 4853 | 4513 |
| mystery | 4834 | 4449 |
| slice_of_life | 4807 | 4464 |

### Verification

- `pnpm --filter llm test` — **296 passed / 9 files** (the 135 baseline plus 161 new; nothing
  weakened or skipped).
- `pnpm --filter llm typecheck` clean · `npx tsc --noEmit -p apps/api/tsconfig.json` clean (the
  API's feature-detected `g9Of` / `premiseScreenFrom` bind to the real exports unchanged).

## Agent MOD-API — what happens to a world after it is approved (WORLD_MODERATION)

Scope: `apps/api/**` only. Endpoints touched: `POST /v1/moderation/report`,
`GET /v1/admin/worlds/review`, `POST /v1/admin/worlds/:id/review`, `POST /v1/worlds/:id/publish`,
`GET /v1/worlds/:id`, `GET /v1/cost/summary`, `GET /v1/cost/live`; job: `world-build`.

### Deviations and cross-cutting needs

1. **No new row in `@rpgllm/shared`'s `JOBS` table.** The backlog sweep wanted to be its own
   scheduled job (`world-moderation`, `*/15`), but `JOBS` lives in `packages/shared` (frozen this
   pass) and `test/jobs.test.ts` asserts `GET /v1/jobs` equals that table exactly — adding a name
   here would have meant editing an existing test. The sweep therefore rides the **`world-build`**
   job: same `pg_try_advisory_xact_lock`, same `JobRun` row, same minute cadence, and it is the
   world-lifecycle job already. Its `detail` gained `inReview` / `overdueReviews` / `pulledWorlds`.
   *If shared reopens:* add `{ name: "world-moderation", schedule: "*/15 * * * *", description:
   "log the world review backlog" }`, move `sweepWorldModeration` to its own runner, and extend the
   `GET /v1/jobs` assertion to the shared table plus that row.
2. **`WorldReviewQueueResZ` has no paging field.** The queue can grow, so `GET /v1/admin/worlds/review`
   accepts `?limit=` and `?cursor=` (an offset — the order is a ranking, not a keyset) and answers
   with additive `total` / `nextCursor` keys that `WorldReviewQueueResZ.parse()` strips. If shared
   reopens, they belong in the contract.
3. **`GET /v1/cost` gained a `moderation` block** (`CostReport` + `CostLive`), additive in the same
   way `alarms` / `thresholds` already are. It is deliberately **not** a fourth `alarms` key:
   `test/cost.test.ts` asserts `alarms` by exact shape and that test was not to be weakened.
4. **`apps/api/src/fake-gateway.ts` gained `g9Screen`.** `packages/llm` added it to the `Gateway`
   interface mid-pass, which broke the API typecheck (`FakeGateway extends Gateway`). The stand-in
   agrees with layer 1 on `SAFETY_BLOCK_TEST_PHRASES` and allows otherwise; replay mode never calls
   it. Not a design decision, just keeping the owned directory compiling.

### Schema delta (`apps/api/prisma/migrations/20260905020000_world_post_publication_moderation`)

`World` gains `pulledAt DateTime?` (set only by an automatic takedown; cleared by any review
decision, so `pulled` distinguishes "taken down for another look" from "not looked at yet") and
`reviewRequestedAt DateTime?` (when the world joined the queue, so the SLA measures the wait and not
the world's age), plus `@@index([status, reviewRequestedAt])`. Existing `review` rows are
backfilled to `createdAt`. `Report` is unchanged — `status` + `reviewedAt` already carried the
resolution, and `@@index([target, targetId])` already serves the distinct-reporter count.

### Where the pull happens, and why it is safe

`services/world-moderation.ts::pullWorldIfBrigaded`, called inside the `POST /report` transaction,
so the report and the takedown commit together. It takes the `World` row's own
`SELECT … FOR UPDATE` **before** counting distinct reporters. That lock closes both concurrency
hazards a brigade creates: under-counting (three simultaneous reporters each seeing only their own
row, nobody pulling) is impossible because each waiter re-reads after the holder commits under READ
COMMITTED; double-pulling is impossible because the takedown is a conditional
`updateMany(where: status='published' ∧ visibility='public' ∧ ¬isPreset)`, so the loser of the race
writes nothing. Re-running it is a no-op and `pulledAt` keeps the timestamp of the pull that
actually happened. The lock is one row held for two statements and is taken only by the report
path, so it cannot deadlock against the build job or the review decision.

### Other decisions worth knowing

- A pulled world keeps `visibility: "public"` — what changed is "has a person looked at it lately",
  not "may it be listed" — so approving puts it straight back on the shelf.
- `canStillPlay` (in `world-studio.ts`) is `canPlay` plus one narrow exception: a **pulled** world
  stays open to anyone who already has a persona in it. Pulling from Explore is not eviction. New
  joins (`POST /v1/personas`) still go through plain `canPlay`.
- `loadReportedContent` now takes the viewer: reporting a world you cannot see 404s, so
  `POST /report` is not an oracle that turns a guessed id into "that world exists".
- `POST /v1/moderation/report` is on the **write** rate-limit budget. Brigading is the obvious
  attack on a threshold of three.
- A creator taking a pulled world private clears `pulledAt` (it is no longer waiting on anyone) but
  **leaves its reports open**, so the complaint history survives.

### Verification

- `pnpm --filter api test` — **311 passed / 28 files** (297 baseline, all still green, plus 14 in
  the new `test/world-moderation.test.ts`).
- `pnpm --filter api typecheck` clean. `prisma migrate diff` reports no drift between the
  migrations and `schema.prisma`; the migration is applied to the dev database.

---

## Agent SAFETY-EVAL — the premise screen's second layer, and G9 inside the eval gate

Two gaps the G9 pass recorded honestly rather than closed: `screenPremise` was one deterministic
layer, and G9 had no eval coverage at all. Both are `packages/llm` only; nothing outside it was
edited.

### 1. The premise screen is now two layers

`packages/llm/src/generators/g9/screen-model.ts` — `g9Screen`, a **classifier** stage.
`packages/llm/src/generators/g9/screen-deep.ts` — `screenPremiseDeep(gateway, premise, locale)`,
which owns the AND, the timeout and the failure policy.

- **Layer 1 keeps the first and final word on a block.** `screenPremiseDeep` returns before the
  gateway is touched when `screenPremise` blocks, so no model response can loosen a deterministic
  block, and the refused premises (the majority of abuse) cost nothing at all.
- **Live only.** In `replay` and `fail` the second layer is a no-op (`model: "skipped"`), so the
  E2E suite, the API tests and every offline run behave exactly as before, with no key.
- **Cheap.** Light tier, `max_tokens: 64`, a two-block cached prefix of ~430 tokens (policy +
  taxonomy) — G8's shape, deliberately not the world bible. `variantId` `G9-screen@v1`, so
  `GenerationLog` splits screen spend from the five studio stages.
- **It classifies.** The premise never enters a system block: it sits in a `<<<PREMISE … PREMISE>>>`
  fence in the *user* block, through `sanitizePremise`, and the prompt says to judge the request,
  not answer or continue it — a premise that reads as an instruction is itself `prompt_injection`.
  The taxonomy block also names what must *not* be blocked ("student", "trainee", "高校生",
  "同級生"), because two of the eight genres are made of those words.
- **Result shape is unchanged** — `{verdict, category}` over `WORLD_PREMISE_BLOCKED` — plus `layer`
  (`deterministic` | `model`), `model` (`skipped`/`allow`/`block`/`refused`/`error`) and the model
  call's `meta`, so the caller can log which layer decided and what it cost.

Failure policy, and the one judgement call in it:

| what happened | verdict |
| --- | --- |
| layer 1 blocked | block, model never called |
| replay / fail mode, or an empty premise | layer 1's verdict, no call |
| model said block | **block**, category coerced onto the taxonomy (unmappable → `null`) |
| model **refused** | **block** — a refusal is a judgement about this text, not about the network |
| timeout / transport error / junk after the gateway's retry | layer 1's verdict, flagged `error` |

Blocking on an *infrastructure* failure would turn a provider outage into "nobody can create a
world"; the premise has still passed layer 1, still meets the fleet-wide safety block in every
studio prompt, still faces G8 on every in-game action and still needs human review before publish.
So the default degrades to exactly today's behaviour and says so in the result. Operators who want
the other trade-off set `LLM_PREMISE_SCREEN_ON_ERROR=block` (or pass `failClosed: true`);
`LLM_PREMISE_SCREEN_TIMEOUT_MS` (default 4000) caps the added latency.

**Probe table** (`packages/llm/src/premise-screen.test.ts`): 32 realistic premises that the
deterministic layer allows — 16 that a 13+ product must still refuse (paraphrased minors with no
age word, "fourteen" spelled out, 高校の先生と生徒, franchises and real people by periphrasis,
injection dressed as world-building) and 16 ordinary academy/idol/sports/office/mystery premises in
both locales. Layer 1 alone scores **16/32** (it blocks none of the paraphrases and over-blocks
none of the ordinary ones). With a correct second layer the combined screen scores **32/32**; with
a rubber-stamp model it is never worse than layer 1; with a block-everything model no allow slips
through. Layer 2's real-world accuracy cannot be measured here — there is no key — so what the
suite proves is the wiring and every failure mode.

### 2. G9 in the offline gate (§6.2)

- `packages/llm/src/eval-core.ts` — the shared pieces (weights, pass bar, `machineScoreOf`, result
  rows) so G1 and G9 produce comparable runs. `eval.ts` re-exports all of them; every existing
  import path is unchanged.
- `packages/llm/src/eval-g9.ts` — `g9Metrics`, `machineChecksG9`, `distinctnessOf`,
  `judgeContextG9`, `judgeCandidateG9`, `runEvalG9`.
- `packages/llm/src/eval-cases-g9.ts` — 18 frozen cases: two premises per genre (one EN, one JA)
  plus `hard:echo-bait` and `hard:at-the-limit` (271 chars).
- `runEval(gateway, {generator: "G9", …})` dispatches to the studio runner; `evaluateGate` needed
  no change. `GJ_CRITERIA.G9` was added to `generators/gj.ts`.

17 machine checks in five families. What they measure on the 18 replay worlds today:

| family | measured | replay range |
| --- | --- | --- |
| structural | bible tokens en / ja (floor 4,096) | 4770–4884 / 4433–4574 |
| structural | 8 cast · 7 personas · 5 events × 3 choices · ambient/locale · min fallback lines · welcome posts | 8 · 7 · 5/5 · 22 · 5 · 8 |
| integrity | unknown `@handle` references · illegal handles · duplicate handles / names · press accounts | 0 · 0 · 0/0 · 1 |
| locale parity | locale gaps · JA CJK character ratio · fraction of JA fields identical to their EN twin | 0 · 0.809–0.819 · 0.00 |
| containment | verbatim premise echoes (whole sentence + 8-word / 16-char windows of both the raw and the sanitised premise) · scaffolding leaks · unfilled `{slots}` | 0 · 0 · 0 |
| distinctness | handle / display-name / bible-line / cast-card overlap against a same-genre sibling | see below |

`schemaValid`, `notFallback`, `premiseContained` and `noScaffoldLeak` are absolute (failing one
scores the case zero). Every check is broken deliberately in the suite to prove it is load-bearing.

**The distinctness finding.** Two different premises in the *same* genre, built by the deterministic
blueprint, share **0.70–0.80 of their bible lines** and **0.60–0.78 of their cast cards**, while two
worlds of *different* genres share only 0.30 / 0.00. Handles (0.33–0.60) and display names
(0.07–0.33) do vary. So the blueprint is a template: the names change, the prose does not. The
limits are set at 0.5 on all four measures (the cross-genre floor of 0.30 is the fleet-wide
scaffolding every world carries), which means `distinctFromSibling` is **the one check that fails on
every replay world** — correctly. In live mode those halves are written by the model, and this is
the assertion that will notice if they are not. Word-level bible overlap (0.83–0.92 same genre,
0.71 across genres) is reported but not gated: it is dominated by function words, not by content.

`runEval` on the full frozen set, in replay: **18 cases, 18 passed, mean 87.88 (82.35–94.35)**,
machine 0.9412 each (16 of 17), judge 0.77–0.88 from the offline heuristic, 441ms wall,
$5.83 at simulated prices ($5.73 of worlds at ≈$0.32 each + $0.10 of judging), 270 `GenerationLog`
rows (18 × 14 stages + 18 judgements).

### Deviations and decisions

1. **`machineScoreOf(checks, absolutes?)` took a second parameter**, defaulting to G1's list, so
   `machineScoreOf(checks)` behaves exactly as it did. G9's absolute list adds containment.
2. **`EvalCaseSpec` was left alone** (still `generator: "G1"`, `input: G1Input`); G9's frozen cases
   use a separate `G9EvalCaseSpec`. Widening the shared type would have rippled into
   `apps/api/src/services/evals.ts` for no gain.
3. **A G9 eval case returns only the judge's `GenerationMeta` in `metas`.** `gateway.g9()` already
   emits a row per stage and apps/api logs everything in `metas`; returning the aggregate would
   double the studio's spend in the cost dashboard (see G9 §4 above).
4. **G9 is not batchable.** It is fourteen dependent calls behind one gateway method, so the worlds
   are built through the interactive path and only the judgements go out as one batch — which is
   where §5.4's 50% still applies.
5. **The judge reuses `GJ_AXES` and `GJ_WEIGHTS` rather than a parallel rubric.** `CRITERIA.G9`
   re-points the six axes at a world, exactly as `CRITERIA.G7` already does for summaries:
   inCharacter = coherence with the premise, diversity = are the eight distinguishable,
   humour = does the world give the player something to do, jpNaturalness = does the JA read
   natively, safety unchanged, emoji not applicable (score 8, G7's precedent). Each case is judged
   on **one locale**, projected and cut to ~5.9kB, or the JA axis would be measuring a candidate
   that is half English.

### What apps/api would need to adopt layer 2 (cross-cutting, not done here)

`apps/api/src/services/g9.ts` feature-detects a **synchronous** `screenPremise` and that still
works unchanged — the deep screen is strictly additive. To get the second layer, the world-create
path would `await screenPremiseDeep(gateway, premise, locale)` instead, keep its own local floor
ANDed on top (it already never unblocks), and persist `layer` / `model` next to the verdict. Two
notes for whoever does it: a model block can carry `category: null` (the model blocked but named no
category we recognise), so the 422 copy needs a generic fallback; and the call adds up to
`LLM_PREMISE_SCREEN_TIMEOUT_MS` to the create request.

### Known gaps left open (measured, not fixed)

- **Layer 1 over-blocks "suicide" as a topic.** `screenPremise("a drama about a town still
  recovering from a suicide ten years ago")` blocks as `self_harm`. It is a keyword list, and
  `suicide` has no innocent reading in it. Fixing it needs the same strong/soft split the minor
  rules already use, and would change a pinned test, so it is recorded rather than changed.
- Layer 2's classification accuracy is unmeasured: there is no API key in this sandbox, so the
  probe table exercises the wiring against stub classifiers, not the model.

### Verification

- `pnpm --filter llm test` — **417 passed / 11 files** (the 303 baseline, unchanged and unweakened,
  plus 66 premise-screen and 48 G9-eval tests).
- `pnpm --filter llm typecheck` clean · `npx tsc --noEmit -p apps/api/tsconfig.json` clean ·
  `pnpm --filter api test` — 311 passed / 28 files, unchanged.

## Agent MOD-CLIENT — reporting a world, a pulled world's own words, and the resubmit cooldown

Scope: `apps/mobile/**` only. Screens touched: SCR-010 feed header, SCR-046 Explore, SCR-037
report, SCR-049 build/reveal, SCR-050 my worlds. No contract, string or test id was added — MOD-API
had already frozen `WorldSummaryFullZ.pulled`, `T.reportWorld` and
`reportWorld` / `reportWorldTitle` / `studioPulled` / `studioPulledHint` / `studioResubmitWait`.

### Where the two report entry points are, and why there

1. **Playing it** — the "…" sits on the world's own chip in the feed header (`(tabs)/feed.tsx`),
   immediately right of `WorldChip`. A player who decides a world is wrong decides it while reading
   its feed, and the chip is the only thing on that screen that *is* the world. Same glyph, same
   `Overflow` component, same destination as every other reportable cell.
2. **Looking at it in Explore** — the "…" on each community `StudioWorldCard`, pinned top-right,
   rendered as a **sibling** of the card's `Pressable` (the PostCell rule: nested pressables let one
   tap both report the world and walk into it).

Both refuse to appear on a preset or on your own world. Explore has `isMine` / `isPreset` on the
row; the feed does not, so `isSomeoneElsesWorld()` (`src/studio/report.ts`) infers it from the
picker — `GET /v1/worlds` is "every preset plus the worlds you made", so a slug missing from it
belongs to somebody else. A `null` picker (not loaded, or failed) offers nothing.

### Deviations and things worth knowing

1. **`T.reportWorld` is a bare constant, not a per-item id**, and Expo Router keeps the screen
   underneath mounted — so the feed's copy would have matched a second time under a stacked
   `/explore`. The feed therefore renders it **only while the feed is the focused screen**
   (`useFocusEffect` → a `focused` flag). Verified in Chromium: `[data-testid="report-world"]`
   matches exactly **1** on the feed, **1** on Explore (one community world), and **1** on
   `/report` — the Explore card beneath it; the report screen adds none of its own.
2. **`StudioWorldCard`'s `testID` moved from its `Pressable` to a wrapper `View`.** That is what
   lets the "…" be a sibling and still be reachable as
   `getByTestId(T.communityWorldCard(slug)).getByTestId(T.reportWorld)`. Clicking the card by its
   test id is unaffected (the click lands on the inner pressable), and `studio.spec.ts`'s
   `toBeVisible` on `communityWorldCard` still holds.
3. **`WorldChip` now shrinks.** The feed header was *already* overflowing at 390 px with a long
   world title plus streak + energy + coffee + settings (the streak pill overlapped the chip before
   this pass); the chip had `maxWidth: 210` but no `flexShrink`, so nothing could give. It now
   shrinks and ellipsises instead of pushing the controls off screen.
4. **The pulled world does not say the same thing twice.** On SCR-049 the headline becomes
   `studioPulled` in `colors.danger` (and the reveal burst does **not** fire over a takedown), the
   state pill stays factual — `studioInReview`, which is what the world's status is — and a
   shield-marked panel carries `studioPulledHint`. On the SCR-050 card there is no room for a panel,
   so there the **pill** carries `studioPulled` in danger with the hint underneath. A pulled world
   keeps its Play button and its "Keep it private" way out; nothing is hidden or greyed.
5. **The resubmit cooldown is read off the refusal, not computed.** `WorldSummaryFullZ` carries no
   `reviewedAt` / `resubmitAvailableAt`, so the client cannot pre-empt the wait — it offers
   "Share it with everyone" on a rejected world, and on the server's refusal replaces it with
   `studioResubmitWait` and a clock. `isResubmitCooldown()` accepts **409** (what
   `POST /v1/worlds/:id/publish` returns from `resubmitCooldownHours`, before the safety gate) and
   429, and only when the world is actually `rejected` — 409 also means "it hasn't finished
   building". *If the contract reopens:* a `resubmitAvailableAt` timestamp would let the button say
   the wait before it is pressed instead of after.
6. **Nothing was stubbed.** MOD-API landed mid-pass, so the walkthrough below drives real endpoints:
   three distinct accounts reporting one approved world really pulls it
   (`status=review pulled=true`), and the resubmit refusal is the server's own 409.

### Verification

- `pnpm --filter mobile typecheck` clean; `pnpm --filter mobile export:web` succeeds.
- Driven in Chromium at 390×844 against a live API + web export, EN and JA: feed → Explore →
  report → `reportDone`; three reporters → pulled → the creator's SCR-049 and SCR-050; reviewer
  rejects → resubmit → `studioResubmitWait` and the button withdrawn (`studio-publish` count 0).
