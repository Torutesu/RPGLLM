/**
 * `/s/*` — the link people actually send each other (task 45).
 *
 * A share link has two readers and they want different things: a crawler wants `<meta>` in the
 * first response, and a person wants the app. Everything shareable in this product pointed at the
 * Expo web bundle, which serves neither — a crawler gets an empty root div, so every reel, world
 * and creator link posted anywhere previewed as a naked URL. `services/share-page.ts` explains the
 * shape of the answer; this file decides *what may be answered about*, which is the part with
 * teeth:
 *
 *   - a **world** must be `published` and `public` or `unlisted` — the shelf's own predicate, so
 *     nothing previews that Explore would not list, and a world pulled by reports (status back to
 *     `review`) stops unfurling the moment it is pulled;
 *   - a **moment** is already a public endpoint — the share card was always its purpose;
 *   - a **creator** page shows what `/v1/creators/:handle` shows a stranger, and a deleted account
 *     is a 404 here for the same reason it is one there: a credit line survives the soft-delete
 *     window in the database and must not survive it on a page.
 *
 * Nothing here is authenticated and nothing here needs to be — every field is one an anonymous
 * caller can already read. That is deliberate: an unfurl that requires a session is not an unfurl.
 */
import { Hono } from "hono";
import { LOCALES, t, type Locale } from "@rpgllm/shared";
import { publicApiUrl, publicAppName, publicAppUrl } from "../env";
import { normHandle } from "../services/handles";
import { isLocale, localized, type LocaleKey } from "../services/locale";
import { posterPng } from "../services/share-poster";
import { renderSharePage, type SharePageInput } from "../services/share-page";
import type { AppEnv } from "../types";
import type { Context } from "hono";

/** An hour: long enough that a crawler storm is one render, short enough that a retitle lands. */
const PAGE_CACHE = "public, max-age=3600";
/** A poster is a pure function of a slug that never changes, so it can be cached until the heat death. */
const IMG_CACHE = "public, max-age=31536000, immutable";

const html = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": PAGE_CACHE } });

/**
 * A 404 here is HTML too. A crawler that gets JSON for a missing world renders the JSON, and a
 * person who follows a dead link should be told so in the language they asked in.
 */
const gone = (locale: Locale): Response =>
  new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>404</title></head><body></body></html>`,
    { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const png = (body: Buffer): Response =>
  new Response(new Uint8Array(body), {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": IMG_CACHE, "content-length": String(body.length) },
  });

/**
 * Which language to answer in. `?lang=` wins because it is the only signal a *sharer* controls —
 * the app appends the locale the world was played in, so a link sent by a Japanese player unfurls
 * in Japanese in a Japanese group chat. Otherwise `Accept-Language`, which crawlers mostly do not
 * send, and then `en`.
 */
function localeOf(c: Context<AppEnv>): LocaleKey {
  const q = c.req.query("lang");
  if (isLocale(q)) return q;
  const header = (c.req.header("accept-language") ?? "").toLowerCase();
  for (const part of header.split(",")) {
    const tag = (part.split(";")[0] ?? "").trim();
    const base = tag.split("-")[0] ?? "";
    if ((LOCALES as readonly string[]).includes(base)) return base as LocaleKey;
  }
  return "en";
}

/**
 * This service's own origin. Derived from the request so dev, Playwright and a laptop on a LAN all
 * work untouched; `PUBLIC_API_URL` overrides it for the one case the request cannot know about — a
 * proxy that terminates TLS and rewrites the host, where a self-derived `og:image` would point at
 * an internal name no crawler can resolve.
 */
function selfOrigin(c: Context<AppEnv>): string {
  const configured = publicApiUrl();
  if (configured) return configured;
  try {
    return new URL(c.req.url).origin;
  } catch {
    return "";
  }
}

/**
 * The "@". The API emits handles bare because clients draw the sigil (`services/handles.ts`), and
 * this page *is* the client for this one surface — so it draws it here rather than shipping
 * "by rina" into a link preview.
 */
const mention = (handle: string): string => `@${normHandle(handle)}`;

const withLang = (url: string, locale: LocaleKey): string => `${url}?lang=${locale}`;

export function shareRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** A world, if the shelf would show it to a stranger. */
  app.get("/w/:idOrSlug", async (c) => {
    const deps = c.get("deps");
    const locale = localeOf(c);
    const key = c.req.param("idOrSlug");
    const world = await deps.prisma.world.findFirst({ where: { OR: [{ id: key }, { slug: key }] } });
    if (!world || world.status !== "published" || world.visibility === "private") return gone(locale);

    const creator = world.createdBy
      ? await deps.prisma.user.findUnique({ where: { id: world.createdBy }, select: { creatorHandle: true, deletedAt: true } })
      : null;
    const credit = creator && creator.deletedAt === null && creator.creatorHandle
      ? `${t(locale, "shareBy")} ${mention(creator.creatorHandle)}`
      : "";

    const origin = selfOrigin(c);
    const page: SharePageInput = {
      locale,
      title: localized(world.title, locale),
      description: localized(world.scenario, locale),
      kicker: t(locale, "shareWorldKicker"),
      facts: [
        credit,
        world.playCount > 0 ? `${world.playCount} ${t(locale, "studioPlays")}` : "",
        world.visibility === "unlisted" ? t(locale, "shareUnlisted") : "",
      ],
      imageUrl: `${origin}/s/w/${encodeURIComponent(world.slug)}/poster.png`,
      canonicalUrl: withLang(`${origin}/s/w/${encodeURIComponent(world.slug)}`, locale),
      appUrl: `${publicAppUrl()}/world/${encodeURIComponent(world.id)}`,
      ogType: "article",
      // An unlisted world is previewable by whoever holds the link and indexable by nobody: the
      // link is its distribution, a search result is a shelf it was deliberately kept off.
      indexable: world.visibility === "public",
    };
    return html(renderSharePage(page, publicAppName()));
  });

  /** A moment — the reel's still. Public since it was built; this is the card around it. */
  app.get("/m/:slug", async (c) => {
    const deps = c.get("deps");
    const locale = localeOf(c);
    const moment = await deps.prisma.moment.findUnique({
      where: { shareSlug: c.req.param("slug") },
      include: { persona: { include: { world: true } } },
    });
    if (!moment) return gone(locale);

    const world = moment.persona.world;
    const origin = selfOrigin(c);
    const page: SharePageInput = {
      locale,
      title: moment.headline,
      description: moment.body,
      kicker: t(locale, "shareMomentKicker"),
      facts: [localized(world.title, locale), mention(moment.persona.handle)],
      /**
       * The moment's *own* poster route, even though the art is seeded by the world. Pointing at
       * `/s/w/:slug/poster.png` would have been one route fewer and an `og:image` that 404s for
       * every moment that happened in a world its creator kept private — which is most of them
       * early on, and the failure mode nobody sees because the page itself looks perfect.
       */
      imageUrl: `${origin}/s/m/${encodeURIComponent(moment.shareSlug)}/poster.png`,
      canonicalUrl: withLang(`${origin}/s/m/${encodeURIComponent(moment.shareSlug)}`, locale),
      appUrl: `${publicAppUrl()}/moment/${encodeURIComponent(moment.shareSlug)}`,
      ogType: "article",
      indexable: true,
    };
    return html(renderSharePage(page, publicAppName()));
  });

  /**
   * A creator (勝ち筋 A ②). The whole point of authorship is that a credit is a place you can go,
   * and a place you can go has to survive being pasted into a group chat.
   */
  app.get("/c/:handle", async (c) => {
    const deps = c.get("deps");
    const locale = localeOf(c);
    const handle = normHandle(c.req.param("handle"));
    const creator = await deps.prisma.user.findUnique({ where: { creatorHandle: handle } });
    if (!creator || creator.deletedAt !== null || !creator.creatorHandle) return gone(locale);

    const shelf = { createdBy: creator.id, status: "published", visibility: "public" } as const;
    const [totals, newest] = await Promise.all([
      deps.prisma.world.aggregate({ where: shelf, _count: { _all: true }, _sum: { playCount: true } }),
      deps.prisma.world.findMany({ where: shelf, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 3 }),
    ]);
    const worlds = totals._count._all;
    const plays = totals._sum.playCount ?? 0;
    const origin = selfOrigin(c);
    const page: SharePageInput = {
      locale,
      title: mention(creator.creatorHandle),
      // Their work is the description: three titles say more about a creator than any number does.
      description: worlds > 0
        ? newest.map((w) => localized(w.title, locale)).filter((s) => s.length > 0).join(" · ")
        : t(locale, "creatorNoWorlds"),
      kicker: t(locale, "shareCreatorKicker"),
      facts: [
        `${worlds} ${t(locale, "shareCreatorWorlds")}`,
        plays > 0 ? `${plays} ${t(locale, "studioPlays")}` : "",
      ],
      imageUrl: `${origin}/s/c/${encodeURIComponent(creator.creatorHandle)}/poster.png`,
      canonicalUrl: withLang(`${origin}/s/c/${encodeURIComponent(creator.creatorHandle)}`, locale),
      appUrl: `${publicAppUrl()}/creator/${encodeURIComponent(creator.creatorHandle)}`,
      ogType: "profile",
      indexable: true,
    };
    return html(renderSharePage(page, publicAppName()));
  });

  /**
   * The posters. Both routes resolve the row **before** painting, and that is a security decision
   * rather than a tidiness one: painting is ~100 ms of CPU, so a poster route that drew whatever
   * seed it was handed would let one anonymous request line take the process down. Behind a lookup,
   * the only seeds that cost anything are the ones that already exist.
   */
  app.get("/w/:slug/poster.png", async (c) => {
    const deps = c.get("deps");
    const slug = c.req.param("slug");
    const world = await deps.prisma.world.findUnique({ where: { slug }, select: { status: true, visibility: true } });
    if (!world || world.status !== "published" || world.visibility === "private") return gone("en");
    return png(posterPng(slug));
  });

  /**
   * A moment's poster. Gated on the moment, which is public by design — the same row that lets
   * `/v1/moments/:slug` and the reel answer a stranger. The seed is still the world, so the card,
   * the reel and the world all carry one picture.
   */
  app.get("/m/:slug/poster.png", async (c) => {
    const deps = c.get("deps");
    const moment = await deps.prisma.moment.findUnique({
      where: { shareSlug: c.req.param("slug") },
      select: { persona: { select: { world: { select: { slug: true } } } } },
    });
    if (!moment) return gone("en");
    return png(posterPng(moment.persona.world.slug));
  });

  app.get("/c/:handle/poster.png", async (c) => {
    const deps = c.get("deps");
    const handle = normHandle(c.req.param("handle"));
    const creator = await deps.prisma.user.findUnique({ where: { creatorHandle: handle }, select: { deletedAt: true } });
    if (!creator || creator.deletedAt !== null) return gone("en");
    return png(posterPng(handle));
  });

  return app;
}
