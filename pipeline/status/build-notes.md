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
