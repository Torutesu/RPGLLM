import { BATCHABLE_GENERATORS } from "@rpgllm/shared";
import type { G7Input, G7Output } from "@rpgllm/shared";
import type { BatchItem, BatchResults, Gateway } from "./gateway.js";
import type { G2Input, G2Output } from "./generators/g2.js";
import type { G10Input, G10Output } from "./generators/g10.js";
import type { GJInput, GJOutput } from "./generators/gj.js";

/**
 * The four §5.4 batch jobs, named the way the scheduler talks about them.
 *
 * `BATCHABLE_GENERATORS` is `["G2", "G7", "G10", "GJ"]` — ambient refill, memory consolidation,
 * the offline director and the judge. Nobody is waiting on any of them, so every one is worth 50%.
 * These wrappers exist so the scheduler (`apps/api/src/jobs/**`, Agent O) never has to know which
 * generator id a job maps to, and so a job cannot accidentally be written as N interactive calls:
 * each takes the whole day's work at once and returns it keyed by the caller's own id.
 *
 *   const results = await runAmbientRefillBatched(gateway, worlds.map((w) => ({
 *     customId: `${w.id}:${locale}`, input: ambientInput(w, locale, n),
 *   })));
 *   for (const [id, r] of results) if (!r.meta.fallback) writePosts(id, r.output.posts);
 *
 * Every entry always resolves (a failed one carries the generator's fallback with
 * `meta.fallback = true`), so a job never has to reconcile a missing id.
 */

export const BATCH_JOBS = {
  "ambient-refill": "G2",
  "memory-consolidate": "G7",
  "offline-director": "G10",
  judge: "GJ",
} as const satisfies Record<string, (typeof BATCHABLE_GENERATORS)[number]>;

export type BatchJobName = keyof typeof BATCH_JOBS;

/** G2 — top up the shared ambient pool of every world in one batch. */
export function runAmbientRefillBatched(
  gateway: Gateway,
  items: ReadonlyArray<BatchItem<G2Input>>,
): Promise<BatchResults<G2Output>> {
  return gateway.batchG2(items);
}

/** G7 — fold every persona's loose memory notes into summaries in one batch. */
export function runMemoryConsolidationBatched(
  gateway: Gateway,
  items: ReadonlyArray<BatchItem<G7Input>>,
): Promise<BatchResults<G7Output>> {
  return gateway.batchG7(items);
}

/** G10 — "while you were away" for every absent player in one batch (AIF-001). */
export function runOfflineDirectorBatched(
  gateway: Gateway,
  items: ReadonlyArray<BatchItem<G10Input>>,
): Promise<BatchResults<G10Output>> {
  return gateway.batchG10(items);
}

/** GJ — the nightly judge (§6.2). `packages/llm/src/eval.ts` is its only caller today. */
export function runJudgeBatched(
  gateway: Gateway,
  items: ReadonlyArray<BatchItem<GJInput>>,
): Promise<BatchResults<GJOutput>> {
  return gateway.batchGJ(items);
}
