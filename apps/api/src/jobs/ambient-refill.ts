import type { Locale, Prisma, PrismaClient, World, WorldCharacter } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
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
 * cost-architecture §3 assigns this to **G2 on the Batch tier**; `packages/llm` ships no `g2`, so
 * the refill runs **G1 with a synthetic "ambient" prompt** — no persona, no reply target, just the
 * world bible + cast asking for `k` lines of world chatter (build-notes "Agent H"). The per-run
 * budget is deliberately tiny (one G1 call per world+locale) because there is no Batch queue here.
 */
export const AMBIENT_POOL_TARGET = PACING.AMBIENT_SEED_COUNT * 4;
/** G1 caps k at 4; one call per world+locale per run. */
export const AMBIENT_PER_RUN = 4;

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
