/**
 * The creator, as a place you can go (gtm.md 勝ち筋 A ②).
 *
 * A credit that is only a string is not authorship. `@rina` under a world card tells you a person
 * exists and gives you nowhere to go with that, so nothing accumulates: no second world of theirs
 * is ever found, no follow is possible, and the author gets none of the recognition that is the
 * entire reason anybody writes a second world. **クレジットは表示ではなくリンク** — this is the
 * page the link points at.
 *
 * One rule decides everything else here: **this surface shows a creator's public work and nothing
 * else.** Their drafts, their private worlds, the one a reviewer rejected, the one still building
 * — none of it appears, and that is true even when the caller *is* the creator. A profile that
 * shows you more of yourself than it shows anyone else is a profile nobody can trust to be what
 * others see, and the creator already has that surface: `GET /v1/worlds/mine`. `isYou` exists so
 * the client can offer the rename, not so the page can change what it lists.
 */
import { Hono } from "hono";
import { requireAuth } from "../auth";
import { notFound, ok } from "../http";
import { normHandle } from "../services/handles";
import type { LocaleKey } from "../services/locale";
import { decorate } from "../services/world-studio";
import { trustForOne } from "../services/creator-trust";
import type { AppEnv } from "../types";

/** Worlds on one profile page. A creator with more than this has other problems worth having. */
const PROFILE_WORLDS = 50;

export function creatorRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * `GET /v1/creators/:handle` — accepts `rina` or `@rina`, any case. Creator handles are stored
   * normalised, so `normHandle` plus the `@unique` index is the whole case-insensitive lookup.
   *
   * A deleted account is a 404 even before the purge job runs: the credit line survives 30 days of
   * soft deletion in the database, and it must not survive on a page.
   */
  app.get("/:handle", requireAuth, async (c) => {
    const deps = c.get("deps");
    const viewer = c.get("user");
    const locale = viewer.locale as LocaleKey;
    const handle = normHandle(c.req.param("handle"));

    const creator = await deps.prisma.user.findUnique({ where: { creatorHandle: handle } });
    if (!creator || creator.deletedAt !== null) return notFound("Creator");

    // The shelf's definition of public, exactly — one predicate, so a world can never be listed
    // here that Explore would not list.
    const isYou = creator.id === viewer.id;
    const shelf = { createdBy: creator.id, status: "published", visibility: "public" } as const;
    const [worlds, totals, trust] = await Promise.all([
      deps.prisma.world.findMany({
        where: shelf,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PROFILE_WORLDS,
      }),
      // Counted over the same set the list is drawn from: a "total plays" that included private
      // drafts would leak how much unpublished work someone has, and would not add up to the
      // numbers on the cards below it.
      deps.prisma.world.aggregate({ where: shelf, _count: { _all: true }, _sum: { playCount: true } }),
      /**
       * **Trust is the creator's own business** (gtm.md §2 exit 2). It is resolved only when the
       * caller is the creator, so it cannot leak through a serialisation mistake later: a public
       * badge saying "this person's worlds go live unread" is a shopping list for anyone looking
       * for an account to buy, borrow or pressure. The reviewer sees it on the queue card, where
       * it is admin-gated; nobody else ever does.
       */
      isYou ? trustForOne(deps.prisma, creator.id) : Promise.resolve(null),
    ]);

    return ok({
      handle: creator.creatorHandle,
      isYou,
      trust,
      worldCount: totals._count._all,
      totalPlays: totals._sum.playCount ?? 0,
      joinedAt: creator.createdAt.toISOString(),
      worlds: await decorate(deps.prisma, worlds, locale, viewer.id),
    });
  });

  return app;
}
