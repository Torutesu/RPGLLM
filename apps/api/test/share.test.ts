import { inflateSync } from "node:zlib";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

/**
 * `/s/*` — what a link previews as (task 45).
 *
 * Two things are being checked and they fail in opposite directions. The meta tags are the
 * *product*: a page that renders beautifully and omits `og:image` is a link that unfurls as a bare
 * URL, and nothing in a browser would ever tell you. The visibility rules are the *risk*: this is
 * the first unauthenticated HTML surface in the service, so every case that must 404 has a case.
 */

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});

beforeEach(async () => {
  await resetDatabase();
});

const get = async (path: string, headers: Record<string, string> = {}): Promise<Response> =>
  await h.app.request(path, { headers });

const text = async (path: string, headers: Record<string, string> = {}): Promise<string> =>
  await (await get(path, headers)).text();

/** `content` of a `<meta>` by its name/property, un-escaped enough to compare. */
function metaOf(html: string, key: string): string | null {
  const m = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html);
  return m
    ? (m[1] as string)
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
    : null;
}

/**
 * Decode enough of a PNG to prove it is one: signature, IHDR, and an IDAT that inflates to exactly
 * `(3w + 1) × h` filtered bytes. Asserting `content-type` alone would pass on any buffer at all.
 */
function readPng(buf: Buffer): { width: number; height: number; rawBytes: number } {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(buf[24]).toBe(8); // bit depth
  expect(buf[25]).toBe(2); // truecolour RGB
  let at = 8;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString("ascii");
    if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  expect(idat.length).toBeGreaterThan(0);
  return { width, height, rawBytes: inflateSync(Buffer.concat(idat)).length };
}

async function publicWorld(fields: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const world = await prisma.world.findFirstOrThrow({ where: { slug: "popstar-era" } });
  return await prisma.world.update({
    where: { id: world.id },
    data: { status: "published", visibility: "public", ...fields },
    select: { id: true, slug: true },
  });
}

/** A second world with a slug of its own — the test seed set is one world deep. */
async function secondWorld(slug: string, fields: Record<string, unknown> = {}): Promise<void> {
  await prisma.world.create({
    data: {
      slug,
      title: { en: "New Academy", ja: "新学院" },
      scenario: { en: "A school that grades you on rumour.", ja: "噂で採点される学校。" },
      bible: { en: "", ja: "" },
      bibleTokens: 0,
      status: "published",
      visibility: "public",
      ...fields,
    },
  });
}

describe("GET /s/w/:idOrSlug — a world", () => {
  it("answers a crawler with the whole card in the first response", async () => {
    const world = await publicWorld({ playCount: 12 });
    const res = await get(`/s/w/${world.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(metaOf(html, "og:title")).toBe("Popstar Era");
    expect(metaOf(html, "og:type")).toBe("article");
    expect((metaOf(html, "og:description") ?? "").length).toBeGreaterThan(10);
    // Absolute, or a crawler resolves it against its own host and fetches nothing.
    expect(metaOf(html, "og:image")).toMatch(/^https?:\/\/.+\/s\/w\/popstar-era\/poster\.png$/);
    expect(metaOf(html, "og:image:width")).toBe("1200");
    expect(metaOf(html, "og:image:height")).toBe("630");
    expect(metaOf(html, "twitter:card")).toBe("summary_large_image");
    expect(metaOf(html, "twitter:image")).toBe(metaOf(html, "og:image"));
    expect(metaOf(html, "robots")).toBe("index, follow");
    expect(html).toContain('<link rel="canonical"');
    // The person, not the crawler: one link into the app.
    expect(html).toContain('data-testid="share-open"');
    expect(html).toContain("/world/");
  });

  it("resolves by id as well as slug, because that is what the app shares", async () => {
    const world = await publicWorld();
    expect((await get(`/s/w/${world.id}`)).status).toBe(200);
  });

  it("speaks the language it is asked in", async () => {
    const world = await publicWorld();
    const ja = await text(`/s/w/${world.slug}?lang=ja`);
    expect(metaOf(ja, "og:locale")).toBe("ja_JP");
    expect(ja).toContain('<html lang="ja"');
    expect(metaOf(ja, "og:title")).not.toBe(metaOf(await text(`/s/w/${world.slug}`), "og:title"));

    // No `?lang=`: the reader's own header decides, which is all a group chat gives us.
    const header = await text(`/s/w/${world.slug}`, { "accept-language": "ja-JP,ja;q=0.9,en;q=0.8" });
    expect(metaOf(header, "og:locale")).toBe("ja_JP");
  });

  it("previews an unlisted world and refuses to let it be indexed", async () => {
    const world = await publicWorld({ visibility: "unlisted" });
    const html = await text(`/s/w/${world.slug}`);
    expect(metaOf(html, "robots")).toBe("noindex, follow");
    expect(metaOf(html, "og:title")).toBe("Popstar Era");
  });

  it.each([
    ["private", { visibility: "private" }],
    ["still generating", { status: "generating" }],
    ["waiting for review", { status: "review" }],
    ["pulled off the shelf by reports", { status: "review", pulledAt: new Date() }],
  ])("does not unfurl a world that is %s", async (_label, patch) => {
    const world = await publicWorld(patch);
    const res = await get(`/s/w/${world.slug}`);
    expect(res.status).toBe(404);
    // HTML, not JSON: a crawler renders whatever it is given, including an error body.
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain('name="robots" content="noindex"');
  });

  it("escapes what a creator wrote, in the attribute and in the body", async () => {
    const world = await publicWorld({
      title: { en: `Popstar" /><script>alert(1)</script>`, ja: "ポップスター" },
    });
    const html = await text(`/s/w/${world.slug}`);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    // The quote that would have closed the attribute early is gone from every meta tag.
    expect(metaOf(html, "og:title")).toContain(`Popstar" /><script>`);
  });

  it("credits the creator and counts the plays", async () => {
    const { userId } = await signup(h);
    await prisma.user.update({ where: { id: userId }, data: { creatorHandle: "rina" } });
    const world = await publicWorld({ createdBy: userId, isPreset: false, playCount: 41 });
    const html = await text(`/s/w/${world.slug}`);
    expect(html).toContain("@rina");
    expect(html).toContain("41");
  });
});

describe("GET /s/m/:slug — a moment", () => {
  it("unfurls with the headline as the title", async () => {
    const p = await signupWithPersona(h);
    const moment = await prisma.moment.create({
      data: {
        personaId: p.personaId,
        cause: "post:none",
        headline: "The room turned on you",
        body: "Three of them stopped replying at once.",
        payload: {},
        shareSlug: "abc12345",
      },
    });
    const html = await text(`/s/m/${moment.shareSlug}`);
    expect(metaOf(html, "og:title")).toBe("The room turned on you");
    expect(metaOf(html, "og:description")).toContain("stopped replying");
    expect(metaOf(html, "og:image")).toContain("/s/m/abc12345/poster.png");
    expect(html).toContain("/moment/abc12345");
  });

  /**
   * The reason a moment has a poster route of its own. A moment is public; the world it happened in
   * usually is not, especially early — and an `og:image` gated on the *world* would 404 on almost
   * every real share while the page around it looked perfect.
   */
  it("keeps its image when the world it happened in is private", async () => {
    const p = await signupWithPersona(h);
    await prisma.world.update({ where: { id: p.worldId }, data: { visibility: "private", status: "ready" } });
    const moment = await prisma.moment.create({
      data: {
        personaId: p.personaId,
        cause: "post:none",
        headline: "Quiet room",
        body: "Nobody replied.",
        payload: {},
        shareSlug: "priv1234",
      },
    });

    const html = await text(`/s/m/${moment.shareSlug}`);
    const image = metaOf(html, "og:image") as string;
    const res = await get(new URL(image).pathname);
    expect(res.status, "a public moment's card must have a picture that exists").toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    // And the world's own page is still private, which is the whole point of the split.
    expect(
      (await get(`/s/w/${(await prisma.world.findUniqueOrThrow({ where: { id: p.worldId } })).slug}`)).status,
    ).toBe(404);
  });

  it("404s a slug that is not a moment", async () => {
    expect((await get("/s/m/nope")).status).toBe(404);
  });
});

describe("GET /s/c/:handle — a creator", () => {
  it("lists what a stranger may see and nothing else", async () => {
    const { userId } = await signup(h);
    await prisma.user.update({ where: { id: userId }, data: { creatorHandle: "rina" } });
    await publicWorld({ createdBy: userId, isPreset: false, playCount: 7 });
    // A private world of theirs is not on the profile, so it is not in the preview either.
    await secondWorld("their-secret-academy", { createdBy: userId, visibility: "private", status: "ready" });

    const html = await text("/s/c/rina");
    expect(metaOf(html, "og:type")).toBe("profile");
    expect(metaOf(html, "og:title")).toBe("@rina");
    expect(metaOf(html, "og:description")).toContain("Popstar Era");
    expect(metaOf(html, "og:description")).not.toContain("New Academy");
    expect(html).toContain("7");
  });

  it("accepts @rina and RINA, and 404s a deleted account", async () => {
    const { userId } = await signup(h);
    await prisma.user.update({ where: { id: userId }, data: { creatorHandle: "rina" } });
    expect((await get("/s/c/@rina")).status).toBe(200);
    expect((await get("/s/c/RINA")).status).toBe(200);

    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    expect((await get("/s/c/rina")).status).toBe(404);
  });
});

describe("the poster", () => {
  it("is a real 1200×630 PNG", async () => {
    const world = await publicWorld();
    const res = await get(`/s/w/${world.slug}/poster.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");

    const png = Buffer.from(await res.arrayBuffer());
    const { width, height, rawBytes } = readPng(png);
    expect(width).toBe(1200);
    expect(height).toBe(630);
    expect(rawBytes).toBe((1200 * 3 + 1) * 630);
    // The `Up` filter plus deflate is the whole reason this is servable: a megabyte of og:image is
    // an image half the crawlers give up on.
    expect(png.length).toBeLessThan(600_000);
  });

  it("is the same picture every time, and a different one per world", async () => {
    await publicWorld();
    await secondWorld("magic-academy");

    const a1 = Buffer.from(await (await get("/s/w/popstar-era/poster.png")).arrayBuffer());
    const a2 = Buffer.from(await (await get("/s/w/popstar-era/poster.png")).arrayBuffer());
    const b = Buffer.from(await (await get("/s/w/magic-academy/poster.png")).arrayBuffer());
    expect(a1.equals(a2)).toBe(true);
    expect(a1.equals(b)).toBe(false);
  });

  it("will not paint for a world nobody may see", async () => {
    const world = await publicWorld({ visibility: "private" });
    expect((await get(`/s/w/${world.slug}/poster.png`)).status).toBe(404);
  });
});
