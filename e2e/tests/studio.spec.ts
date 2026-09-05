import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { T, WORLD_STUDIO } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, gotoApp, loginInBrowser, resetDb, ROUTES, setLlmMode,
  unwrap, wallet, worldPresets, type Account,
} from "../fixtures";

/**
 * E2E-029..033 — World Studio (SCR-048/049/050).
 *
 * The feature this suite protects is the one that turns three hand-authored worlds into a place
 * people build things in, so the cases are deliberately about consequences rather than pixels:
 * a world someone typed is really playable, a refused premise really costs nothing, "everyone"
 * really waits for a person, someone else's private world really does not exist, and a build that
 * dies really gives the gems back.
 *
 * Gems are not seeded by a test hook on purpose: a new account starts with exactly
 * `WORLD_STUDIO.STARTER_GEMS`, which is exactly one world. That is the real first-run economy, so
 * the cases spend it the way a first-time player would.
 */

const PREMISE = "Seven trainees, one debut slot, and a group chat that leaked";
const GENRE = "idol";

interface StudioWorld {
  id: string; slug: string; title: string; status: string; visibility: string;
  playCount: number; creatorHandle: string | null; reason: string | null;
}

/* --------------------------------------------------------------- helpers ---- */

/** The build is a scheduled job; there is no cron in this build, so E2E drives it explicitly. */
async function buildWorlds(request: APIRequestContext): Promise<void> {
  const res = await request.post(apiUrl("/v1/__test/run-job"), {
    data: { job: "world-build" }, failOnStatusCode: false,
  });
  await unwrap(res, "POST /v1/__test/run-job world-build");
}

async function myWorlds(request: APIRequestContext, jwt: string): Promise<StudioWorld[]> {
  const res = await request.get(apiUrl("/v1/worlds/mine"), { headers: bearer(jwt), failOnStatusCode: false });
  return (await unwrap<{ worlds: StudioWorld[] }>(res, "GET /v1/worlds/mine")).worlds;
}

async function publicWorlds(request: APIRequestContext, jwt: string): Promise<StudioWorld[]> {
  const res = await request.get(apiUrl("/v1/worlds/public"), { headers: bearer(jwt), failOnStatusCode: false });
  return (await unwrap<{ worlds: StudioWorld[] }>(res, "GET /v1/worlds/public")).worlds;
}

/** Open SCR-048 the way a player does: the last card in the world picker. */
async function openStudio(page: Page): Promise<void> {
  await gotoApp(page, ROUTES.scenario);
  const open = page.getByTestId(T.studioOpen);
  await expect(open, "the world picker must offer the studio").toBeVisible({ timeout: 15_000 });
  await open.click();
  await expect(page.getByTestId(T.studioPremiseInput)).toBeVisible({ timeout: 10_000 });
}

/** Fill SCR-048 and press go. Does not assert the outcome — each case wants a different one. */
async function submitPremise(page: Page, premise: string): Promise<void> {
  await page.getByTestId(T.studioPremiseInput).fill(premise);
  await page.getByTestId(T.studioGenre(GENRE)).click();
  await page.getByTestId(T.studioCreate).click();
}

/** SCR-048 → SCR-049 → a built world. Returns the row so a case can name its slug. */
async function buildAWorld(page: Page, request: APIRequestContext, account: Account): Promise<StudioWorld> {
  await openStudio(page);
  await submitPremise(page, PREMISE);
  await expect(page.getByTestId(T.studioBuilding), "SCR-049 must take over from the CTA")
    .toBeVisible({ timeout: 15_000 });

  await buildWorlds(request);
  await expect(page.getByTestId(T.studioReady), "the build must finish and reveal the world")
    .toBeVisible({ timeout: 30_000 });

  const worlds = await myWorlds(request, account.jwt);
  expect(worlds, "the built world must be on the creator's shelf").toHaveLength(1);
  return worlds[0]!;
}

/* ---------------------------------------------------------------- E2E-029 ---- */

test.describe("World Studio", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await setLlmMode(request, "replay");
  });

  test("E2E-029: a world built from one line is really playable", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);

    expect((await wallet(request, account.jwt)).gems, "a new account can afford exactly one world")
      .toBe(WORLD_STUDIO.STARTER_GEMS);

    const world = await buildAWorld(page, request, account);

    // The reveal is the cast, not a spinner that stopped.
    const cast = page.getByTestId(T.studioCast);
    await expect(cast).toBeVisible();
    await expect(cast.locator('[data-testid^="studio-cast-"]'))
      .toHaveCount(WORLD_STUDIO.CAST_SIZE, { timeout: 10_000 });

    expect((await wallet(request, account.jwt)).gems, "the build cost exactly one world")
      .toBe(WORLD_STUDIO.STARTER_GEMS - WORLD_STUDIO.GEM_COST);

    // Play it: a generated world goes through the same persona flow as a preset.
    await page.getByTestId(T.studioPlay).click();
    const presets = await worldPresets(page, world.slug);
    expect(presets.personaHandle, "the generated world must offer preset personas").not.toBeNull();
    expect(presets.followerHandle, "the generated world must offer first followers").not.toBeNull();

    const preset = page.getByTestId(T.personaPreset(presets.personaHandle!));
    await expect(preset, "SCR-004 must offer the generated world's personas").toBeVisible({ timeout: 15_000 });
    await preset.click();
    await page.getByTestId(T.personaContinue).click();

    const follower = page.getByTestId(T.follower(presets.followerHandle!));
    await expect(follower, "SCR-006 must offer the generated world's cast").toBeVisible({ timeout: 15_000 });
    await follower.click();
    await page.getByTestId(T.enterWorld).click();

    await expect(page.getByTestId(T.feedList), "the world someone typed must produce a live feed")
      .toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid^="post-"]').first(), "the feed must not be empty")
      .toBeVisible({ timeout: 15_000 });
  });

  /* -------------------------------------------------------------- E2E-030 ---- */

  test("E2E-030: a refused premise costs nothing", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);
    const before = (await wallet(request, account.jwt)).gems;

    await openStudio(page);
    await submitPremise(page, "A dating sim starring Taylor Swift and Elon Musk, real people");

    await expect(page.getByTestId(T.studioError), "the refusal must be said out loud on SCR-048")
      .toBeVisible({ timeout: 15_000 });
    // Still on the create screen — a refusal is not a dead end.
    await expect(page.getByTestId(T.studioPremiseInput)).toBeVisible();

    expect((await wallet(request, account.jwt)).gems, "a refused premise must not cost a gem").toBe(before);
    expect(await myWorlds(request, account.jwt), "a refused premise must not leave a row").toHaveLength(0);
  });

  /* -------------------------------------------------------------- E2E-031 ---- */

  test("E2E-031: `everyone` waits for a person", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);
    const world = await buildAWorld(page, request, account);

    await page.getByTestId(T.studioPublish).click();
    await expect(page.getByTestId(T.studioStatusBadge), "the world must say it is being read")
      .toBeVisible({ timeout: 15_000 });

    const mine = await myWorlds(request, account.jwt);
    expect(mine[0]?.status, "public publishes to a queue, never to Explore").toBe("review");

    // A second player cannot find it while it waits.
    const stranger = await apiSignup(request);
    expect(await publicWorlds(request, stranger.jwt), "a world in review is not on the shelf").toHaveLength(0);

    // A human approves it, and only then is it public.
    const decision = await request.post(apiUrl(`/v1/admin/worlds/${world.id}/review`), {
      headers: bearer(account.jwt), data: { decision: "approve", reason: "" }, failOnStatusCode: false,
    });
    await unwrap(decision, "POST /v1/admin/worlds/:id/review");

    const shelf = await publicWorlds(request, stranger.jwt);
    expect(shelf.map((w) => w.id), "an approved world reaches Explore").toContain(world.id);

    // ...and it is really there in the UI a player looks at.
    await loginInBrowser(page, stranger.jwt);
    await gotoApp(page, "/explore");
    await expect(page.getByTestId(T.communityWorldCard(world.slug)), "Explore must show the approved world")
      .toBeVisible({ timeout: 15_000 });
  });

  /* -------------------------------------------------------------- E2E-032 ---- */

  test("E2E-032: someone else's private world does not exist", async ({ page, request }) => {
    const author = await apiSignup(request);
    await loginInBrowser(page, author.jwt);
    const world = await buildAWorld(page, request, author);

    const stranger = await apiSignup(request);
    const direct = await request.get(apiUrl(`/v1/worlds/${world.id}`), {
      headers: bearer(stranger.jwt), failOnStatusCode: false,
    });
    expect(direct.status(), "knowing the id must not be enough").toBe(404);

    const status = await request.get(apiUrl(`/v1/worlds/${world.id}/status`), {
      headers: bearer(stranger.jwt), failOnStatusCode: false,
    });
    expect(status.status(), "nor must it be enough to watch it build").toBe(404);

    expect(await publicWorlds(request, stranger.jwt), "a private world is on no shelf").toHaveLength(0);

    await loginInBrowser(page, stranger.jwt);
    await gotoApp(page, ROUTES.scenario);
    await expect(page.getByTestId(T.studioOpen), "the picker must have loaded").toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(T.worldCard(world.slug)), "someone else's world is not in the picker")
      .toHaveCount(0);
  });

  /* -------------------------------------------------------------- E2E-033 ---- */

  test("E2E-033: a build that dies gives the gems back", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);
    const before = (await wallet(request, account.jwt)).gems;

    await openStudio(page);
    await submitPremise(page, PREMISE);
    await expect(page.getByTestId(T.studioBuilding)).toBeVisible({ timeout: 15_000 });

    expect((await wallet(request, account.jwt)).gems, "the charge lands before the build runs")
      .toBe(before - WORLD_STUDIO.GEM_COST);

    // The generator is gone by the time the job picks the world up.
    await setLlmMode(request, "fail");
    await buildWorlds(request);

    await expect(page.getByTestId(T.studioFailed), "a dead build must say so, not spin forever")
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(T.studioRetry), "and must offer another go").toBeVisible();

    expect((await wallet(request, account.jwt)).gems, "a failed build is not a purchase").toBe(before);

    // Refunding twice would be a free world: run the job again and check the balance holds.
    await buildWorlds(request);
    expect((await wallet(request, account.jwt)).gems, "the refund happens exactly once").toBe(before);
  });
});
