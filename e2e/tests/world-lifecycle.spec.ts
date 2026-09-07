import { expect, test, type APIRequestContext } from "@playwright/test";
import { T, WORLD_MODERATION, WORLD_STUDIO } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, gotoApp, loginInBrowser, resetDb, setLlmMode, unwrap, wallet,
  type Account, setGems,} from "../fixtures";

/**
 * QA-001..QA-006 — the world lifecycle, attacked rather than demonstrated.
 *
 * `studio.spec.ts` proves the happy paths of SCR-048/049/050 hold. This file is the other half: the
 * transitions nobody meant to be reachable, the second call that undoes the first one's guard, and
 * the two places `visibility` is written and then never honoured. Every case here is a finding
 * written up in `pipeline/status/qa-findings.md` with the transcript it came from.
 *
 * Every case here was written as `test.fail()` first — broken product, asserted — and Playwright
 * reports an unexpected *pass* as a failure, so fixing one made the suite say so and the annotation
 * came off. All six are now ordinary regression guards. Nothing was weakened to go green
 * (CLAUDE.md rule 3): QA-002 is the only assertion that changed, because the original guessed the
 * fix would be to open the creator-only build screen to strangers, and the actual fix was a
 * separate world page — so it now pins that, plus the credit, plus the old links still working.
 *
 * Setup runs over the API because none of these findings are about how the studio is driven — they
 * are about what the server allows once you are there — and the assertions come back through the UI
 * wherever a screen is what actually misleads the player.
 */

const PREMISE = "Seven trainees, one debut slot, and a group chat that leaked";
const GENRE = "idol";

interface StudioWorld {
  id: string; slug: string; title: string; status: string; visibility: string;
  playCount: number; creatorHandle: string | null; reason: string | null; pulled: boolean;
}

/* --------------------------------------------------------------- helpers ---- */

/** The build is a scheduled job; E2E drives it by name, as `studio.spec.ts` does. */
async function buildWorlds(request: APIRequestContext): Promise<void> {
  await unwrap(
    await request.post(apiUrl("/v1/jobs/run"), { data: { job: "world-build" }, failOnStatusCode: false }),
    "POST /v1/jobs/run world-build",
  );
}

async function myWorlds(request: APIRequestContext, jwt: string): Promise<StudioWorld[]> {
  const res = await request.get(apiUrl("/v1/worlds/mine"), { headers: bearer(jwt), failOnStatusCode: false });
  return (await unwrap<{ worlds: StudioWorld[] }>(res, "GET /v1/worlds/mine")).worlds;
}

async function publicWorlds(request: APIRequestContext, jwt: string): Promise<StudioWorld[]> {
  const res = await request.get(apiUrl("/v1/worlds/public"), { headers: bearer(jwt), failOnStatusCode: false });
  return (await unwrap<{ worlds: StudioWorld[] }>(res, "GET /v1/worlds/public")).worlds;
}

/** The admin review queue. `TEST_HOOKS=1` is the gate, so no token is needed here. */
async function reviewQueue(request: APIRequestContext): Promise<{ worlds: StudioWorld[]; total: number }> {
  const res = await request.get(apiUrl("/v1/admin/worlds/review"), { failOnStatusCode: false });
  return await unwrap<{ worlds: StudioWorld[]; total: number }>(res, "GET /v1/admin/worlds/review");
}

async function openReports(request: APIRequestContext): Promise<number> {
  const res = await request.get(apiUrl("/v1/moderation/reports?status=open"), { failOnStatusCode: false });
  return (await unwrap<{ reports: unknown[] }>(res, "GET /v1/moderation/reports")).reports.length;
}

/** `POST /v1/worlds` without asserting the outcome — several cases want a specific refusal. */
function createWorld(
  request: APIRequestContext, jwt: string, opts: { premise?: string; visibility?: string } = {},
) {
  return request.post(apiUrl("/v1/worlds"), {
    headers: bearer(jwt),
    data: {
      premise: opts.premise ?? PREMISE,
      genre: GENRE,
      locale: "en",
      visibility: opts.visibility ?? "private",
    },
    failOnStatusCode: false,
  });
}

const publish = (request: APIRequestContext, jwt: string, worldId: string, visibility: string) =>
  request.post(apiUrl(`/v1/worlds/${worldId}/publish`), {
    headers: bearer(jwt), data: { visibility }, failOnStatusCode: false,
  });

const review = (request: APIRequestContext, worldId: string, decision: "approve" | "reject", reason = "") =>
  request.post(apiUrl(`/v1/admin/worlds/${worldId}/review`), {
    data: { decision, reason }, failOnStatusCode: false,
  });

const reportWorld = (request: APIRequestContext, jwt: string, worldId: string) =>
  request.post(apiUrl("/v1/moderation/report"), {
    headers: bearer(jwt), data: { target: "world", targetId: worldId, reason: "other", note: "" },
    failOnStatusCode: false,
  });

/** A built, `ready`, private world belonging to `account`. The shortest way to a real world. */
async function aBuiltWorld(request: APIRequestContext, account: Account, visibility = "private"): Promise<StudioWorld> {
  /*
   * Funded *before* the create, not after the build. Choosing "Everyone" at create time is choosing
   * to publish — the build job walks the finished world through the same shelf charge — so the
   * server now prices this create at build + shelf and refuses it up front. Topping up afterwards
   * was too late, and that is exactly the bug this ordering caught.
   */
  await setGems(request, account.jwt, WORLD_MODERATION.PUBLIC_SUBMIT_GEMS * 6);
  const res = await createWorld(request, account.jwt, { visibility });
  expect(res.status(), "POST /v1/worlds must accept a plain premise").toBe(201);
  await buildWorlds(request);
  const worlds = await myWorlds(request, account.jwt);
  expect(worlds, "the built world must be on the creator's shelf").toHaveLength(1);
  return worlds[0]!;
}

/** A world live in Explore: built, submitted, approved by a person. */
async function aLiveWorld(request: APIRequestContext, account: Account): Promise<StudioWorld> {
  const world = await aBuiltWorld(request, account);
  await unwrap(await publish(request, account.jwt, world.id, "public"), "publish public");
  await unwrap(await review(request, world.id, "approve"), "approve");
  return world;
}

/* ---------------------------------------------------------------- cases ---- */

test.describe("World lifecycle — hostile pass", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await setLlmMode(request, "replay");
  });

  /* ---------------------------------------------------------------- QA-001 ---- */

  /**
   * The takedown is the only enforcement the shelf has after a human said yes once, and it must not
   * be undoable by the person it was aimed at. `publish` refuses a resubmit only while the world is
   * `rejected`; a world three reporters just pulled is `review` + `pulledAt`, so it walks through —
   * and `unlisted` then sets `published`, clears `pulledAt`, drops it out of the review queue and
   * puts it permanently beyond `pullWorldIfBrigaded`, which only ever pulls a `public` world.
   *
   * See qa-findings.md QA-001. The right behaviour is that a pulled world may go `private` and
   * nowhere else until a person has looked at it.
   */
  test("QA-001: a world reports pulled off the shelf cannot be republished out of the queue", async ({ request }) => {
    const author = await apiSignup(request);
    const world = await aLiveWorld(request, author);

    // Enough distinct people to take it down.
    for (let i = 0; i < WORLD_MODERATION.REPORTS_TO_PULL; i += 1) {
      const reporter = await apiSignup(request);
      await unwrap(await reportWorld(request, reporter.jwt, world.id), `report ${i}`);
    }
    const pulled = (await myWorlds(request, author.jwt))[0];
    expect(pulled?.status, "the world must be back in front of a person").toBe("review");
    expect(pulled?.pulled, "and marked as a takedown, not a fresh submission").toBe(true);
    expect((await reviewQueue(request)).total, "a pulled world is in the queue").toBe(1);

    // The creator's one move that should not work.
    const escape = await publish(request, author.jwt, world.id, "unlisted");
    expect(escape.status(), "a pulled world must not be republishable while it waits for a person").toBe(409);

    // Whatever the server answered, none of these may have changed.
    expect((await reviewQueue(request)).total, "the complaint must still be in front of a human").toBe(1);
    expect(await openReports(request), "and its reports must still be open").toBe(WORLD_MODERATION.REPORTS_TO_PULL);

    const stranger = await apiSignup(request);
    const reach = await request.get(apiUrl(`/v1/worlds/${world.id}`), {
      headers: bearer(stranger.jwt), failOnStatusCode: false,
    });
    expect(reach.status(), "a pulled world must not be readable by someone who was never in it").toBe(404);
    expect((await publicWorlds(request, stranger.jwt)).map((w) => w.id), "nor back on the shelf")
      .not.toContain(world.id);
  });

  /* ---------------------------------------------------------------- QA-002 ---- */

  /**
   * `unlisted` has exactly one distribution mechanism — the link — so the link has to work for the
   * person it is sent to. It currently points at `/studio/:id`, which only reads the creator-only
   * `GET /v1/worlds/:id/status`, so the recipient gets a 404 and "Couldn't load" while
   * `GET /v1/worlds/:id` would have served them the world quite happily.
   *
   * See qa-findings.md QA-002.
   */
  test("QA-002: the link an unlisted world lives behind opens for the person it is sent to", async ({ page, request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);
    await unwrap(await publish(request, author.jwt, world.id, "unlisted"), "publish unlisted");

    const friend = await apiSignup(request);

    /*
     * The fix was a route, not a permission: `/v1/worlds/:id/status` stays creator-only — what a
     * world is *waiting on* is the creator's business — and the share link now points at the world
     * detail, which is the endpoint that answers anyone who may play it. Asserted here rather than
     * assumed, because the original write-up guessed at the other fix.
     */
    const creatorOnly = await request.get(apiUrl(`/v1/worlds/${world.id}/status`), {
      headers: bearer(friend.jwt), failOnStatusCode: false,
    });
    expect(creatorOnly.status(), "the build screen stays the creator's").toBe(404);

    const detail = await request.get(apiUrl(`/v1/worlds/${world.id}`), {
      headers: bearer(friend.jwt), failOnStatusCode: false,
    });
    const seen = await unwrap<{ world: { creatorHandle: string | null; playCount: number } }>(
      detail, "GET /v1/worlds/:id as the recipient",
    );
    expect(seen.world.creatorHandle, "a world someone made is presented as someone's work")
      .not.toBeNull();

    await loginInBrowser(page, friend.jwt);
    // Where the share sheet's link ends up. It now points at the API's `/s/w/:id`, which is what
    // makes it unfurl (E2E-044/045); this case is about the destination, so it goes there directly.
    await gotoApp(page, `/world/${world.id}`);
    await expect(page.getByTestId(T.worldPage), "a shared world must open, not fail to load")
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.worldPlay), "and must offer the thing the link was sent for")
      .toBeVisible();
    await expect(page.getByTestId(T.worldCredit), "and say whose world it is").toBeVisible();

    // Links already sent out point at the old route; they must not become dead.
    await gotoApp(page, `/studio/${world.id}`);
    await expect(page.getByTestId(T.worldPage), "an already-shared link must keep working")
      .toBeVisible({ timeout: 20_000 });
  });

  /* --------------------------------------------------------------- QA-003a ---- */

  /**
   * SCR-048 asks "who can play?" before it takes the gems, and the answer is written onto the row —
   * but `world-build` finishes every world `ready` and never reads it, so both non-private answers
   * produce a world that is in no queue, on no shelf and behind no working link. A question the
   * product asks and then ignores is worse than not asking it.
   *
   * See qa-findings.md QA-003.
   */
  test("QA-003a: the visibility chosen when a world is created is the visibility it gets", async ({ request }) => {
    const wantsExplore = await apiSignup(request);
    const forExplore = await aBuiltWorld(request, wantsExplore, "public");
    expect(forExplore.status, "a world created for everyone belongs in the review queue").toBe("review");
    expect((await reviewQueue(request)).total, "…and a person must be asked about it").toBe(1);

    await resetDb(request);

    const wantsLink = await apiSignup(request);
    const forLink = await aBuiltWorld(request, wantsLink, "unlisted");
    expect(forLink.status, "a world created for link-sharing must actually be live").toBe("published");
    const friend = await apiSignup(request);
    const reach = await request.get(apiUrl(`/v1/worlds/${forLink.id}`), {
      headers: bearer(friend.jwt), failOnStatusCode: false,
    });
    expect(reach.status(), "…and reachable by whoever has the link").toBe(200);
  });

  /* --------------------------------------------------------------- QA-003b ---- */

  /**
   * The second half of QA-003, and the part a player actually hits: SCR-049 renders the share button
   * only when `visibility !== "public"`, so a world created as "Everyone" wears an EVERYONE badge,
   * sits in no queue, and offers no control that would put it in one. The 120 gems are spent and the
   * screen has no way forward.
   */
  test("QA-003b: a world created for everyone is never stranded without a way to publish it", async ({ page, request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author, "public");

    await loginInBrowser(page, author.jwt);
    await gotoApp(page, `/studio/${world.id}`);
    await expect(page.getByTestId(T.studioReady)).toBeVisible({ timeout: 20_000 });

    // Either it is already on its way to a person, or the screen offers the button that sends it.
    const queued = world.status === "review";
    if (!queued) {
      await expect(
        page.getByTestId(T.studioPublish),
        "a world that says EVERYONE and is in no queue must still offer a way to get there",
      ).toBeVisible();
    }
  });

  /* ---------------------------------------------------------------- QA-004 ---- */

  /**
   * E2E-035 pins the cooldown against the direct resubmit. It is not pinned against the two-step:
   * `publish private` rewrites `status` to `ready` and leaves `reviewedAt` alone, and the cooldown
   * only looks at `status === "rejected"` — so the evidence it reads has been erased and the world
   * goes straight back at the queue. A reviewer's "no" has to cost the creator the cooldown however
   * they get back to the button.
   *
   * See qa-findings.md QA-004.
   */
  test("QA-004: a turned-down world cannot launder its cooldown through `private`", async ({ request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);
    await unwrap(await publish(request, author.jwt, world.id, "public"), "publish public");
    await unwrap(await review(request, world.id, "reject", "Reads as an existing show with the names changed."), "reject");

    // The direct path is refused, as E2E-035 already asserts.
    expect((await publish(request, author.jwt, world.id, "public")).status(), "the direct resubmit is refused").toBe(409);

    // Making it private is a legitimate thing to do; it must not also reset the clock.
    expect((await publish(request, author.jwt, world.id, "private")).status(), "keeping it private is allowed").toBe(200);

    const laundered = await publish(request, author.jwt, world.id, "public");
    expect(laundered.status(), "a round trip through `private` must not wipe the cooldown").toBe(409);
    expect((await reviewQueue(request)).total, "and the world must not be back in the queue").toBe(0);
  });

  /* ---------------------------------------------------------------- QA-005 ---- */

  /**
   * `CreateWorldReqZ` is `min(8)` on the raw string and the client trims before it counts, so ten
   * spaces is a valid 120-gem purchase on the server and a refused one in the app. The gems are the
   * point: a premise with no words in it cannot produce the world the player paid for.
   *
   * See qa-findings.md QA-005.
   */
  test("QA-005: a premise with nothing in it is refused before it costs a gem", async ({ request }) => {
    const account = await apiSignup(request);
    const before = (await wallet(request, account.jwt)).gems;
    expect(before, "a new account starts with exactly one world's worth").toBe(WORLD_STUDIO.STARTER_GEMS);

    for (const [what, premise] of [["spaces", "          "], ["newlines", "\n\n\n\n\n\n\n\n\n\n"]] as const) {
      const res = await createWorld(request, account.jwt, { premise });
      expect(res.status(), `a premise of ${what} is not a premise`).toBe(400);
    }

    expect((await wallet(request, account.jwt)).gems, "and none of it may cost anything").toBe(before);
    expect(await myWorlds(request, account.jwt), "nor leave a row behind").toHaveLength(0);
  });

  /* ---------------------------------------------------------------- QA-006 ---- */

  /**
   * Explore's `load()` returns early without a persona, so `trending` stays `null` and the empty
   * card — gated on `trending && topics.length === 0` — never renders. "Trending now" is then a
   * heading over nothing, which reads as a broken page rather than an empty one. Every account
   * between sign-up and entering a world sees it, including the stranger E2E-031 sends to /explore.
   *
   * See qa-findings.md QA-006.
   */
  test("QA-006: Explore says something under every heading, even with no persona yet", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);
    await gotoApp(page, "/explore");

    const trending = page.getByTestId(T.trendingList);
    await expect(trending, "the trending section must render").toBeVisible({ timeout: 15_000 });
    await expect(trending, "a heading with nothing under it reads as a failure, not as empty")
      .toHaveText(/\S/);
  });

  /* ------------------------------------------------- guards on what is sound ---- */

  /**
   * These passed on the hostile pass and are here so they keep passing. Both are the kind of thing
   * that breaks quietly during a refactor: an id that stops being a 404 and starts being a 403 is a
   * new existence oracle, and a gem guard that moves out of the WHERE clause is a free world.
   */

  test("QA-007: someone else's world answers 404 to every guess, signed in or not", async ({ request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);

    for (const path of [`/v1/worlds/${world.id}`, `/v1/worlds/${world.id}/status`, "/v1/worlds/public", "/v1/worlds/mine"]) {
      const res = await request.get(apiUrl(path), { failOnStatusCode: false });
      expect(res.status(), `anonymous GET ${path}`).toBe(401);
    }
    const anonPublish = await request.post(apiUrl(`/v1/worlds/${world.id}/publish`), {
      data: { visibility: "public" }, failOnStatusCode: false,
    });
    expect(anonPublish.status(), "anonymous publish").toBe(401);

    // Signed in, but not theirs: 404 rather than 403, so a guessed id is never confirmed to exist.
    const stranger = await apiSignup(request);
    expect((await publish(request, stranger.jwt, world.id, "public")).status(),
      "publishing someone else's world must not confirm it exists").toBe(404);
    expect((await reportWorld(request, stranger.jwt, world.id)).status(),
      "reporting must not be an existence oracle for a private world either").toBe(404);
  });

  test("QA-008: two creates racing for the last 120 gems build exactly one world", async ({ request }) => {
    const account = await apiSignup(request);
    const before = (await wallet(request, account.jwt)).gems;
    expect(before, "exactly one world's worth, so the second create has to lose").toBe(WORLD_STUDIO.GEM_COST);

    const [first, second] = await Promise.all([
      createWorld(request, account.jwt),
      createWorld(request, account.jwt),
    ]);
    const codes = [first.status(), second.status()].sort();
    expect(codes, "one create is paid for and the other is refused — never both").toEqual([201, 402]);

    expect((await wallet(request, account.jwt)).gems, "the wallet cannot go below zero or be charged twice").toBe(0);
    expect(await myWorlds(request, account.jwt), "and exactly one world exists").toHaveLength(1);
  });

  test("QA-009: the build screen stops asking once the world has stopped moving", async ({ page, request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);

    let polls = 0;
    page.on("request", (r) => {
      if (r.url().includes(`/v1/worlds/${world.id}/status`)) polls += 1;
    });

    await loginInBrowser(page, author.jwt);
    await gotoApp(page, `/studio/${world.id}`);
    await expect(page.getByTestId(T.studioReady)).toBeVisible({ timeout: 20_000 });
    const atReady = polls;

    // A finished world is not a moving one: the timer must be off, not merely slow.
    await page.waitForTimeout(6_000);
    expect(polls, "a finished world must not be polled again").toBe(atReady);

    // …and leaving the screen must not leave a fetch loop behind it.
    await gotoApp(page, "/studio/worlds");
    const atLeave = polls;
    await page.waitForTimeout(5_000);
    expect(polls, "no screen may keep fetching after the player has left it").toBe(atLeave);
  });
});
