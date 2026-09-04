import type { Locale, Prisma, PrismaClient, World, WorldCharacter } from "@prisma/client";
import type { BatchItem, G2Input, Gateway } from "@rpgllm/llm";
import { runAmbientRefillBatched } from "@rpgllm/llm";
import { LOCALES, PACING, STATS, type G1Input } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { logGeneration } from "../services/generation";
import { normHandle } from "../services/handles";
import { localized, type LocaleKey } from "../services/locale";
import { seedFrom } from "../services/rng";

/**
 * S2-7 — ambient chatter refill.
 *
 * `AmbientPost` is the shared, per-(world, locale) pool that onboarding draws from. It was only
 * ever seeded, never topped up, so a long-lived install slowly runs dry (gap analysis S2-7).
 *
 * Two paths, and the difference is the Batch tier (cost-architecture §3/§5.4):
 *
 *   - `runAmbientRefillBatchedJob` — what the **scheduler** runs. One `G2` batch for every pool
 *     that needs topping up, at half price. Nobody is waiting on ambient chatter, which is exactly
 *     what makes it batchable (Agent N's `runAmbientRefillBatched`).
 *   - `runAmbientRefill` — the interactive fallback, kept because the batch has a 24-hour SLA in
 *     live mode: `POST /v1/__test/run-job {"job":"ambient"}` (the E2E suite) and anything else that
 *     needs an answer now must not wait on a queue. It runs **G1 with a synthetic "ambient" prompt**
 *     because `g2` did not exist when it was written (build-notes "Agent H").
 */
export const AMBIENT_POOL_TARGET = PACING.AMBIENT_SEED_COUNT * 4;
/** G1 caps k at 4; one call per world+locale per run. */
export const AMBIENT_PER_RUN = 4;
/** G2 takes up to 12 posts in one call, so a batched refill can fill a pool in a single request. */
export const AMBIENT_PER_BATCH = 12;
/** How many existing texts are shown to the model as "do not repeat this" (G2 caps `avoid` at 40). */
const AVOID_SAMPLE = 40;

export interface AmbientRefillOptions {
  worldId?: string;
  locale?: LocaleKey;
  /** refill even when the pool is above target (test hook / manual run) */
  force?: boolean;
  target?: number;
}

export interface AmbientRefillResult {
  pools: number;
  created: number;
}

/** The prompt G1 answers: there is no user post, so the "post" is the world's own weather. */
const ambientPrompt = (world: World, locale: LocaleKey): string =>
  `[ambient] ${localized(world.title, locale)} — ${localized(world.scenario, locale)}`;

function ambientInput(
  world: World,
  characters: WorldCharacter[],
  locale: LocaleKey,
  k: number,
  round: number,
): G1Input {
  const cast = characters.map((c) => ({
    handle: normHandle(c.handle),
    displayName: c.displayName,
    role: c.role,
    card: localized(c.card, locale),
    isPressAccount: c.isPressAccount,
  }));
  return {
    userId: null,
    locale,
    worldSlug: world.slug,
    worldBible: localized(world.bible, locale),
    isMinor: true,           // the pool is shared, so it is written to the strictest audience
    persona: {
      handle: "world",
      displayName: localized(world.title, locale),
      bio: localized(world.scenario, locale),
      voiceNotes: "",
      followers: STATS.START_FOLLOWERS,
      aura: STATS.START_AURA,
      humor: STATS.START_HUMOR,
      level: 1,
      worldSummary: "",
    },
    cast,
    involved: [],
    recentFeed: [],
    post: { text: ambientPrompt(world, locale), parentAuthorHandle: null, parentText: null },
    k,
    softened: false,
    seed: seedFrom(`ambient:${world.slug}:${locale}:${round}`),
    includeNews: false,
  };
}

export async function refillPool(
  prisma: PrismaClient,
  gateway: Gateway,
  world: World,
  characters: WorldCharacter[],
  locale: LocaleKey,
  opts: { force?: boolean; target?: number } = {},
): Promise<number> {
  const target = opts.target ?? AMBIENT_POOL_TARGET;
  const have = await prisma.ambientPost.count({ where: { worldId: world.id, locale: locale as Locale } });
  if (!opts.force && have >= target) return 0;

  const k = Math.max(1, Math.min(AMBIENT_PER_RUN, Math.max(1, target - have)));
  const result = await gateway.g1(ambientInput(world, characters, locale, k, have));
  await logGeneration(prisma, result.meta, null);
  if (result.meta.fallback) return 0;

  const rows: Prisma.AmbientPostCreateManyInput[] = [];
  for (const [i, reply] of result.output.replies.entries()) {
    const character =
      characters.find((c) => normHandle(c.handle) === normHandle(reply.characterHandle))
      ?? characters[i % Math.max(1, characters.length)];
    if (!character) continue;
    if (reply.text.trim().length === 0) continue;
    rows.push({ worldId: world.id, characterId: character.id, locale: locale as Locale, text: reply.text });
  }
  if (rows.length === 0) return 0;
  await prisma.ambientPost.createMany({ data: rows });
  return rows.length;
}

export async function runAmbientRefill(
  prisma: PrismaClient,
  gateway: Gateway,
  _clock: Clock,
  opts: AmbientRefillOptions = {},
): Promise<AmbientRefillResult> {
  const worlds = opts.worldId
    ? await prisma.world.findMany({ where: { id: opts.worldId } })
    : await prisma.world.findMany();
  const locales: LocaleKey[] = opts.locale ? [opts.locale] : [...LOCALES];

  let pools = 0;
  let created = 0;
  for (const world of worlds) {
    const characters = await prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    if (characters.length === 0) continue;
    for (const locale of locales) {
      const n = await refillPool(prisma, gateway, world, characters, locale, { force: opts.force ?? false, target: opts.target ?? undefined });
      if (n > 0) pools += 1;
      created += n;
    }
  }
  return { pools, created };
}


/* ------------------------------------------------------- the batch tier ---- */

const cardsFor = (characters: WorldCharacter[], locale: LocaleKey): G2Input["cast"] =>
  characters.map((c) => ({
    handle: normHandle(c.handle),
    displayName: c.displayName,
    role: c.role,
    card: localized(c.card, locale),
    isPressAccount: c.isPressAccount,
  }));

/** Turns one G2 answer into `AmbientPost` rows. Unknown handles fall back to the cast in order. */
async function writeAmbientPosts(
  prisma: PrismaClient,
  world: World,
  characters: WorldCharacter[],
  locale: LocaleKey,
  posts: readonly { characterHandle: string; text: string }[],
): Promise<number> {
  const rows: Prisma.AmbientPostCreateManyInput[] = [];
  for (const [i, post] of posts.entries()) {
    const character =
      characters.find((c) => normHandle(c.handle) === normHandle(post.characterHandle))
      ?? characters[i % Math.max(1, characters.length)];
    if (!character) continue;
    if (post.text.trim().length === 0) continue;
    rows.push({ worldId: world.id, characterId: character.id, locale: locale as Locale, text: post.text });
  }
  if (rows.length === 0) return 0;
  await prisma.ambientPost.createMany({ data: rows });
  return rows.length;
}

/**
 * The scheduled refill: **one G2 batch for every pool that is short**, at the §5.4 discount.
 * Pool sizes are counted in one `GROUP BY`, not one query per pool.
 */
export async function runAmbientRefillBatchedJob(
  prisma: PrismaClient,
  gateway: Gateway,
  _clock: Clock,
  opts: AmbientRefillOptions = {},
): Promise<AmbientRefillResult> {
  const worlds = opts.worldId
    ? await prisma.world.findMany({ where: { id: opts.worldId } })
    : await prisma.world.findMany();
  if (worlds.length === 0) return { pools: 0, created: 0 };
  const locales: LocaleKey[] = opts.locale ? [opts.locale] : [...LOCALES];
  const target = opts.target ?? AMBIENT_POOL_TARGET;

  const counted = await prisma.ambientPost.groupBy({
    by: ["worldId", "locale"],
    where: { worldId: { in: worlds.map((w) => w.id) } },
    _count: { _all: true },
  });
  const have = new Map(counted.map((row) => [`${row.worldId}:${row.locale}`, row._count._all]));

  const items: BatchItem<G2Input>[] = [];
  const pools = new Map<string, { world: World; characters: WorldCharacter[]; locale: LocaleKey }>();

  for (const world of worlds) {
    const characters = await prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } });
    if (characters.length === 0) continue;
    for (const locale of locales) {
      const key = `${world.id}:${locale}`;
      const size = have.get(key) ?? 0;
      if (!opts.force && size >= target) continue;
      const n = Math.max(1, Math.min(AMBIENT_PER_BATCH, Math.max(1, target - size)));
      const avoid = await prisma.ambientPost.findMany({
        where: { worldId: world.id, locale: locale as Locale },
        orderBy: { id: "desc" },
        take: AVOID_SAMPLE,
        select: { text: true },
      });
      pools.set(key, { world, characters, locale });
      items.push({
        customId: key,
        input: {
          userId: null,
          locale,
          worldSlug: world.slug,
          worldBible: localized(world.bible, locale),
          isMinor: true,        // the pool is shared, so it is written to the strictest audience
          cast: cardsFor(characters, locale),
          n,
          avoid: avoid.map((a) => a.text),
          seed: seedFrom(`ambient:${world.slug}:${locale}:${size}`),
        },
      });
    }
  }
  if (items.length === 0) return { pools: 0, created: 0 };

  const results = await runAmbientRefillBatched(gateway, items);
  let filled = 0;
  let created = 0;
  for (const [key, result] of results) {
    await logGeneration(prisma, result.meta, null);
    const pool = pools.get(key);
    if (!pool || result.meta.fallback) continue;
    const n = await writeAmbientPosts(prisma, pool.world, pool.characters, pool.locale, result.output.posts);
    if (n > 0) filled += 1;
    created += n;
  }
  return { pools: filled, created };
}
