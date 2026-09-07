import { expect, test, type APIRequestContext } from "@playwright/test";
import { T, WORLD_MODERATION } from "@rpgllm/shared";
import {
  apiSignup, apiUrl, bearer, loginInBrowser, resetDb, setGems, setLlmMode, unwrap, type Account,
} from "../fixtures";

/**
 * E2E-044..046 — the link, as the rest of the internet sees it.
 *
 * Everything else in this suite checks what a player sees *inside* the product. This file checks
 * the one surface that is read by machines: a shared link arrives in someone else's feed or group
 * chat, and a crawler there decides in one request whether it becomes a card or a bare blue URL.
 * That request never runs the app's JavaScript, so nothing a React screen does can be asserted
 * from it — which is precisely why it needs cases of its own.
 *
 * The bar is the one an unfurler actually applies: a title, a description, and an image that both
 * exists and is a real PNG of the size the tags claim. `og:image` pointing at a 404 is the failure
 * mode nobody notices, because the page it is on looks perfect in a browser.
 */

const PREMISE = "Seven trainees, one debut slot, and a group chat that leaked";
const GENRE = "idol";

interface StudioWorld { id: string; slug: string; title: string; status: string; visibility: string }

async function buildWorlds(request: APIRequestContext): Promise<void> {
  await unwrap(
    await request.post(apiUrl("/v1/jobs/run"), { data: { job: "world-build" }, failOnStatusCode: false }),
    "POST /v1/jobs/run world-build",
  );
}

/** A world this account built and can decide the visibility of, exactly as `studio.spec.ts` does. */
async function aBuiltWorld(request: APIRequestContext, account: Account): Promise<StudioWorld> {
  await setGems(request, account.jwt, WORLD_MODERATION.PUBLIC_SUBMIT_GEMS * 6);
  const created = await request.post(apiUrl("/v1/worlds"), {
    headers: bearer(account.jwt),
    data: { premise: PREMISE, genre: GENRE, locale: "en", visibility: "private" },
    failOnStatusCode: false,
  });
  expect(created.status(), "POST /v1/worlds").toBe(201);
  await buildWorlds(request);
  const mine = await unwrap<{ worlds: StudioWorld[] }>(
    await request.get(apiUrl("/v1/worlds/mine"), { headers: bearer(account.jwt), failOnStatusCode: false }),
    "GET /v1/worlds/mine",
  );
  return mine.worlds[0]!;
}

async function publish(
  request: APIRequestContext, jwt: string, id: string, visibility: string,
): Promise<void> {
  await unwrap(
    await request.post(apiUrl(`/v1/worlds/${id}/publish`), {
      headers: bearer(jwt), data: { visibility }, failOnStatusCode: false,
    }),
    `publish ${visibility}`,
  );
}

/** `content` of one meta tag, read the way a crawler reads it: out of the raw first response. */
function meta(html: string, key: string): string | null {
  const m = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html);
  return m ? (m[1] as string) : null;
}

test.describe("Share links", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
    await setLlmMode(request, "replay");
  });

  /* ---------------------------------------------------------------- E2E-044 ---- */

  test("E2E-044: the link the app hands out unfurls into a card", async ({ request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);
    await publish(request, author.jwt, world.id, "unlisted");

    // The URL `apps/mobile/src/studio/share.ts` builds, byte for byte.
    const res = await request.get(apiUrl(`/s/w/${world.id}`), { failOnStatusCode: false });
    expect(res.status(), "a shared link must answer a crawler").toBe(200);
    expect(res.headers()["content-type"], "with HTML, not JSON").toContain("text/html");

    const html = await res.text();
    expect(meta(html, "og:title"), "an unfurl with no title is a blue URL").toBe(world.title);
    expect((meta(html, "og:description") ?? "").length, "and one with no description is a title")
      .toBeGreaterThan(10);
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    // Unlisted is not secret and not on a shelf: previewable by whoever holds the link, indexable
    // by nobody. This is the assertion that keeps the two apart.
    expect(meta(html, "robots"), "an unlisted world must not be indexed").toBe("noindex, follow");

    const image = meta(html, "og:image");
    expect(image, "og:image").toMatch(/^https?:\/\//);
    const poster = await request.get(image as string, { failOnStatusCode: false });
    expect(poster.status(), "the image a card promises must exist").toBe(200);
    expect(poster.headers()["content-type"]).toBe("image/png");

    // A real PNG of the size the tags claim — the header is the only thing that can say so.
    const bytes = Buffer.from(await poster.body());
    expect([...bytes.subarray(0, 4)], "PNG signature").toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.readUInt32BE(16), "width").toBe(Number(meta(html, "og:image:width")));
    expect(bytes.readUInt32BE(20), "height").toBe(Number(meta(html, "og:image:height")));
  });

  /* ---------------------------------------------------------------- E2E-045 ---- */

  test("E2E-045: and a person who follows it lands in the world", async ({ page, request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);
    await publish(request, author.jwt, world.id, "unlisted");

    const friend = await apiSignup(request);
    await loginInBrowser(page, friend.jwt);

    // The share page is not the app: it is served by the API, on the API's origin.
    await page.goto(apiUrl(`/s/w/${world.id}`), { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId(T.sharePoster), "the card shows the world's own art").toBeVisible();
    await page.getByTestId(T.shareOpen).click();
    // One tap, and the recipient is in the product rather than on a landing page about it.
    await expect(page.getByTestId(T.worldPage), "the link must land in the world")
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(T.worldPlay), "offering the thing the link was sent for").toBeVisible();
  });

  /* ---------------------------------------------------------------- E2E-046 ---- */

  test("E2E-046: a world nobody may see does not unfurl", async ({ request }) => {
    const author = await apiSignup(request);
    const world = await aBuiltWorld(request, author);

    // Private, straight out of the build: never published, never shared.
    const page = await request.get(apiUrl(`/s/w/${world.id}`), { failOnStatusCode: false });
    expect(page.status(), "a private world has no public card").toBe(404);
    const poster = await request.get(apiUrl(`/s/w/${world.slug}/poster.png`), { failOnStatusCode: false });
    expect(poster.status(), "and no public art either").toBe(404);

    // A crawler renders whatever body it is handed, so even the refusal is HTML that says noindex.
    expect(page.headers()["content-type"]).toContain("text/html");
    expect(await page.text()).toContain('name="robots" content="noindex"');
  });
});
