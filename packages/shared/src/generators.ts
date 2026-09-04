import { z } from "zod";
import { LOCALES, MODEL_TIERS } from "./constants";

/** ---------- Shared context pieces (what generators read) ---------- */
export const LocaleZ = z.enum(LOCALES);
export const ModelTierZ = z.enum(MODEL_TIERS);
export const GeneratorIdZ = z.enum(["G1", "G2", "G3", "G4", "G5", "G7", "G8", "G9", "G10", "GJ"]);
export type GeneratorId = z.infer<typeof GeneratorIdZ>;

export const CharacterCardZ = z.object({
  handle: z.string(),
  displayName: z.string(),
  role: z.string(),
  card: z.string(),                 // voice/values/catchphrases/NG (locale-specific text)
  isPressAccount: z.boolean().default(false),
});
export type CharacterCard = z.infer<typeof CharacterCardZ>;

export const PersonaStateZ = z.object({
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  voiceNotes: z.string(),
  followers: z.number().int(),
  aura: z.number().int(),
  humor: z.number().int(),
  level: z.number().int(),
  worldSummary: z.string(),
});
export type PersonaState = z.infer<typeof PersonaStateZ>;

export const RelationshipCtxZ = z.object({
  handle: z.string(),
  affinity: z.number().int(),
  summary: z.string(),
  isFollower: z.boolean(),
});

export const FeedItemCtxZ = z.object({
  authorHandle: z.string(),
  kind: z.enum(["user", "character", "news", "ambient", "system"]),
  text: z.string(),
});

/** Base ctx every generator receives (gateway builds the cached prefix from worldBible) */
export const BaseCtxZ = z.object({
  userId: z.string().nullable(),
  locale: LocaleZ,
  worldSlug: z.string(),
  worldBible: z.string(),            // World.bible[locale] — verbatim, cached as system[1]
  isMinor: z.boolean().default(true),
});

/** ---------- G1 Reaction Fan-out (AIF-009) ---------- */
export const G1InputZ = BaseCtxZ.extend({
  persona: PersonaStateZ,
  cast: z.array(CharacterCardZ),                 // full cast (in bible too; here for handle validation)
  involved: z.array(RelationshipCtxZ).max(3),
  recentFeed: z.array(FeedItemCtxZ).max(6),
  post: z.object({ text: z.string(), parentAuthorHandle: z.string().nullable(), parentText: z.string().nullable() }),
  k: z.number().int().min(1).max(4),
  softened: z.boolean().default(false),
  seed: z.number().int(),
  includeNews: z.boolean().default(false),
});
export type G1Input = z.infer<typeof G1InputZ>;

export const StatDeltasZ = z.object({
  followers: z.number().int().min(-50).max(50),  // scaled by level server-side
  aura: z.number().int().min(-10).max(10),
  humor: z.number().int().min(-10).max(10),
});
export const G1OutputZ = z.object({
  replies: z.array(z.object({ characterHandle: z.string(), text: z.string().max(280) })).min(1).max(4),
  stat_deltas: StatDeltasZ,
  narrative: z.string().max(240),
  relationship_deltas: z.record(z.string(), z.union([z.literal(-1), z.literal(0), z.literal(1)])),
  memory_notes: z.array(z.object({ handle: z.string(), note: z.string().max(200) })).max(4),
  news: z.object({ text: z.string().max(280) }).nullable(),
  safety_flag: z.boolean(),
});
export type G1Output = z.infer<typeof G1OutputZ>;

/** ---------- G4 DM Turn (AIF-010) ---------- */
export const G4InputZ = BaseCtxZ.extend({
  persona: PersonaStateZ,
  character: CharacterCardZ,
  relationship: RelationshipCtxZ,
  history: z.array(z.object({ fromCharacter: z.boolean(), text: z.string() })).max(20),
  message: z.string(),
  softened: z.boolean().default(false),
  seed: z.number().int(),
});
export type G4Input = z.infer<typeof G4InputZ>;
export const G4OutputZ = z.object({
  bubbles: z.array(z.string().max(160)).min(1).max(3),
  affinity_delta: z.number().int().min(-2).max(2),
  memory_note: z.string().max(200).nullable(),
  safety_flag: z.boolean(),
});
export type G4Output = z.infer<typeof G4OutputZ>;

/** ---------- G5 Drama Director (AIF-011) ---------- */
export const G5InputZ = BaseCtxZ.extend({
  persona: PersonaStateZ,
  relationships: z.array(RelationshipCtxZ),
  recentSnapshots: z.array(z.object({ narrative: z.string(), followersDelta: z.number(), auraDelta: z.number(), humorDelta: z.number() })).max(5),
  pastEventTitles: z.array(z.string()),
  seed: z.number().int(),
});
export type G5Input = z.infer<typeof G5InputZ>;
export const G5ChoiceZ = z.object({
  id: z.string(),
  label: z.string().max(60),
  outcomeText: z.string().max(240),
  statDeltas: StatDeltasZ,
  relationshipDeltas: z.record(z.string(), z.union([z.literal(-1), z.literal(0), z.literal(1)])),
  newsText: z.string().max(280).nullable(),
});
export const G5OutputZ = z.object({
  title: z.string().max(80),
  prompt: z.string().max(240),
  choices: z.array(G5ChoiceZ).length(3),
});
export type G5Output = z.infer<typeof G5OutputZ>;

/** ---------- G7 Memory Consolidator (AIF-012) ---------- */
export const G7InputZ = BaseCtxZ.extend({
  persona: PersonaStateZ,
  relationships: z.array(z.object({ handle: z.string(), affinity: z.number().int(), oldSummary: z.string(), notes: z.array(z.string()) })),
});
export type G7Input = z.infer<typeof G7InputZ>;
export const G7OutputZ = z.object({
  relationships: z.array(z.object({ handle: z.string(), summary: z.string().max(600) })),
  worldSummary: z.string().max(1600),
});
export type G7Output = z.infer<typeof G7OutputZ>;

/** ---------- G8 Safety Gate (AIF-013) ---------- */
export const G8InputZ = z.object({ locale: LocaleZ, isMinor: z.boolean(), text: z.string(), surface: z.enum(["post", "dm"]) });
export type G8Input = z.infer<typeof G8InputZ>;
export const SafetyVerdictZ = z.enum(["allow", "soften", "block"]);
export const G8OutputZ = z.object({ verdict: SafetyVerdictZ, category: z.string().nullable() });
export type G8Output = z.infer<typeof G8OutputZ>;

/** ---------- Generator result envelope (what gateway returns to the API) ---------- */
export const UsageZ = z.object({
  inputTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  outputTokens: z.number().int(),
});
export type Usage = z.infer<typeof UsageZ>;

export interface GenerationMeta {
  generator: GeneratorId;
  variantId: string;
  model: string;               // concrete model id or "replay"
  tier: z.infer<typeof ModelTierZ>;
  promptHash: string;
  usage: Usage;
  costUsd: number;
  ttftMs: number | null;
  latencyMs: number;
  stopReason: string;          // end_turn | refusal | error | replay
  fallback: boolean;           // true when output came from the deterministic fallback
  escalatedFrom: string | null;
}
export interface GenerationResult<T> { output: T; meta: GenerationMeta }

/** World bible seed format produced by G9 at build time (packages/llm/src/worlds) */
export const WorldSeedZ = z.object({
  slug: z.string(),
  difficulty: z.number().int().min(1).max(3),
  title: z.record(LocaleZ, z.string()),
  scenario: z.record(LocaleZ, z.string()),
  bible: z.record(LocaleZ, z.string()),          // full text incl. cast cards; >= 4096 tokens each
  cast: z.array(CharacterCardZ.extend({ card: z.record(LocaleZ, z.string()), intro: z.record(LocaleZ, z.string()), canBeFirstFollower: z.boolean().default(true), avatarKey: z.string() })),
  presetPersonas: z.array(z.object({ handle: z.string(), displayName: z.record(LocaleZ, z.string()), bio: z.record(LocaleZ, z.string()), avatarKey: z.string() })),
  presetEvents: z.array(z.object({ title: z.record(LocaleZ, z.string()), prompt: z.record(LocaleZ, z.string()), choices: z.array(z.object({ label: z.record(LocaleZ, z.string()), outcomeText: z.record(LocaleZ, z.string()), statDeltas: StatDeltasZ })).length(3) })).min(5),
  fallbackReplies: z.record(z.string(), z.record(LocaleZ, z.array(z.string()).min(5))),   // handle -> locale -> 5 lines
  ambientPool: z.record(LocaleZ, z.array(z.object({ handle: z.string(), text: z.string().max(280) })).min(20)),  // seeded AmbientPost rows
  welcomePosts: z.record(z.string(), z.record(LocaleZ, z.string())),                    // handle -> locale -> welcome post (fallback for first post)
});
export type WorldSeed = z.infer<typeof WorldSeedZ>;
