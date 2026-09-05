import type { PrismaClient } from "@prisma/client";
import type { WorldSeed } from "@rpgllm/shared";
import { WorldSeedZ } from "@rpgllm/shared";
import { loadSeedsFromLlm } from "../llm-loader";

let cache: WorldSeed[] | null = null;
let source: "llm" | "fallback" | "unloaded" = "unloaded";

/** Loaded once per process; validated against WorldSeedZ so a malformed seed cannot poison routes. */
export async function getWorldSeeds(): Promise<WorldSeed[]> {
  if (cache) return cache;
  const loaded = await loadSeedsFromLlm();
  const valid: WorldSeed[] = [];
  for (const seed of loaded.seeds) {
    const parsed = WorldSeedZ.safeParse(seed);
    if (parsed.success) valid.push(parsed.data);
    else console.warn(`[api] world seed "${(seed as { slug?: string }).slug ?? "?"}" failed WorldSeedZ; skipped`);
  }
  if (valid.length === 0) {
    const { FALLBACK_WORLD_SEEDS } = await import("../seed-fallback");
    cache = FALLBACK_WORLD_SEEDS;
    source = "fallback";
    return cache;
  }
  cache = valid;
  source = loaded.source;
  return cache;
}

export const worldSeedSource = (): string => source;

/**
 * The seed behind a world.
 *
 * Presets come from the in-process list (`@rpgllm/llm`, or the stand-in) and always have. A world
 * a *player* built has no entry there — its `WorldSeed` was produced once by G9 and stored on the
 * `World` row — so when a `prisma` client is in hand the lookup falls back to the database. That is
 * what makes fallback replies, welcome posts, character intros, preset personas and ambient text
 * work identically for a user world and a hand-authored one, with no branch at any call site.
 *
 * The DB read is deliberately not cached: a generated seed is read only for user worlds (presets
 * never reach this line), and a cache keyed by slug would survive the `TRUNCATE` between tests.
 */
export async function getWorldSeed(slug: string, prisma?: PrismaClient): Promise<WorldSeed | undefined> {
  const preset = (await getWorldSeeds()).find((s) => s.slug === slug);
  if (preset || !prisma) return preset;
  return await getStoredWorldSeed(prisma, slug);
}

/** The generated seed persisted on `World.seed`, validated before anyone downstream trusts it. */
export async function getStoredWorldSeed(prisma: PrismaClient, slug: string): Promise<WorldSeed | undefined> {
  const row = await prisma.world.findUnique({ where: { slug }, select: { seed: true } });
  if (!row || row.seed === null) return undefined;
  const parsed = WorldSeedZ.safeParse(row.seed);
  if (parsed.success) return parsed.data;
  console.warn(`[api] stored seed for world "${slug}" failed WorldSeedZ; ignoring`);
  return undefined;
}

/** test/seed override */
export function setWorldSeeds(seeds: WorldSeed[]): void {
  cache = seeds;
  source = "fallback";
}
