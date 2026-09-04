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

export async function getWorldSeed(slug: string): Promise<WorldSeed | undefined> {
  return (await getWorldSeeds()).find((s) => s.slug === slug);
}

/** test/seed override */
export function setWorldSeeds(seeds: WorldSeed[]): void {
  cache = seeds;
  source = "fallback";
}
