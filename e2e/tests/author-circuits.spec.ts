import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { T, WORLD_STUDIO } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, gotoApp, loginInBrowser, resetDb, ROUTES, setLlmMode,
  unwrap, worldPresets, type Account,
} from "../fixtures";

/**
 * E2E-036..041 — the four circuits that decide whether "worlds have authors" is a feature or a
 * slogan (`pipeline/status/gtm.md` §"勝ち筋 A の設計要件").
 *
 * A world with a creator column in the database is not authored. It is authored when the person
 * who made it gets told somebody played it (①), when the credit is a place another player can go
 * (②), when a world nobody has played yet can still reach its first ten players (③), and when
 * playing one is a way into making one (④). Each case here is one of those, asserted end to end
 * rather than at the API, because every one of them is a claim about what a player sees.
 *
 * **Circuit ③'s populated case is deliberately not here.** The fresh rail only appears once there
 * are enough public worlds for a ranking to bury anything (`WORLD_FRESH_MIN_SHELF`, 12), and
 * twelve worlds is 1,440 gems against a daily cap of three — unreachable over the public API,
 * which is the surface this suite is allowed to use. The populated behaviour is pinned in
 * `apps/api/test/author-circuits.test.ts`; what is asserted here is the half a player can reach:
 * the rail is absent rather than empty when there is nothing to be buried under.
 */

const PREMISE = "Two ramen stalls, one street corner, and a food critic nobody can identify";
const REMIX_PREMISE = "The same corner, ten years later, and only one stall is left";
const GENRE = "slice_of_life";

interface StudioWorld {
  id: string; slug: string; title: string; status: string; visibility: string;
  playCount: number; creatorHandle: string | null; remixCount: number;
}

/* --------------------------------------------------------------- helpers ---- */

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

async function creatorHandleOf(request: APIRequestContext, jwt: string): Promise<string> {
  const res = await request.get(apiUrl("/v1/me"), { headers: bearer(jwt), failOnStatusCode: false });
  const me = await unwrap<{ user: { creatorHandle: string } }>(res, "GET /v1/me");
  expect(me.user.creatorHandle, "every account is credited under some name").not.toBe("");
  return me.user.creatorHandle;
}

/** A world built and published to Explore, approved by a reviewer — the state others can find. */
async function aPublicWorld(
  request: APIRequestContext, author: Account, premise = PREMISE,
): Promise<StudioWorld> {
  await unwrap(
    await request.post(apiUrl("/v1/worlds"), {
      headers: bearer(author.jwt),
      data: { premise, genre: GENRE, locale: "en", visibility: "private" },
      failOnStatusCode: false,
    }),
    "POST /v1/worlds",
  );
  await buildWorlds(request);
  const world = (await myWorlds(request, author.jwt)).find((w) => w.status === "ready");
  expect(world, "the build must finish").toBeDefined();

  await unwrap(
    await request.post(apiUrl(`/v1/worlds/${world!.id}/publish`), {
      headers: bearer(author.jwt), data: { visibility: "public" }, failOnStatusCode: false,
    }),
    "publish public",
  );
  await unwrap(
    await request.post(apiUrl(`/v1/admin/worlds/${world!.id}/review`), {
      headers: bearer(author.jwt), data: { decision: "approve", reason: "" }, failOnStatusCode: false,
    }),
    "approve",
  );
  return world!;
}

/**
 * Finish the persona flow for the world already on screen. A preset persona is fine now that a
 * handle is unique per (world, player) rather than per world — two people playing one world are
 * allowed to be the same character in their own copies of it, which is the point.
 */
async function playWorld(page: Page, slug: string): Promise<void> {
  const presets = await worldPresets(page, slug);
  expect(presets.personaHandle, "the world must offer preset personas").not.toBeNull();
  expect(presets.followerHandle, "and first followers").not.toBeNull();

  // Each screen arrives on a transition and the one beneath stays mounted, so wait for the row to
  // be there before pressing it rather than racing the animation into a "not stable" click.
  const preset = page.getByTestId(T.personaPreset(presets.personaHandle!));
  await expect(preset, "SCR-004 must offer the personas").toBeVisible({ timeout: 20_000 });
  await preset.click();
  await page.getByTestId(T.personaContinue).click();

  const follower = page.getByTestId(T.follower(presets.followerHandle!));
  await expect(follower, "SCR-006 must offer the cast").toBeVisible({ timeout: 20_000 });
  await follower.click();
  await page.getByTestId(T.enterWorld).click();
  await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 20_000 });
}

/* -------------------------------------------------------------------------- */

test.describe("The author circuits", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await setLlmMode(request, "replay");
  });

  /* ---------------------------------------------------------------- E2E-036 ---- */

  /**
   * Circuit ② — the credit has to be a *place*. A name rendered as text next to a world tells you
   * nothing you can act on; a name you can tap and find the rest of someone's work is what turns
   * one world into a body of work, and a maker into somebody worth following.
   */
  test("E2E-036: the credit on a world is a place you can go", async ({ page, request }) => {
    const author = await apiSignup(request);
    const handle = await creatorHandleOf(request, author.jwt);
    const world = await aPublicWorld(request, author);

    const visitor = await apiSignup(request);
    await loginInBrowser(page, visitor.jwt);
    await gotoApp(page, `/world/${world.id}`);

    const credit = page.getByTestId(T.worldCredit);
    await expect(credit, "a world someone made says whose it is").toBeVisible({ timeout: 20_000 });
    await expect(credit).toContainText(handle);

    await credit.click();
    await expect(page.getByTestId(T.creatorPage), "and the name leads somewhere")
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.creatorHandleText)).toContainText(handle);
    await expect(page.getByTestId(T.creatorWorld(world.slug)), "with their work on it").toBeVisible();
  });

  /* ---------------------------------------------------------------- E2E-037 ---- */

  /**
   * Circuit ③, the half a player can reach. The rail is not an empty shelf when there is nothing
   * to be buried under — an empty "Just built" heading reads as a broken page, which is the exact
   * defect QA-006 found on the trending strip.
   */
  test("E2E-037: the fresh rail is absent, not empty, on a shelf too small to bury anything", async ({ page, request }) => {
    const author = await apiSignup(request);
    await aPublicWorld(request, author);

    const visitor = await apiSignup(request);
    await loginInBrowser(page, visitor.jwt);
    await gotoApp(page, "/explore");
    await expect(page.getByTestId(T.communityWorlds), "Explore must have loaded")
      .toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId(T.freshWorlds), "no heading over nothing").toHaveCount(0);

    const shelf = await request.get(apiUrl("/v1/worlds/public"), {
      headers: bearer(visitor.jwt), failOnStatusCode: false,
    });
    const body = await unwrap<{ worlds: StudioWorld[]; fresh: StudioWorld[] }>(shelf, "GET /v1/worlds/public");
    expect(body.fresh, "and the server agrees rather than the client hiding it").toHaveLength(0);
    expect(body.worlds.length, "the world is on the ranked shelf instead").toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------- E2E-038 ---- */

  /**
   * Circuit ④ — the conversion UGC is worst at. What a remix makes cheap is the deciding: the
   * genre and the language are inherited, so the only thing left is the one line, and a player who
   * would never have opened a blank studio finds themselves in one.
   */
  test("E2E-038: a world you played is a way into making one", async ({ page, request }) => {
    const author = await apiSignup(request);
    const source = await aPublicWorld(request, author);

    const player = await apiSignup(request);
    await loginInBrowser(page, player.jwt);
    await gotoApp(page, `/world/${source.id}`);
    await expect(page.getByTestId(T.worldPage)).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(T.remixOpen).click();
    await expect(page.getByTestId(T.remixSource), "the studio says what this came out of")
      .toBeVisible({ timeout: 15_000 });
    await page.getByTestId(T.studioPremiseInput).fill(REMIX_PREMISE);
    await page.getByTestId(T.remixCreate).click();
    await expect(page.getByTestId(T.studioBuilding)).toBeVisible({ timeout: 20_000 });

    await buildWorlds(request);
    await expect(page.getByTestId(T.studioReady)).toBeVisible({ timeout: 30_000 });

    // The derivative credits what it came out of, and the source counts what came out of it.
    const mine = await myWorlds(request, player.jwt);
    expect(mine, "the remix is the player's own world").toHaveLength(1);
    const detail = await request.get(apiUrl(`/v1/worlds/${mine[0]!.id}`), {
      headers: bearer(player.jwt), failOnStatusCode: false,
    });
    const seen = await unwrap<{ world: { remixOf: { slug: string } | null; genre: string | null } }>(
      detail, "GET /v1/worlds/:id",
    );
    expect(seen.world.remixOf?.slug, "a derivative credits its source").toBe(source.slug);
    expect(seen.world.genre, "and inherits what it did not have to decide").toBe(GENRE);

    const sourceAfter = await myWorlds(request, author.jwt);
    expect(sourceAfter[0]?.remixCount, "the source counts what came out of it").toBe(1);
  });

  /* ---------------------------------------------------------------- E2E-039 ---- */

  /**
   * Circuit ② again: a name minted for you is not yours until you can change it. The thing that
   * must not break is the credit — a rename moves the label everywhere at once, because nothing
   * denormalises it.
   */
  test("E2E-039: a creator can name themselves, and their worlds follow", async ({ page, request }) => {
    const author = await apiSignup(request);
    const minted = await creatorHandleOf(request, author.jwt);
    const world = await aPublicWorld(request, author);

    await loginInBrowser(page, author.jwt);
    await gotoApp(page, `/creator/${minted}`);
    await expect(page.getByTestId(T.creatorPage)).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(T.creatorRename).click();
    const input = page.getByTestId(T.creatorRenameInput);
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill("ramenpoet");
    await page.getByTestId(T.creatorRenameSave).click();

    await expect.poll(async () => creatorHandleOf(request, author.jwt), { timeout: 20_000 })
      .toBe("ramenpoet");

    // Somebody else's view of the world carries the new name, with nothing left to migrate.
    const visitor = await apiSignup(request);
    const detail = await request.get(apiUrl(`/v1/worlds/${world.id}`), {
      headers: bearer(visitor.jwt), failOnStatusCode: false,
    });
    const seen = await unwrap<{ world: { creatorHandle: string | null } }>(detail, "GET /v1/worlds/:id");
    expect(seen.world.creatorHandle, "the credit moved with the name").toBe("ramenpoet");
  });

  /* ---------------------------------------------------------------- E2E-040 ---- */

  /**
   * Circuit ① — the return. Creation without a reaction stops, and a play count sitting in a table
   * is not a reaction. The author must be *told*, and told without ever having made a persona,
   * because the studio is reachable before anyone has.
   */
  test("E2E-040: the author is told when somebody plays their world", async ({ page, request }) => {
    const author = await apiSignup(request);
    const world = await aPublicWorld(request, author);

    // A second player walks into it. The author has never created a persona anywhere.
    const player = await apiSignup(request);
    await loginInBrowser(page, player.jwt);
    await gotoApp(page, `/world/${world.id}`);
    await expect(page.getByTestId(T.worldPage)).toBeVisible({ timeout: 20_000 });
    await page.getByTestId(T.worldPlay).click();
    await playWorld(page, world.slug);

    await loginInBrowser(page, author.jwt);
    await gotoApp(page, "/notifications");
    await expect(page.getByTestId(T.notifList), "a creator with no persona still has an inbox")
      .toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId(T.notifList),
      "and it says somebody played the world they made",
    ).toContainText(/played|遊ば/i, { timeout: 15_000 });
  });

  /* ---------------------------------------------------------------- E2E-041 ---- */

  /**
   * The global claim, asserted rather than believed: a world written in one language is playable in
   * the other the moment it exists, with nothing left in the language it was written in. A cast
   * list of Japanese names above English role lines is the tell that makes a Japanese player decide
   * the app is a translation — and it shipped once, found in a screenshot rather than by a test.
   */
  test("E2E-041: a world authored in Japanese is fully playable in English", async ({ page, request }) => {
    const author = await apiSignup(request, { locale: "ja" });
    await unwrap(
      await request.post(apiUrl("/v1/worlds"), {
        headers: bearer(author.jwt),
        data: {
          premise: "深夜のラーメン屋台が二つ、角がひとつ、そして正体不明の評論家",
          genre: GENRE, locale: "ja", visibility: "private",
        },
        failOnStatusCode: false,
      }),
      "POST /v1/worlds (ja)",
    );
    await buildWorlds(request);
    const world = (await myWorlds(request, author.jwt)).find((w) => w.status === "ready");
    expect(world, "the JA build must finish").toBeDefined();
    await unwrap(
      await request.post(apiUrl(`/v1/worlds/${world!.id}/publish`), {
        headers: bearer(author.jwt), data: { visibility: "unlisted" }, failOnStatusCode: false,
      }),
      "publish unlisted",
    );

    const reader = await apiSignup(request, { locale: "en" });
    const detail = await request.get(apiUrl(`/v1/worlds/${world!.id}`), {
      headers: bearer(reader.jwt), failOnStatusCode: false,
    });
    const seen = await unwrap<{ characters: { handle: string; role: string; intro: string }[] }>(
      detail, "GET /v1/worlds/:id as an EN reader",
    );
    expect(seen.characters.length, "the cast comes across").toBeGreaterThan(0);

    // Nothing is left in the language it was written in — roles included, which is where it leaked.
    const CJK = /[぀-ヿ一-龯]/;
    for (const ch of seen.characters) {
      expect(CJK.test(ch.role), `role for @${ch.handle} must be English, got "${ch.role}"`).toBe(false);
      expect(CJK.test(ch.intro), `intro for @${ch.handle} must be English, got "${ch.intro}"`).toBe(false);
    }

    await loginInBrowser(page, reader.jwt);
    await gotoApp(page, `/world/${world!.id}`);
    await expect(page.getByTestId(T.worldPage), "and it opens for a reader of the other language")
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.worldPlay)).toBeVisible();
  });
});
