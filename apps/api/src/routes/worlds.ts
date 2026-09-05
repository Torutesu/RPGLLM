import { Hono } from "hono";
import { Prisma, type World } from "@prisma/client";
import { CreateWorldReqZ, PublishWorldReqZ, WORLD_STUDIO, type Locale } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { worldBuildOnCreate } from "../env";
import { fail, notFound, ok, parseBody } from "../http";
import { runJobOnce } from "../jobs/registry";
import { logLine } from "../middleware/request-log";
import { loadPremiseScreen } from "../llm-loader";
import { requireActiveAccount } from "../services/account";
import { sameHandle } from "../services/handles";
import { localized, type LocaleKey } from "../services/locale";
import { safetyGate } from "../services/safety";
import { toApiCharacter, toApiWorld } from "../services/serialize";
import { ensureWallet } from "../services/wallet";
import { getWorldSeed } from "../services/world-seeds";
import {
  GemsRequiredError, buildProgress, canPlay, castCounts, creatorHandles, dailyWorldLimit, decorate,
  pickerWhere, slugifyPremise, spendGems, toApiWorldFull, uniqueSlug, worldsCreatedToday,
} from "../services/world-studio";
import { tamePremise } from "../fake-world-seed";
import type { AppEnv, Deps } from "../types";

/** A premise is one line of prose; the world's working title is its first clause. */
const titleFrom = (premise: string): string => {
  const tamed = tamePremise(premise);
  return ((tamed.split(/[,.;:—]/)[0] ?? tamed).trim() || tamed).slice(0, 60);
};

const bilingual = (text: string): Prisma.InputJsonValue => ({ en: text, ja: text });

const shortId = (): string => Math.random().toString(36).slice(2, 7);

const findWorld = (deps: Deps, id: string): Promise<World | null> =>
  deps.prisma.world.findFirst({ where: { OR: [{ id }, { slug: id }] } });

/** One world in the studio's shape, with its cast count and credited handle filled in. */
async function oneFull(deps: Deps, world: World, locale: LocaleKey, viewerId: string) {
  const [counts, handles] = await Promise.all([
    castCounts(deps.prisma, [world.id]),
    creatorHandles(deps.prisma, world.createdBy ? [world.createdBy] : []),
  ]);
  return toApiWorldFull(world, locale, viewerId, {
    castCount: counts.get(world.id) ?? 0,
    creatorHandle: world.createdBy ? (handles.get(world.createdBy) ?? null) : null,
  });
}

export function worldRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * The world picker (SCR-003). Presets, plus the caller's own finished worlds — and nothing else.
   * A private world is playable the moment it is built and is never listed to another account;
   * community worlds are `GET /v1/worlds/public`, a different question with a different answer.
   * Ordering stays `createdAt asc`, so the presets keep the order they have always had.
   */
  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const worlds = await deps.prisma.world.findMany({ where: pickerWhere(user.id), orderBy: { createdAt: "asc" } });
    return ok(worlds.map((w) => toApiWorld(w, locale)));
  });

  /* ------------------------------------------------------------ World Studio ---- */

  /**
   * SCR-048 — one line in, a world back.
   *
   * The order of the three gates is the whole safety-and-economics story: screen the premise
   * **first** (a blocked one costs nothing — no gems, no tokens, no row), then the per-UTC-day cap,
   * then the price. Only once all three pass does anything become durable, and then it all becomes
   * durable together — the debit, its ledger entry and the `World` row are one transaction, so
   * there is no state in which a player has paid for a world that does not exist.
   *
   * Generation itself is deliberately not here: see `jobs/world-build.ts`.
   */
  app.post("/", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, CreateWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const now = deps.clock.now();
    const { premise, genre, locale, visibility } = body.value;

    // 1. Safety, before a single token is spent — the premise ends up inside a system prompt.
    const screen = await loadPremiseScreen();
    const verdict = screen(premise, locale);
    if (verdict.verdict === "block") {
      logLine({ level: "warn", msg: "world.premise.blocked", userId: user.id, category: verdict.category ?? "unknown" });
      return fail("SAFETY_BLOCKED", `We can't build that one (${verdict.category ?? "policy"}).`, 422);
    }

    // 2. The daily cap, counted from `World` rows: a refunded failure still used its slot, because
    //    the cap is there to bound spend, not to guarantee three successes.
    const subscription = await deps.prisma.subscription.findUnique({ where: { userId: user.id } });
    const limit = dailyWorldLimit(subscription, now);
    const today = await worldsCreatedToday(deps.prisma, user.id, now);
    if (today >= limit) {
      const headroom = limit < WORLD_STUDIO.DAILY_LIMIT_PLUS ? ` Plus raises it to ${WORLD_STUDIO.DAILY_LIMIT_PLUS}.` : "";
      return fail("WORLD_LIMIT", `You've built ${limit} worlds today — that's the daily limit.${headroom}`, 429);
    }

    // 3. The price. Same 402 shape as running out of energy.
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    if (wallet.gems < WORLD_STUDIO.GEM_COST) {
      return fail("GEMS_REQUIRED", `Not enough gems — a world costs ${WORLD_STUDIO.GEM_COST}.`, 402);
    }

    // 4. Charge and enqueue, atomically. The slug comes from the premise so it can collide; the
    //    unique index is the arbiter, and the whole transaction (the debit included) is retried.
    const base = slugifyPremise(premise, genre);
    const title = titleFrom(premise);
    let created: { world: World; remaining: number } | null = null;
    for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
      const slug = await uniqueSlug(deps.prisma, base, shortId());
      try {
        created = await deps.prisma.$transaction(async (tx) => {
          const remaining = await spendGems(tx, wallet.id, WORLD_STUDIO.GEM_COST, `world:${slug}`);
          const world = await tx.world.create({
            data: {
              slug,
              title: bilingual(title),
              scenario: bilingual(tamePremise(premise)),
              bible: bilingual(""),
              bibleTokens: 0,
              isPreset: false,
              createdBy: user.id,
              premise,
              genre,
              genLocale: locale as Locale,
              status: "generating",
              visibility,
              createdAt: now,
            },
          });
          return { world, remaining };
        });
      } catch (err: unknown) {
        if (err instanceof GemsRequiredError) {
          return fail("GEMS_REQUIRED", `Not enough gems — a world costs ${WORLD_STUDIO.GEM_COST}.`, 402);
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    if (created === null) return fail("INTERNAL", "Could not reserve a name for that world", 500);

    // Kicking the builder here is an optimisation — somebody is watching a progress bar — never the
    // contract: the scheduler runs `world-build` every minute whether or not this fires.
    if (worldBuildOnCreate()) {
      void runJobOnce(deps, "world-build", { trigger: "create" }).catch(() => {
        /* the world stays `generating`; the next tick, or the sweep, deals with it */
      });
    }

    return ok({
      world: await oneFull(deps, created.world, user.locale as LocaleKey, user.id),
      charged: { gems: WORLD_STUDIO.GEM_COST, remaining: created.remaining },
    }, 201);
  });

  /** SCR-049 — the studio shelf, and what is left of today's allowance. */
  app.get("/mine", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const now = deps.clock.now();
    const [worlds, subscription, today] = await Promise.all([
      deps.prisma.world.findMany({ where: { createdBy: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      deps.prisma.subscription.findUnique({ where: { userId: user.id } }),
      worldsCreatedToday(deps.prisma, user.id, now),
    ]);
    return ok({
      worlds: await decorate(deps.prisma, worlds, user.locale as LocaleKey, user.id),
      remainingToday: Math.max(0, dailyWorldLimit(subscription, now) - today),
    });
  });

  /**
   * SCR-050 — worlds made by players. Published + public only.
   *
   * Ranked by plays **plus a decaying newcomer bonus**, so a world nobody has played yet still gets
   * a fortnight on the shelf; ranked on plays alone, the first popular world would be permanently
   * first and nothing new would ever be found. Paged by a keyset on `(score, id)` rather than an
   * offset, so a world published mid-paging cannot duplicate or skip a card.
   */
  app.get("/public", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const now = deps.clock.now();
    const rawLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 20;
    const cursor = decodeCursor(c.req.query("cursor"));

    const rows = await deps.prisma.$queryRaw<(World & { score: number })[]>`
      WITH ranked AS (
        SELECT w.*,
               w."playCount"
                 + GREATEST(0, 14 - FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - w."createdAt")) / 86400))::int * 3
                 AS score
          FROM "World" w
         WHERE w."status" = 'published' AND w."visibility" = 'public'
      )
      SELECT * FROM ranked
       WHERE ${cursor === null
        ? Prisma.sql`TRUE`
        : Prisma.sql`(score < ${cursor.score} OR (score = ${cursor.score} AND id < ${cursor.id}))`}
       ORDER BY score DESC, id DESC
       LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return ok({
      worlds: await decorate(deps.prisma, page, user.locale as LocaleKey, user.id),
      nextCursor: rows.length > limit && last ? encodeCursor(Number(last.score), last.id) : null,
    });
  });

  /** The build beat (SCR-048). Creator only — an unfinished world is nobody else's business. */
  app.get("/:id/status", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    if (!world || world.createdBy !== user.id) return notFound("World");

    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    const seed = await getWorldSeed(world.slug, deps.prisma);
    return ok({
      world: await oneFull(deps, world, locale, user.id),
      progress: buildProgress(world, deps.clock.now()),
      cast: characters.map((ch) => {
        const seeded = seed?.cast.find((s) => sameHandle(s.handle, ch.handle));
        return {
          handle: ch.handle,
          displayName: ch.displayName,
          role: ch.role,
          intro: seeded ? localized(seeded.intro, locale) : "",
        };
      }),
    });
  });

  /**
   * SCR-049 → share. `private` applies immediately; it is the creator's own business, and nobody
   * else can reach the world.
   *
   * Anything a second person can open — `unlisted` by link, `public` in Explore — goes through G8
   * over the **generated** bible and cast (not the premise, which was screened before any of this
   * existed). `unlisted` then goes live, because a link that reaches one friend is not a discovery
   * surface. `public` is not a setting: it goes to a queue and a human decides. There is no path
   * through this handler that puts a world in Explore.
   */
  app.post("/:id/publish", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, PublishWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    if (!world || world.createdBy !== user.id) return notFound("World");
    if (world.status === "draft" || world.status === "generating") {
      return fail("VALIDATION", "That world hasn't finished building yet", 409);
    }

    if (body.value.visibility === "private") {
      const updated = await deps.prisma.world.update({
        where: { id: world.id },
        // Pulling a world back also withdraws it from the queue, or from Explore.
        data: { visibility: "private", status: "ready" },
      });
      return ok({ world: await oneFull(deps, updated, locale, user.id), needsReview: false });
    }

    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    // A public world's audience includes minors, so it is judged at the strictest setting no matter
    // who is asking to publish it.
    const gate = await safetyGate(deps, {
      locale,
      isMinor: true,
      text: reviewText(world, characters, locale),
      surface: "post",
    }, user.id);

    if (gate.verdict === "block") {
      await deps.prisma.world.update({
        where: { id: world.id },
        data: { safety: "block", safetyNote: "blocked by the pre-publication safety gate", status: "ready", visibility: "private" },
      });
      return fail("SAFETY_BLOCKED", "This world can't be shared.", 422);
    }

    const unlisted = body.value.visibility === "unlisted";
    const updated = await deps.prisma.world.update({
      where: { id: world.id },
      data: {
        visibility: body.value.visibility,
        // `unlisted` is live but undiscoverable; `public` waits for a person.
        status: unlisted ? "published" : "review",
        safety: gate.verdict,
        safetyNote: gate.verdict === "soften" ? "flagged for a closer read" : "",
      },
    });
    return ok({ world: await oneFull(deps, updated, locale, user.id), needsReview: !unlisted }, unlisted ? 200 : 202);
  });

  app.get("/:id", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    if (!world) return notFound("World");
    // Someone else's unpublished world does not exist as far as this caller is concerned.
    if (!canPlay(world, user.id)) return notFound("World");
    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    const seed = await getWorldSeed(world.slug, deps.prisma);
    return ok({
      world: toApiWorld(world, locale),
      characters: characters.map((ch) => {
        const seeded = seed?.cast.find((s) => sameHandle(s.handle, ch.handle));
        return toApiCharacter(ch, locale, seeded ? localized(seeded.intro, locale) : undefined);
      }),
      presetPersonas: (seed?.presetPersonas ?? []).map((p) => ({
        handle: p.handle,
        displayName: localized(p.displayName, locale),
        bio: localized(p.bio, locale),
        avatarUrl: null,
      })),
    });
  });

  return app;
}

/** How much of a generated world a reviewer — G8 or a human — is shown. */
export const REVIEW_EXCERPT_CHARS = 4000;

export function reviewText(
  world: World,
  characters: { handle: string; role: string; card: unknown }[],
  locale: LocaleKey,
): string {
  return [
    localized(world.title, locale),
    localized(world.scenario, locale),
    localized(world.bible, locale).slice(0, REVIEW_EXCERPT_CHARS),
    ...characters.map((ch) => `${ch.handle} (${ch.role}): ${localized(ch.card, locale)}`),
  ].join("\n");
}

interface PublicCursor { score: number; id: string }

const encodeCursor = (score: number, id: string): string =>
  Buffer.from(`${score}:${id}`, "utf8").toString("base64url");

function decodeCursor(raw: string | undefined): PublicCursor | null {
  if (!raw) return null;
  const [score, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split(":");
  const id = rest.join(":");
  const n = Number(score);
  return Number.isInteger(n) && id.length > 0 ? { score: n, id } : null;
}
