import type { SafetyVerdict } from "@prisma/client";
import type { G8Input } from "@rpgllm/shared";
import { logGeneration } from "./generation";
import type { Deps } from "../types";

/**
 * AIF-013 (G8). Runs before every post/DM creation.
 * The GenerationLog row is written even when the verdict is `block` (E2E-009).
 */
export async function safetyGate(
  deps: Deps,
  input: G8Input,
  userId: string,
): Promise<{ verdict: SafetyVerdict; generationId: string }> {
  const result = await deps.gateway.g8(input);
  const verdict = result.output.verdict as SafetyVerdict;
  const generationId = await logGeneration(deps.prisma, result.meta, userId, verdict);
  return { verdict, generationId };
}
