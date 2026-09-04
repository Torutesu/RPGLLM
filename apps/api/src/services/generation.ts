import type { PrismaClient, SafetyVerdict } from "@prisma/client";
import type { GenerationMeta, GeneratorId, ModelTier } from "@rpgllm/shared";
import { modelForTier } from "../env";

/**
 * GenerationLog is written route-side, right after each gateway call, using `result.meta`.
 * (The gateway's `onGeneration` hook is intentionally NOT wired — using both would double-log and
 * break E2E-013, which expects exactly one G1 row per post. See build-notes "Agent A".)
 */
export async function logGeneration(
  prisma: PrismaClient,
  meta: GenerationMeta,
  userId: string | null,
  safetyVerdict: SafetyVerdict | null = null,
): Promise<string> {
  const row = await prisma.generationLog.create({
    data: {
      userId,
      generator: meta.generator as GeneratorId,
      variantId: meta.variantId,
      model: meta.model,
      promptHash: meta.promptHash,
      inputTokens: meta.usage.inputTokens,
      cacheWriteTokens: meta.usage.cacheWriteTokens,
      cacheReadTokens: meta.usage.cacheReadTokens,
      outputTokens: meta.usage.outputTokens,
      costUsd: meta.costUsd.toFixed(6),
      ttftMs: meta.ttftMs,
      latencyMs: meta.latencyMs,
      stopReason: meta.stopReason,
      safetyVerdict,
      escalatedFrom: meta.escalatedFrom,
    },
    select: { id: true },
  });
  return row.id;
}

const TIER_ORDER: ModelTier[] = ["light", "mid", "high"];

/** GenerationLog has no `tier` column, so derive it from the model id (env-driven, never hardcoded). */
export function tierFromModel(model: string, fallback: ModelTier): ModelTier {
  for (const tier of TIER_ORDER) if (modelForTier(tier) === model) return tier;
  const m = model.toLowerCase();
  if (m.includes("opus")) return "high";
  if (m.includes("sonnet")) return "mid";
  if (m.includes("haiku")) return "light";
  return fallback;
}

export function escalateTier(tier: ModelTier): ModelTier {
  const i = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.min(i + 1, TIER_ORDER.length - 1)] ?? "high";
}
