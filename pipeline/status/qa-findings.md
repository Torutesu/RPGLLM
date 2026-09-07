# QA findings — hostile pass over the world lifecycle

Agent QA, branch `claude/status-app-research-copy-3wlla5`. Written against the tree as of the
World Studio / world-moderation work (`e390168`), probed through both the API and a real Chromium.

**Method.** Baseline first: `cd e2e && npx playwright test` → **54 passed**, exit 0. Then a scratch
probe spec drove the studio state machine over the API and asserted through the UI, the way the
house cases do. Every claim below is a transcript from a run, not a reading of the source. The
scratch spec was deleted; the findings worth guarding are now cases in
`e2e/tests/world-lifecycle.spec.ts`. Screenshots referenced below are under
`/tmp/claude-0/-home-user-RPGLLM/eeac402b-8806-5fd2-846a-21bc19595131/scratchpad/qa/`.

**Status as of hand-off.** The orchestrator picked these up while the pass was still running and
closed three of them in `9ffc2b2` ("Build appeals and review claims, and close three QA findings"):
**QA-001, QA-004 and QA-005 are fixed and now pass as ordinary regression guards** — their
`test.fail()` annotations have been removed. **QA-002, QA-003a, QA-003b and QA-006 are still open**
and remain `test.fail()`. Re-running `npx playwright test tests/world-lifecycle.spec.ts` is the
check: an "Expected to fail, but passed" is the signal to drop the annotation on the next one.

**Nothing in `apps/` or `packages/` was touched by this pass.** Two other agents were editing
`apps/api/src/routes/worlds.ts`, `services/world-moderation.ts` and `app/studio/[id].tsx` while this
pass ran (the appeals + review-claim work). Findings QA-001..QA-004 are all in code paths that pass
did not change, but the orchestrator should re-run the new cases after it lands.

---

## Ranked findings

| # | Severity | State | One line |
|---|----------|-------|----------|
| QA-001 | **High** | **fixed** | A world that reports pulled off the shelf escaped moderation for good by republishing it as `unlisted`. |
| QA-002 | **High** | open | The share link for an unlisted world is dead for everyone but its creator. |
| QA-003 | **High** | open | SCR-048's "Who can play?" picker is inert, and picking "Everyone" strands the world with no way to publish it. |
| QA-004 | Medium | **fixed** | The rejection cooldown was bypassable in two calls (private, then public). |
| QA-005 | Low | **fixed** | A whitespace-only premise passed validation and cost 120 gems. |
| QA-006 | Low | open | Explore renders a bare "Trending now" heading — no content, no empty state — for an account with no persona. |

---

## QA-001 — a pulled world escapes moderation by going `unlisted` (High)

**FIXED** in `9ffc2b2`. **Guarded by** `QA-001` in `e2e/tests/world-lifecycle.spec.ts`, now a plain
passing regression guard. The transcript below is the behaviour before the fix.

`POST /v1/worlds/:id/publish` refuses a resubmit only when `world.status === "rejected"`
(`resubmitCooldownHours`). A world that three distinct reporters just pulled is `status: "review"`
with `pulledAt` set — not `rejected` — so it walks straight through, and `visibility: "unlisted"`
sets `status: "published"` and clears `pulledAt`.

**Repro** (all over the API; `TEST_HOOKS=1`):

1. Build a world, `POST /v1/worlds/:id/publish {"visibility":"public"}`, approve it via
   `POST /v1/admin/worlds/:id/review {"decision":"approve"}`.
2. Three separate accounts each `POST /v1/moderation/report {"target":"world","targetId":…}` → `201`, `201`, `201`.
3. The world is pulled — `GET /v1/worlds/mine` shows
   `{"status":"review","visibility":"public","pulled":true}`. Correct so far.
4. The creator sends **one** request: `POST /v1/worlds/:id/publish {"visibility":"unlisted"}` → **`200`**,
   body `{"status":"published","visibility":"unlisted","pulled":false}`.

**What that buys the creator, measured in the same run:**

- `GET /v1/admin/worlds/review` → `{"worlds":[],"overdueCount":0,"total":0}`. The world has **left the
  queue**. No human will ever see the thing three people complained about.
- A brand-new signed-in stranger: `GET /v1/worlds/<id>` → **`200`**. The content is still readable by
  anyone who has the id, and the id is in the share link, in Explore's cache, in a screenshot.
- `GET /v1/moderation/reports?status=open` → still **3 open reports**, now attached to nothing any
  surface lists.
- It can never be pulled again: `pullWorldIfBrigaded` requires `visibility === "public"`, so further
  reports pile up as open rows and do nothing.

**Why it matters.** This is the takedown mechanism's only enforcement path, and one API call undoes
it permanently while *looking* like a de-escalation ("I made it link-only"). The report queue is the
surface a human moderator works from; a world that leaves it with its complaints unresolved is worse
than one that was never reported. Not reachable from the current UI — SCR-049 hides both publish
buttons while `status === "review"` — but every id in this product is guessable and the endpoint is a
plain authenticated POST.

**Suggested shape of a fix (orchestrator's call):** a pulled world (`status: "review" && pulledAt !== null`)
should refuse any `visibility` change except `private`, the same way a rejected one refuses a
resubmit; and `private` should not clear the open reports either.

---

## QA-002 — the unlisted share link is dead for the recipient (High)

**OPEN.** **Guarded by** `QA-002` in `e2e/tests/world-lifecycle.spec.ts` (`test.fail()` until fixed).

`apps/mobile/src/studio/share.ts` builds the link as `<origin>/studio/<worldId>`. That route is
`apps/mobile/app/studio/[id].tsx`, whose only data source is `useWorldStatus` →
`GET /v1/worlds/:id/status`. That endpoint is creator-only by design:

```
app.get("/:id/status", requireAuth, async (c) => {
  ...
  if (!world || world.createdBy !== user.id) return notFound("World");
```

**Repro:**

1. Creator builds a world, `POST /v1/worlds/:id/publish {"visibility":"unlisted"}` → `200`,
   `status: "published"`. SCR-049 now shows the "Copy link" panel with `http://localhost:8082/studio/<id>`.
2. A second account opens exactly that URL.

**Observed:**

```
friend GET /v1/worlds/<id>/status -> 404 {"code":"NOT_FOUND","message":"World not found"}
friend GET /v1/worlds/<id>        -> 200
```

and the page (screenshot `p2-unlisted-link.png`) reads, in full:

```
World Studio
Couldn't load. Try again.
Retry
```

**Why it matters.** Unlisted's entire product value is the link — "listed nowhere, the link *is* the
distribution", per the file's own header comment. The API is willing to serve the world
(`GET /v1/worlds/:id` returns 200 for an unlisted+published world, correctly), so this is a routing
bug, not an authorization one: the link points at the creator's build screen instead of at somewhere
a recipient can play. Every unlisted world shipped so far is unshareable.

---

## QA-003 — the create-time visibility picker does nothing, and "Everyone" strands the world (High)

**OPEN.** **Guarded by** `QA-003a` and `QA-003b` in `e2e/tests/world-lifecycle.spec.ts` (both
`test.fail()` until fixed).

SCR-048 offers three radio rows — 自分だけ / リンクを知っている人 / みんな, testids
`studio-visibility-{private,unlisted,public}` — and `POST /v1/worlds` writes the chosen value onto
the `World` row. Nothing downstream ever acts on it. `jobs/world-build.ts` finishes every world with
`seedWorld(..., { status: "ready" })` and never touches `visibility`, and both the review queue and
Explore key off `status`, not `visibility`.

**Repro (API):** create three worlds, one per visibility, run `world-build`, read `/v1/worlds/mine`:

```
CREATE visibility=public   -> 201    after build: status=ready visibility=public
CREATE visibility=unlisted -> 201    after build: status=ready visibility=unlisted
CREATE visibility=private  -> 201    after build: status=ready visibility=private
```

- The `public` world is in **no** review queue (`/v1/admin/worlds/review` total 0) and **not** in
  Explore (`/v1/worlds/public` is empty) — it just claims to be public.
- The `unlisted` world is not reachable either: a stranger's `GET /v1/worlds/<id>` → **`404`**,
  because `canPlay` requires `status === "published"`. So "link-only" produces a world with no
  working link and no copy-link panel (that panel requires `status === "published"`).

**And then the recovery path is hidden.** On SCR-049 the share button is rendered only when
`world.status !== "review" && world.visibility !== "public"`. For a world created as `public` that is
false, so:

```
publish btn count: 0
BODY: World Studio / Seven Survival / Your world is ready / … / EVERYONE / 0 plays / THE CAST …
```

(screenshot `p10-public-at-create.png` — the status badge reads **EVERYONE** on a world that no one
else can see). The player has spent 120 gems, been told the world is public, and there is no control
on the screen that submits it for review — `getByTestId("studio-publish")` resolves to no element
at all (screenshot `qa-003b-no-publish-button.png`). The only escape is "Keep it to myself", which
navigates away to `/studio/worlds`, then re-entering the world.

**Why it matters.** This is the same class as the `unlisted` state nobody could reach: a user-visible
choice that silently does nothing, plus an affordance that keys off the resulting bad state and
withdraws the button that would fix it. It is also the most likely thing a first-time player does —
"Everyone" is the aspirational option on the screen that sells the studio.

---

## QA-004 — the rejection cooldown is bypassable in two calls (Medium)

**FIXED** in `9ffc2b2`. **Guarded by** `QA-004` in `e2e/tests/world-lifecycle.spec.ts`, now a plain
passing regression guard. The transcript below is the behaviour before the fix.

E2E-035 asserts a turned-down world cannot be bounced straight back at the queue, and the direct path
is correctly refused. But `resubmitCooldownHours` keys on `world.status === "rejected"`, and
publishing as `private` rewrites `status` to `"ready"` while leaving `reviewedAt` alone — which
erases the only evidence the cooldown reads.

**Repro:**

```
POST /publish {"visibility":"public"}   -> 409   (correct — the cooldown)
POST /publish {"visibility":"private"}  -> 200   world is now {"status":"ready","visibility":"private"}
POST /publish {"visibility":"public"}   -> 202   {"status":"review","visibility":"public"}
GET  /v1/admin/worlds/review            -> total 1
```

Elapsed: three requests, no waiting. `WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS` is 24.

**Why it matters.** The cooldown exists so a reviewer's decision costs the creator something; without
it one rejected world can be re-queued in a loop and a reviewer's "no" is free to ignore. Lower than
the two above only because the world still lands in a human queue rather than escaping one. Note this
is reachable from the UI too — the ghost "Keep it to myself" button on SCR-049 calls
`publish("private")` for a world in `review`.

---

## QA-005 — a whitespace premise is a valid 120-gem purchase; non-Latin premises all share a slug (Low)

**FIXED** in `9ffc2b2`. **Guarded by** `QA-005` in `e2e/tests/world-lifecycle.spec.ts`, now a plain
passing regression guard. The transcript below is the behaviour before the fix.

`CreateWorldReqZ` is `z.string().min(8).max(200)` on the raw string. The client guards with
`premise.trim()`, the server does not.

```
premise = "          "        -> 201, gems 120 -> 0, world built, slug "idol"
premise = "\n\n\n\n\n\n\n\n\n\n" -> 201, gems 120 -> 0, world built, slug "idol"
premise = "x".repeat(201)     -> 400 VALIDATION, gems 120       (correct)
premise = "tiny"              -> 400 VALIDATION, gems 120       (correct)
```

Separately, `slugifyPremise` strips to `[a-z0-9]` and falls back to the **genre** when fewer than 3
characters survive, so every Japanese, Arabic or emoji premise in a given genre collapses to the same
base slug:

```
premise = "سبعة متدربين ومكان واحد للظهور الأول في فرقة"  -> slug "idol"
premise = "🎤🎤🎤 seven trainees 🎶 one slot 🔥"            -> slug "seven-trainees-one-slot"  (fine)
```

The unique index then serialises them as `idol`, `idol-2`, `idol-3`… The slug is what drives the
procedural cover art (`WorldCover slug=`) and `titleFromSlug`, so two unrelated JA worlds get
near-identical art. Low severity — nobody loses money to the second half, and the first half is
guarded in the client — but a 200-char field with a `.trim()` on one side only is exactly the seam
things fall through.

---

## QA-006 — Explore's "Trending now" is a heading over nothing when there is no persona (Low, cosmetic)

**OPEN.** **Guarded by** `QA-006` in `e2e/tests/world-lifecycle.spec.ts` (`test.fail()` until fixed).

`ExploreScreen`'s `load()` returns early when `personaId` is null, so `trending` stays `null` forever.
The empty-state card is gated on `trending && trending.topics.length === 0`, which never becomes
true. A signed-in account with no persona — every account between sign-up and entering a world, and
the stranger E2E-031 itself drives to `/explore` — sees:

```
Explore
TRENDING NOW
RISING WITH YOU
Your world is waking up…
MADE BY PLAYERS
No player worlds yet — be the first
…
```

`TRENDING NOW` has no card, no spinner and no copy under it (screenshots `p9-explore-empty.png`,
`qa-006-explore-blank-trending.png`). The container itself is measurably gone, not merely empty:
`getByTestId("trending-list")` resolves but reports **hidden**, because a `View` with no children
collapses to zero height. "Made by players" and "Rising" both handle the empty case properly, which
makes the gap look like a render failure rather than an intentional blank.

---

## What I probed and found sound

A report that only lists failures has not looked anywhere. These were attacked and held:

**Authorization / other people's things**
- Every `/v1/worlds/*` route rejects an anonymous request: `GET /:id` → 401, `GET /:id/status` → 401,
  `GET /public` → 401, `GET /mine` → 401, `POST /:id/publish` → 401.
- A signed-in stranger publishing someone else's world → **404**, not 403 — the id is not confirmed
  to exist. Same for `POST /v1/moderation/report` against a private world → **404**.
  `loadReportedContent` runs `canStillPlay` before it will file, so report cannot be used as an
  existence oracle for a guessed id. This is deliberate and correctly done.
- `adminTokenMatches` fails closed on an unset `ADMIN_TOKEN` (`expected.length > 0 && …`), so the
  admin surface is open only under `TEST_HOOKS=1`.
- E2E-032's guarantees still hold: a stranger gets 404 on both `/:id` and `/:id/status` for a private
  world, and it appears in no picker.

**Money and energy**
- Two `POST /v1/worlds` fired concurrently with exactly one world's worth of gems (120): `201` / `402`,
  **one** world created, balance `120 → 0`. `spendGems` puts the `gems >= cost` guard in the WHERE
  clause, so read-then-write cannot overdraw. No free world.
- A premise the validator refuses (too long, too short) leaves the balance at 120 — no row, no charge.
- `spendEnergy` uses the same conditional-update shape; `refundWorldOnce` claims `refundedAt` with a
  conditional UPDATE in the wallet's own transaction, which is what makes E2E-033's "refund exactly
  once" hold under a re-run.
- A second report from the same account against the same world → **409**, and
  `pullWorldIfBrigaded` counts `distinct: ["userId"]` independently, so the duplicate guard is not
  the only thing standing between one angry player and a takedown.

**Locales**
- `strings.en` and `strings.ja` have **exact key parity** — 282 / 282, no key in one and not the
  other. The only two JA values that are pure ASCII are `plusTitle` ("status plus", a product name)
  and `dms` ("DM", which is the Japanese word), both correct.
- SCR-048 and SCR-003 under `locale: "ja"` render fully translated, including the genre chips, the
  three visibility rows and their hints, the gem price and the "3 残り（今日）" allowance chip. No raw
  string key, no English fallback, no doubled `@@` prefix (screenshots `p8-studio-ja.png`,
  `p8-picker-ja.png`). Handles come off the API bare and the client owns the `@`.

**The things that only break slowly**
- The build poll stops when the world stops moving: `GET /:id/status` was requested **1** time on a
  finished world, still 1 after 8 seconds idle on the screen, and still 1 six seconds after
  navigating away. No runaway timer, no fetching after unmount.
- Reloading the browser mid-build resumes the progress screen (`studio-building` visible again) and
  the world still completes and reveals.
- A deep link to `/studio/<garbage-id>` as a signed-in user degrades to "Couldn't load. Try again."
  with a Retry button after two 404s — it does not spin forever. (`useWorldStatus` treats a 404 as
  terminal at `failures >= 2`.)
- Running `world-build` twice over a world that died in `LLM_MODE=fail` refunds once (E2E-033's own
  assertion, re-confirmed).

**Empty and hostile input**
- 201-character premise → 400 with a readable message; 4-character premise → 400. Bounds are enforced
  server-side, not only in the client.
- An emoji premise builds a world with a sensible slug and a full cast.
- "Made by players" with nothing published renders its proper empty state with a call to action.

---

## Notes for whoever fixes these

- QA-001 and QA-004 are the same underlying shape: `POST /:id/publish` decides what it is allowed to
  do from `status` alone, and two of its own writes (`private` → `ready`, `unlisted` → `published`)
  destroy the state the guards read. A guard that reads `reviewedAt` / `pulledAt` rather than
  `status` would close both.
- QA-002 and QA-003 are both about `visibility` being written in places nothing downstream honours.
  If create-time visibility is not meant to be honoured, the three rows should not be on SCR-048;
  if it is, `world-build` needs to finish a `public` world into `review` and an `unlisted` one into
  `published`, through the same safety gate `publish` uses.
- None of the six needs an E2E case weakened to land. The new cases are `test.fail()` and will start
  reporting as unexpected passes the moment the product is right, which is the signal to drop the
  annotation.
