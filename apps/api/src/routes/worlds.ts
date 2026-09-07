import { Hono } from "hono";
import { Prisma, type World } from "@prisma/client";
import { AppealWorldReqZ, CreateWorldReqZ, PublishWorldReqZ, WORLD_STUDIO, type Locale } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { worldBuildOnCreate } from "../env";
import { fail, notFound, ok, parseBody, validationError } from "../http";
import { runJobOnce } from "../jobs/registry";
import { logLine } from "../middleware/request-log";
import { loadDeepPremiseScreen } from "../llm-loader";
import { requireActiveAccount } from "../services/account";
import { atHandle, sameHandle } from "../services/handles";
import { localized, type LocaleKey } from "../services/locale";
import { toApiCharacter, toApiWorld } from "../services/serialize";
import { ensureWallet } from "../services/wallet";
import { getWorldSeed } from "../services/world-seeds";
import {
  GemsRequiredError, buildProgress, canStillPlay, castCounts, creatorHandles, dailyWorldLimit, decorate,
  pickerWhere, slugifyPremise, spendGems, toApiWorldFull, uniqueSlug, worldsCreatedToday,
} from "../services/world-studio";
import { setWorldVisibility } from "../services/world-publish";
import { appealRejection } from "../services/world-appeal";
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
    const { genre, locale, visibility } = body.value;
    /**
     * `CreateWorldReqZ` measures the raw string, and the client trims before it measures — so ten
     * spaces was a valid 8-character premise, and a 120-gem purchase that built a world out of
     * nothing (QA-005). Trim on the side that takes the money.
     */
    const premise = body.value.premise.trim();
    if (premise.length < 8) {
      return fail("VALIDATION", "Give the world a little more to go on", 400);
    }

    // 1. Safety, before a single token is spent on generation — the premise ends up inside a system
    //    prompt. Two layers: deterministic vocabulary always, and in live mode a light-tier model
    //    classifier after it. They are ANDed, so the model can tighten the verdict and never loosen
    //    it, and an outage degrades to the deterministic answer instead of closing the studio.
    const screen = await loadDeepPremiseScreen(deps.gateway);
    const verdict = await screen(premise, locale);
    if (verdict.verdict === "block") {
      logLine({ level: "warn", msg: "world.premise.blocked", userId: user.id, category: verdict.category ?? "unknown", layer: verdict.layer });
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
          // Bare, like every other handle this API emits — the client owns the "@".
          handle: atHandle(ch.handle),
          displayName: ch.displayName,
          role: ch.role,
          intro: seeded ? localized(seeded.intro, locale) : "",
        };
      }),
    });
  });

  /**
   * SCR-049 → share, and the *second* of the two doors onto one decision.
   *
   * Everything about what each visibility means, and about when a world may change hands at all,
   * lives in `services/world-publish.ts` — because the same decision is also made on SCR-048,
   * before the world exists, and settled by the build job. This handler's whole job is to turn the
   * shared outcome into an HTTP answer (QA-003).
   */
  app.post("/:id/publish", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, PublishWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    if (!world || world.createdBy !== user.id) return notFound("World");

    const outcome = await setWorldVisibility(deps, world, body.value.visibility, {
      locale,
      actorId: user.id,
      // The 422 below carries the message; a request that gets an answer needs nothing on the row.
    });
    if (!outcome.ok) {
      return outcome.kind === "refused"
        ? fail("VALIDATION", outcome.message, 409)
        : fail("SAFETY_BLOCKED", "This world can't be shared.", 422);
    }
    return ok(
      { world: await oneFull(deps, outcome.world, locale, user.id), needsReview: outcome.needsReview },
      outcome.needsReview ? 202 : 200,
    );
  });

  /**
   * SCR-049 → appeal. **The one thing a rejected creator could not do.**
   *
   * The runbook tells reviewers to reject when unsure (`docs/moderation.md` §4), which is right and
   * which produces some wrong rejections on purpose. Before this, the only answer to one was to
   * wait out `RESUBMIT_COOLDOWN_HOURS` and resubmit the same world hoping for a different reviewer
   * — arguing with a decision by pretending not to be.
   *
   * So: once per rejection (`WORLD_MODERATION.APPEALS_PER_REJECTION`), the creator writes one
   * message and the world goes back in the queue carrying it **and the reason it was rejected for**,
   * ranked with the pulled worlds because both mean a person is waiting on an answer.
   *
   * Deliberately not charged, not rate-limited beyond the ordinary write budget, and **not subject
   * to the resubmit cooldown**: an appeal is not a resubmit. Making someone wait a day to say "you
   * misread this" is the same wrong answer, delivered slowly.
   */
  app.post("/:id/appeal", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, AppealWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    // Somebody else's world does not exist here, exactly as everywhere else in the studio.
    if (!world || world.createdBy !== user.id) return notFound("World");
    if (world.status !== "rejected") {
      return fail("VALIDATION", "There's no decision to appeal on that world", 409);
    }
    // `AppealWorldReqZ` is min(10) on the raw string; a person reads this one, so the length that
    // matters is what survives trimming.
    const message = body.value.message.trim();
    if (message.length < 10) return validationError("message: an appeal needs a sentence");

    const appealed = await appealRejection(deps.prisma, world, message, deps.clock.now());
    // Null means the guard in the WHERE refused it: already appealed, or two appeals raced and this
    // is the one that lost. Same answer either way — the budget for this decision is spent.
    if (appealed === null) {
      return fail("ALREADY_DONE", "You've already appealed this decision — a person is reading it.", 409);
    }
    logLine({ level: "info", msg: "world.appeal.filed", worldId: appealed.id, userId: user.id });
    return ok({ world: await oneFull(deps, appealed, locale, user.id) });
  });

  app.get("/:id", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const world = await findWorld(deps, c.req.param("id"));
    if (!world) return notFound("World");
    // Someone else's unpublished world does not exist as far as this caller is concerned — with one
    // exception: a world reports pulled off the shelf stays open to whoever was already playing it.
    if (!(await canStillPlay(deps.prisma, world, user.id))) return notFound("World");
    const characters = await deps.prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    const seed = await getWorldSeed(world.slug, deps.prisma);
    // A world someone made is presented as *someone's* work, on the page a recipient of a share
    // link lands on — a credit that only exists inside the creator's own screen is not authorship.
    const handles = world.createdBy ? await creatorHandles(deps.prisma, [world.createdBy]) : null;
    return ok({
      world: {
        ...toApiWorld(world, locale),
        creatorHandle: world.createdBy ? (handles?.get(world.createdBy) ?? null) : null,
        playCount: world.playCount,
        isPreset: world.isPreset,
      },
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
