import type { Locale } from "@rpgllm/shared";

/**
 * Replay fixtures (LLM_MODE=replay). No network, no API key, fully deterministic.
 *
 * Reply pools are organised as six **tone buckets** per character per locale, three lines each:
 *   0 hype | 1 shade | 2 curious | 3 deadpan | 4 worry | 5 chaos
 * The gateway picks a bucket from the post's sentiment (positive posts draw from 0/2/5,
 * negative posts from 1/3/4) and then a line inside it from `fnv1a(seed, postText, handle, i)`.
 * Same input -> same reply; a different seed -> a different reply.
 */
export const BUCKETS = ["hype", "shade", "curious", "deadpan", "worry", "chaos"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const POSITIVE_BUCKETS = [0, 2, 5] as const;
export const NEGATIVE_BUCKETS = [1, 3, 4] as const;

export interface CharacterFixture {
  /** locale -> 6 buckets x >=3 reply lines */
  replies: Record<Locale, string[][]>;
  /** locale -> >=6 DM bubble sets (1-3 bubbles each) */
  dm: Record<Locale, string[][]>;
  /** locale -> >=3 memory notes written from this character's point of view */
  memory: Record<Locale, string[]>;
}

export interface WorldFixture {
  /** handle -> fixture. Must cover every cast handle in the world seed. */
  characters: Record<string, CharacterFixture>;
  /** locale -> >=8 stat-card narratives */
  narratives: Record<Locale, string[]>;
  /** locale -> >=6 press-account news lines (written in the press account's voice) */
  news: Record<Locale, string[]>;
  /** 3 extra dynamic events on top of the seed's presetEvents, for G5 replay */
  extraEvents: Array<{
    title: Record<Locale, string>;
    prompt: Record<Locale, string>;
    choices: Array<{
      label: Record<Locale, string>;
      outcomeText: Record<Locale, string>;
      statDeltas: { followers: number; aura: number; humor: number };
    }>;
  }>;
}
