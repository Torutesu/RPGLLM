import { z } from "zod";
import { LocaleZ, StatDeltasZ, WORLD_GENRES, type Locale, type WorldGenre } from "@rpgllm/shared";

/**
 * G9 — World Studio (AIF-003 / AIF-014): input, stage contracts and stage identifiers.
 *
 * The world is not generated in one call. `cost-architecture.md` §3 splits generators by
 * (a) context needed (b) quality required (c) frequency (d) whether anyone is waiting; the five
 * G9 stages differ on (b) alone, which is exactly the axis that decides the model tier. All five
 * log under `GeneratorId` "G9" with their own `variantId`, so `GenerationLog` shows what each
 * stage of a world actually cost.
 */

export const G9_STAGES = ["concept", "bible", "cards", "castevents", "texture"] as const;
export type G9Stage = (typeof G9_STAGES)[number];

/** `variantId` per stage. Distinct strings so the bandit and the cost dashboard can split them. */
export const G9_VARIANT_IDS: Readonly<Record<G9Stage, string>> = {
  concept: "G9-concept@v1",
  bible: "G9-bible@v1",
  cards: "G9-cards@v1",
  castevents: "G9-events@v1",
  texture: "G9-texture@v1",
};

/**
 * What apps/api hands the studio. `premise` is the player's own sentence and therefore
 * **untrusted**: it is screened by `screenPremise` before a gem is spent, it never reaches a
 * system block, and it never appears verbatim in the generated world.
 */
export const G9InputZ = z.object({
  /** API-assigned, unique, kebab-case, already sanitized */
  slug: z.string().min(1).max(64),
  premise: z.string().min(1).max(400),
  genre: z.enum(WORLD_GENRES),
  locale: LocaleZ,
  seed: z.number().int(),
});
export interface G9Input {
  slug: string;
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  seed: number;
}

const LocaleTextZ = z.object({ en: z.string(), ja: z.string() });

/* ------------------------------------------------------------ G9a — concept ---- */

export const G9ConceptCastZ = z.object({
  handle: z.string(),
  displayName: z.string(),
  role: z.string(),
  /** which relationship-to-the-player this account is; see archetypes.ts */
  archetype: z.string(),
  avatarKey: z.string(),
  isPressAccount: z.boolean(),
  canBeFirstFollower: z.boolean(),
  intro: LocaleTextZ,
});
export type G9ConceptCast = z.infer<typeof G9ConceptCastZ>;

/**
 * Deliberately loose bounds: a model that returns seven cast members should be repaired by
 * `postprocess`, not thrown away. The strict shape (exactly 8, exactly one press account) is
 * enforced after parsing.
 */
export const G9ConceptZ = z.object({
  title: LocaleTextZ,
  scenario: LocaleTextZ,
  difficulty: z.number().int().min(1).max(3),
  tone: LocaleTextZ,
  platform: z.object({ name: z.string(), conceit: LocaleTextZ }),
  setting: LocaleTextZ,
  places: z.array(z.object({ name: LocaleTextZ, note: LocaleTextZ })).min(1).max(8),
  factions: z.array(z.object({ name: LocaleTextZ, blurb: LocaleTextZ })).min(1).max(6),
  slang: z.array(z.object({ term: z.string(), gloss: LocaleTextZ })).min(1).max(20),
  cast: z.array(G9ConceptCastZ).min(1).max(12),
});
export type G9Concept = z.infer<typeof G9ConceptZ>;

/* -------------------------------------------------------------- G9b — bible ---- */

export const G9BibleZ = z.object({
  /** bible part 1: setting, platform, geography, tone rules, slang, factions */
  prose: z.string(),
  /** bible part 3: press rules, drama arcs, how the numbers move, output reminders */
  outro: z.string(),
});
export type G9BibleOutput = z.infer<typeof G9BibleZ>;

/* -------------------------------------------------------------- G9c — cards ---- */

export const G9CardZ = z.object({
  card: LocaleTextZ,
  intro: LocaleTextZ,
});
export type G9CardOutput = z.infer<typeof G9CardZ>;

/* --------------------------------------------------------- G9d — cast/events ---- */

export const G9PersonaZ = z.object({
  handle: z.string(),
  displayName: LocaleTextZ,
  bio: LocaleTextZ,
  avatarKey: z.string(),
});

export const G9EventZ = z.object({
  title: LocaleTextZ,
  prompt: LocaleTextZ,
  choices: z
    .array(z.object({ label: LocaleTextZ, outcomeText: LocaleTextZ, statDeltas: StatDeltasZ }))
    .min(1)
    .max(4),
});

export const G9CastEventsZ = z.object({
  personas: z.array(G9PersonaZ).min(1).max(12),
  events: z.array(G9EventZ).min(1).max(10),
});
export type G9CastEventsOutput = z.infer<typeof G9CastEventsZ>;

/* ------------------------------------------------------------ G9e — texture ---- */

export const G9TextureZ = z.object({
  ambient: z.array(z.object({ handle: z.string(), text: z.string().max(280) })).min(1).max(40),
  /** handle -> short reply lines used when a generation fails mid-game */
  fallbackReplies: z.record(z.string(), z.array(z.string()).min(1)),
  /** handle -> the post this account makes when the player arrives */
  welcomePosts: z.record(z.string(), z.string()),
});
export type G9TextureOutput = z.infer<typeof G9TextureZ>;

/* ----------------------------------------------------------- stage inputs ---- */

export interface G9ConceptInput {
  base: G9Input;
}
export interface G9BibleInput {
  base: G9Input;
  concept: G9Concept;
  locale: Locale;
}
export interface G9CardInput {
  base: G9Input;
  concept: G9Concept;
  /** bible prose from G9b, per locale — the per-world cached prefix these stages share */
  prose: Record<Locale, string>;
  /** the cast member this call writes; one call per character (batchable fan-out) */
  handle: string;
}
export interface G9CastEventsInput {
  base: G9Input;
  concept: G9Concept;
  prose: Record<Locale, string>;
}
export interface G9TextureInput {
  base: G9Input;
  concept: G9Concept;
  prose: Record<Locale, string>;
  locale: Locale;
}
