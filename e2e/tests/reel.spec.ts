import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PACING, T, strings } from "@rpgllm/shared";
import {
  apiUrl,
  bearer,
  browserToken,
  dismissStatCard,
  gotoApp,
  postAndSettle,
  resetDb,
  setEnergy,
  setLlmMode,
  signupAndEnter,
  unwrap,
  type Account,
} from "../fixtures";

/**
 * E2E-042 — the reel (`pipeline/status/gtm.md` §4).
 *
 * Sharing was a still card, and a screenshot of a drama beat has already spoiled the only good part
 * of it. This is the surface Phase 2 runs through, so the two things worth asserting are the two
 * that would fail silently: the timeline the server cut is really what the client animates, and the
 * recorder really produces a file. **A recorder that writes zero bytes passes every test that only
 * checks that a button was clicked**, so this one reads the size back.
 */

const MOMENT_TEXT = "the demo leaked and the label is pretending it didn't";

interface Moment {
  shareSlug: string;
}
interface Reel {
  slug: string;
  durationMs: number;
  personaHandle: string;
  beats: { kind: string; at: number; holdMs: number; text: string; delta: unknown }[];
}

async function reelOf(request: APIRequestContext, slug: string): Promise<Reel> {
  // No bearer on purpose: a reel nobody can open without an account is not a growth surface.
  const res = await request.get(apiUrl(`/v1/moments/${slug}/reel`), { failOnStatusCode: false });
  return unwrap<Reel>(res, `GET /v1/moments/${slug}/reel`);
}

/**
 * Drive the world to a moment. A post only makes one when the swing is big enough, which replay
 * does not promise — but an **event** choice always qualifies (`services/moment.ts`: every
 * `event:` snapshot is moment-worthy), and an event is pinned after `PACING.EVENT_EVERY` actions.
 * So this walks the guaranteed path rather than posting hopefully.
 */
async function aMoment(page: Page, request: APIRequestContext, account: Account): Promise<string> {
  for (let i = 0; i < PACING.EVENT_EVERY; i += 1) {
    await postAndSettle(page, `${MOMENT_TEXT} (${i})`);
  }
  const banner = page.getByTestId(T.eventBanner);
  await expect(banner, "an event must be pinned after the pacing interval").toBeVisible({ timeout: 25_000 });
  await banner.click();
  await expect(page.getByTestId(T.eventCard)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.eventChoice(1)).click();
  await dismissStatCard(page);

  const jwt = (await browserToken(page)) ?? account.jwt;
  const personaId = (
    await unwrap<{ persona: { id: string } | null }>(
      await request.get(apiUrl("/v1/me"), { headers: bearer(jwt), failOnStatusCode: false }),
      "GET /v1/me",
    )
  ).persona?.id;
  const list = await unwrap<{ moments: Moment[] }>(
    await request.get(apiUrl(`/v1/moments?personaId=${personaId}`), { headers: bearer(jwt), failOnStatusCode: false }),
    "GET /v1/moments",
  );
  expect(list.moments.length, "an event outcome is always worth a card").toBeGreaterThan(0);
  return list.moments[0]!.shareSlug;
}

test.describe("The reel", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await setLlmMode(request, "replay");
  });

  test("E2E-042: a moment becomes a nine-second reel, and the reel becomes a file", async ({ page, request }) => {
    const account = await signupAndEnter(page, request);
    await setEnergy(request, account.jwt, 20);
    await page.reload();
    await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 20_000 });

    const slug = await aMoment(page, request, account);

    /* ---- the cut is the server's, and it is the same cut twice ---- */
    const reel = await reelOf(request, slug);
    const again = await reelOf(request, slug);
    expect(again, "a recording is a contract with the timeline that produced it").toEqual(reel);

    expect(reel.durationMs, "long enough to read, over before a thumb moves").toBeGreaterThan(3_000);
    expect(reel.durationMs).toBeLessThanOrEqual(9_800);
    expect(reel.beats.length).toBeGreaterThan(2);
    // The numbers are the punchline, so nothing comes after them except the headline and the sign-off.
    const statAt = reel.beats.findIndex((b) => b.kind === "stat");
    expect(statAt, "the reel has a turn").toBeGreaterThan(0);
    expect(
      reel.beats.slice(statAt + 1).every((b) => b.kind === "headline" || b.kind === "outro"),
      "nothing upstages the stat once it has landed",
    ).toBe(true);

    /* ---- the client animates that cut, and can record it ---- */
    await gotoApp(page, `/moment/${slug}`);
    const panel = page.getByTestId(T.momentReel);
    await expect(panel, "the moment offers a video, not only a card").toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.momentReelPlay)).toBeVisible();

    const record = page.getByTestId(T.momentReelRecord);
    await expect(record, "Chromium can record, so the button must be offered").toBeVisible();
    await record.click();
    await expect(page.getByTestId(T.momentReelProgress), "recording says it is recording").toBeVisible({
      timeout: 10_000,
    });

    // The reel records in real time, so this waits out its own duration plus the lead-in and tail.
    const ready = page.getByTestId(T.momentReelDownload);
    await expect(ready, "a file, not a spinner that stopped").toBeVisible({ timeout: 60_000 });

    // The size is the assertion. A recorder that writes nothing passes a click test.
    await expect(panel, "the file is real — an empty recording would still have rendered this row").toContainText(
      new RegExp(`${strings.en.reelReady}.*\\d`),
      { timeout: 10_000 },
    );

    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), ready.click()]);
    expect(download.suggestedFilename(), "a video, named for what it is").toMatch(/\.(mp4|webm)$/);
  });

  test("E2E-043: where recording is impossible, the card still shares", async ({ page, request }) => {
    // Some devices and browsers have no MediaRecorder at all. A dead button is worse than none.
    await page.addInitScript(() => {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, "MediaRecorder");
    });

    const account = await signupAndEnter(page, request);
    await setEnergy(request, account.jwt, 20);
    await page.reload();
    await expect(page.getByTestId(T.feedList)).toBeVisible({ timeout: 20_000 });
    const slug = await aMoment(page, request, account);

    await gotoApp(page, `/moment/${slug}`);
    await expect(page.getByTestId(T.momentReel)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.momentReelUnsupported), "it says so rather than failing silently").toBeVisible();
    await expect(page.getByTestId(T.momentReelRecord), "and offers no button that cannot work").toHaveCount(0);
    await expect(page.getByTestId(T.momentReelPlay), "the animation still plays").toBeVisible();
    await expect(page.getByTestId(T.momentShare), "and the card it came from still shares").toBeVisible();
  });
});
