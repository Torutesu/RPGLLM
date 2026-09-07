import { Hono } from "hono";
import { Prisma, type World } from "@prisma/client";
import {
  AppealWorldReqZ, CreateWorldReqZ, PublishWorldReqZ, RemixWorldReqZ, WORLD_GENRES, WORLD_STUDIO,
  type Locale, type WorldGenre,
} from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { worldBuildOnCreate } from "../env";
import { fail, notFound, ok, parseBody, validationError } from "../http";
import { runJobOnce } from "../jobs/registry";
import { logLine } from "../middleware/request-log";
import { requireActiveAccount } from "../services/account";
import { atHandle, sameHandle } from "../services/handles";
import { localized, roleFor, type LocaleKey } from "../services/locale";
import { toApiCharacter, toApiWorld } from "../services/serialize";
import { getWorldSeed } from "../services/world-seeds";
import {
  buildProgress, canPlay, canStillPlay, castCounts, creatorHandles, dailyWorldLimit, decorate,
  pickerWhere, remixParents, toApiWorldFull, worldsCreatedToday,
} from "../services/world-studio";
import { createWorld, type CreateWorldInput } from "../services/world-create";
import { freshWorlds } from "../services/world-fresh";
import { setWorldVisibility } from "../services/world-publish";
import { appealRejection } from "../services/world-appeal";
import type { AppEnv, Deps } from "../types";

const isWorldGenre = (g: string): g is WorldGenre => (WORLD_GENRES as readonly string[]).includes(g);

const findWorld = (deps: Deps, id: string): Promise<World | null> =>
  deps.prisma.world.findFirst({ where: { OR: [{ id }, { slug: id }] } });

/** One world in the studio's shape, with its cast count and credited handle filled in. */
async function oneFull(deps: Deps, world: World, locale: LocaleKey, viewerId: string) {
  const [counts, handles, parents] = await Promise.all([
    castCounts(deps.prisma, [world.id]),
    creatorHandles(deps.prisma, world.createdBy ? [world.createdBy] : []),
    remixParents(deps.prisma, [world], locale),
  ]);
  return toApiWorldFull(world, locale, viewerId, {
    castCount: counts.get(world.id) ?? 0,
    creatorHandle: world.createdBy ? (handles.get(world.createdBy) ?? null) : null,
    remixOf: world.remixOfId ? (parents.get(world.remixOfId) ?? null) : null,
  });
}

/** The one shape both doors onto the studio answer with. */
const createdRes = (charged: number, remaining: number) => ({ gems: charged, remaining });

/**
 * Kicking the builder is an optimisation — somebody is watching a progress bar — never the
 * contract: the scheduler runs `world-build` every minute whether or not this fires.
 */
function kickBuilder(deps: Deps): void {
  if (!worldBuildOnCreate()) return;
  void runJobOnce(deps, "world-build", { trigger: "create" }).catch(() => {
    /* the world stays `generating`; the next tick, or the sweep, deals with it */
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

    const outcome = await createWorld(deps, user, {
      premise: body.value.premise,
      genre: body.value.genre,
      locale: body.value.locale as Locale,
      visibility: body.value.visibility,
    });
    if (!outcome.ok) return fail(outcome.code, outcome.message, outcome.status);

    kickBuilder(deps);
    return ok({
      world: await oneFull(deps, outcome.world, user.locale as LocaleKey, user.id),
      charged: createdRes(WORLD_STUDIO.GEM_COST, outcome.remaining),
    }, 201);
  });

  /**
   * **Circuit ④ — the conversion** (gtm.md 勝ち筋 A ④). SCR-050 → "make my own version".
   *
   * The hardest transition in any UGC product is consumer → author, and the reason is the blank
   * page: "what world do you want?" is a question most players have no answer to. A player who has
   * just spent an hour inside a world has an answer to a much smaller question — *what would I
   * change?* This endpoint is that question, and nothing else: same 120 gems, same daily limit,
   * same premise screen, same build job (`services/world-create.ts` is literally the same code).
   * Cheaper to decide, not cheaper to make.
   *
   * **Which worlds may be remixed: exactly the ones the caller may play.** A public world, an
   * unlisted one whose link they hold, a preset, or their own — `canPlay`, the same predicate that
   * decides whether they could make a persona in it. Anything else 404s, because somebody else's
   * private world does not exist to this caller and knowing its id must not change that.
   *
   * Genre and locale are inherited unless overridden: a remix of a JA idol world is a JA idol world
   * unless the player says otherwise. The premise is always new — a remix with the same premise is
   * a re-roll of the same world, which is a different (and much cheaper) product than this one.
   */
  app.post("/:id/remix", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, RemixWorldReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const source = await findWorld(deps, c.req.param("id"));
    if (!source || !canPlay(source, user.id)) return notFound("World");

    const input: CreateWorldInput = {
      premise: body.value.premise,
      // A preset carries no genre of its own; `fame` is the same default the build job falls back
      // to, so an inherited-genre remix of a preset is not a differently-shaped world.
      genre: body.value.genre ?? (isWorldGenre(source.genre) ? source.genre : "fame"),
      locale: (body.value.locale ?? source.genLocale ?? user.locale) as Locale,
      visibility: body.value.visibility,
      remixOf: source,
    };
    const outcome = await createWorld(deps, user, input);
    if (!outcome.ok) return fail(outcome.code, outcome.message, outcome.status);

    kickBuilder(deps);
    return ok({
      world: await oneFull(deps, outcome.world, user.locale as LocaleKey, user.id),
      charged: createdRes(WORLD_STUDIO.GEM_COST, outcome.remaining),
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
   * Two lists, because one list cannot do both jobs.
   *
   * `worlds` is the ranking: plays **plus a decaying newcomer bonus**, keyset-paged on `(score, id)`
   * rather than an offset so a world published mid-paging cannot duplicate or skip a card.
   *
   * `fresh` is the guaranteed slot (`services/world-fresh.ts`, gtm.md 勝ち筋 A ③): worlds shown
   * because they are new and for no other reason. A ranking — any ranking, bonus or not — is a
   * competition, and a new author's first world loses it; without a slot that rank cannot touch,
   * the third circuit never closes and nobody writes a second world. The ranked query **excludes
   * exactly the fresh ids**, on every page, so no world is ever in both lists.
   *
   * **No locale filter, deliberately, and there is a test that says so.** Every world carries both
   * locales by construction (G9 always generates en and ja), which is the whole global claim —
   * 世界は言語を超える. A shelf that quietly shows a Japanese player only Japanese-authored worlds
   * would make the product's one structural advantage over Status invisible in the UI that is
   * supposed to demonstrate it.
   */
  app.get("/public", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const locale = user.locale as LocaleKey;
    const now = deps.clock.now();
    const rawLimit = Number(c.req.query("limit") ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 20;
    const cursor = decodeCursor(c.req.query("cursor"));

    const fresh = await freshWorlds(deps.prisma, now);
    const freshIds = fresh.map((w) => w.id);

    const rows = await deps.prisma.$queryRaw<(World & { score: number })[]>`
      WITH ranked AS (
        SELECT w.*,
               w."playCount"
                 + GREATEST(0, 14 - FLOOR(EXTRACT(EPOCH FROM (${now}::timestamp - w."createdAt")) / 86400))::int * 3
                 AS score
          FROM "World" w
         WHERE w."status" = 'published' AND w."visibility" = 'public'
           AND ${freshIds.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`w."id" NOT IN (${Prisma.join(freshIds)})`}
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
      worlds: await decorate(deps.prisma, page, locale, user.id),
      // The strip belongs at the top of the shelf, so it is answered once: paging deeper into the
      // ranking is not a request for it, and a client appending pages never repeats it.
      fresh: cursor === null ? await decorate(deps.prisma, fresh, locale, user.id) : [],
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
          role: roleFor(ch, locale),
          intro: seeded ? localized(seeded.intro, locale) : "",
        };
      }),
    });
  });

  /**
   * SCR-049 → share, and the *second* of the two doors onto one decision.
   *
   * Everything about what each visibility means, about when a world may change hands at all, and
   * about what it costs, lives in `services/world-publish.ts` — because the same decision is also
   * made on SCR-048, before the world exists, and settled by the build job. This handler's whole
   * job is to turn the shared outcome into an HTTP answer (QA-003).
   *
   * Four answers, and the 202 is no longer the only interesting one (gtm.md §2):
   *
   *  - **202** — a person now owes this world twenty minutes. `charged` says what that cost.
   *  - **200** — it is live: `private`, `unlisted`, or a trusted creator's submission the sampling
   *    draw sent straight to the shelf (`services/creator-trust.ts`).
   *  - **402** — Explore costs `WORLD_MODERATION.PUBLIC_SUBMIT_GEMS` and this wallet is short. The
   *    world is untouched and still playable; building and playing are free, the shelf is not.
   *  - **409 / 422** — it may not change hands right now, or the gate said no. Neither takes a gem.
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
      if (outcome.kind === "refused") return fail("VALIDATION", outcome.message, 409);
      // 402, the same answer as an empty energy bar — the world is fine, the wallet is not.
      if (outcome.kind === "gems") return fail("GEMS_REQUIRED", outcome.message, 402);
      return fail("SAFETY_BLOCKED", "This world can't be shared.", 422);
    }
    return ok(
      {
        world: await oneFull(deps, outcome.world, locale, user.id),
        needsReview: outcome.needsReview,
        // What the shelf cost, so the client can say so rather than silently draining a wallet —
        // negative when a withdrawn submission got its fee back.
        charged: outcome.charged,
      },
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
    // Lineage and the two fields a remix inherits, on the page a *visitor* lands on: a derivative
    // that only credits its source inside the creator's own screen credits nobody, and a remix form
    // that cannot read the genre it is inheriting can only guess or stay silent.
    const parents = await remixParents(deps.prisma, [world], locale);
    return ok({
      world: {
        ...toApiWorld(world, locale),
        creatorHandle: world.createdBy ? (handles?.get(world.createdBy) ?? null) : null,
        playCount: world.playCount,
        isPreset: world.isPreset,
        remixOf: world.remixOfId ? (parents.get(world.remixOfId) ?? null) : null,
        remixCount: world.remixCount,
        // `World.genre` is a plain column defaulting to "" — the presets have no genre, and an
        // empty string is not a member of the enum. Null is what "no genre" means on the wire.
        genre: isWorldGenre(world.genre) ? world.genre : null,
        genLocale: world.genLocale,
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
