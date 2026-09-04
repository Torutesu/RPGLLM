import type { WorldSeed, WorldSlug } from "@rpgllm/shared";
import { popstarEra } from "./popstar-era.js";
import { magicAcademy } from "./magic-academy.js";
import { idolSurvival } from "./idol-survival.js";

const SEEDS: readonly WorldSeed[] = [popstarEra, magicAcademy, idolSurvival];

const BY_SLUG = new Map<string, WorldSeed>(SEEDS.map((w) => [w.slug, w]));

/** All preset worlds, in picker order (SCR-003). Same object identity on every call. */
export function loadWorldSeeds(): WorldSeed[] {
  return [...SEEDS];
}

export function worldSeed(slug: string): WorldSeed | undefined {
  return BY_SLUG.get(slug);
}

export type { WorldSlug };
export { popstarEra, magicAcademy, idolSurvival };
