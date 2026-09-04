import type { GeneratorId, ModelTier } from "@rpgllm/shared";
import { fnv1a } from "./tokens.js";

/**
 * Experiment registry (cost-architecture 6.1). MVP allocation is fixed 50/50 and
 * **user-sticky**: hash(experimentKey + userId). Thompson sampling lands in Phase 1.
 *
 * Two families live in the same registry so the API can serve one
 * `/experiments/assignments` payload:
 *   - generator experiments, keyed by the lowercase generator id ("g1", "g4", ...)
 *   - product experiments ("paywall_trial", "paywall_adfree")
 */

export interface GeneratorVariant {
  id: string;
  generator: GeneratorId;
  tier: ModelTier;
  /** max_tokens backstop for this variant (cost-architecture 3.2) */
  maxTokens: number;
}

export interface GeneratorExperiment {
  key: string;
  generator: GeneratorId;
  /** index 0 is the champion */
  variants: GeneratorVariant[];
}

export const GENERATOR_EXPERIMENTS: readonly GeneratorExperiment[] = [
  {
    key: "g1",
    generator: "G1",
    variants: [
      { id: "g1-sonnet-v1", generator: "G1", tier: "mid", maxTokens: 1200 },
      { id: "g1-haiku-v1", generator: "G1", tier: "light", maxTokens: 1200 },
    ],
  },
  {
    key: "g4",
    generator: "G4",
    variants: [{ id: "g4-sonnet-v1", generator: "G4", tier: "mid", maxTokens: 400 }],
  },
  {
    key: "g5",
    generator: "G5",
    variants: [{ id: "g5-opus-v1", generator: "G5", tier: "high", maxTokens: 2000 }],
  },
  {
    key: "g7",
    generator: "G7",
    variants: [{ id: "g7-haiku-v1", generator: "G7", tier: "light", maxTokens: 900 }],
  },
  {
    key: "g8",
    generator: "G8",
    variants: [{ id: "g8-haiku-v1", generator: "G8", tier: "light", maxTokens: 64 }],
  },
] as const;

/**
 * Product experiments. Index 0 is the control and the value a null user (system job) gets.
 * Variant ids are the exact strings apps/api parses in `GET /v1/billing/offerings`
 * (build-notes, Agent A #13): a `paywall_trial` value containing "7" means trialDays 7, and a
 * `paywall_adfree` value matching /on|show|true/i shows the ad-free SKU.
 */
export const PRODUCT_EXPERIMENTS: Readonly<Record<string, readonly string[]>> = {
  paywall_trial: ["trial_0", "trial_7"],
  paywall_adfree: ["adfree_off", "adfree_on"],
};

const BY_GENERATOR = new Map<GeneratorId, GeneratorExperiment>(
  GENERATOR_EXPERIMENTS.map((e) => [e.generator, e]),
);
const BY_VARIANT_ID = new Map<string, GeneratorVariant>(
  GENERATOR_EXPERIMENTS.flatMap((e) => e.variants.map((v) => [v.id, v] as const)),
);

function championOf(exp: GeneratorExperiment): GeneratorVariant {
  const first = exp.variants[0];
  if (!first) throw new Error(`experiment ${exp.key} has no variants`);
  return first;
}

/** Deterministic, user-sticky allocation. `null` user (system jobs) always gets the champion. */
export function assignIndex(key: string, userId: string | null, size: number): number {
  if (size <= 1) return 0;
  if (userId === null || userId === "") return 0;
  return fnv1a(`${key}:${userId}`) % size;
}

/** Variant used for a generator call. `variantId` (escalation/regeneration) wins when given. */
export function variantFor(
  generator: GeneratorId,
  userId: string | null,
  variantId?: string,
): GeneratorVariant {
  if (variantId) {
    const forced = BY_VARIANT_ID.get(variantId);
    if (forced) return forced;
  }
  const exp = BY_GENERATOR.get(generator);
  if (!exp) {
    // generators without a registered experiment fall back to a mid-tier pseudo-variant
    return { id: `${generator.toLowerCase()}-default`, generator, tier: "mid", maxTokens: 1000 };
  }
  return exp.variants[assignIndex(exp.key, userId, exp.variants.length)] ?? championOf(exp);
}

/** All experiment keys -> assigned value, for `GET /experiments/assignments`. */
export function assignmentsFor(userId: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const exp of GENERATOR_EXPERIMENTS) {
    const variant = exp.variants[assignIndex(exp.key, userId, exp.variants.length)] ?? championOf(exp);
    out[exp.key] = variant.id;
  }
  for (const [key, values] of Object.entries(PRODUCT_EXPERIMENTS)) {
    out[key] = values[assignIndex(key, userId, values.length)] ?? values[0] ?? "0";
  }
  return out;
}

/** generator id -> champion variant id. */
export function championVariants(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const exp of GENERATOR_EXPERIMENTS) out[exp.generator] = championOf(exp).id;
  return out;
}

/** Tier one step up, used by the thumbs-down escalation path (spec 5.2). */
export function escalateTier(tier: ModelTier): ModelTier {
  return tier === "light" ? "mid" : "high";
}

/** Concrete model id for a tier. Read from env at call time so tests can swap it. */
export function modelForTier(tier: ModelTier): string {
  switch (tier) {
    case "high":
      return process.env.LLM_MODEL_HIGH ?? "claude-opus-5";
    case "mid":
      return process.env.LLM_MODEL_MID ?? "claude-sonnet-5";
    case "light":
    default:
      return process.env.LLM_MODEL_LIGHT ?? "claude-haiku-4-5";
  }
}
