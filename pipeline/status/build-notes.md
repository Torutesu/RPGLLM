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
- `pnpm --filter api test` — green. 28 new cases in `test/trending.test.ts` and
  `test/characters.test.ts` (heat curve, media determinism/rate/reply exclusion, topic extraction,
  the rank curve, the two endpoints, blocked-character filtering, ownership 404s).
- New E2E file `e2e/tests/discovery.spec.ts`: DISC-001..006.
- API test runs isolate with `TEST_DATABASE_URL=…/rpgllm_k` (the vitest config's `env` block
  overrides a plain `DATABASE_URL`, so that is the only var that works); the shared `rpgllm_test`
  database was being truncated by parallel agents throughout.

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
