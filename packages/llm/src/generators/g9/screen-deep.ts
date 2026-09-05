import type { GenerationMeta, GenerationResult, Locale } from "@rpgllm/shared";
import { screenPremise, type PremiseScreenResult } from "./screen.js";
import { coerceCategory, type G9ScreenInput, type G9ScreenOutput } from "./screen-model.js";

/**
 * G9 — the two-layer premise screen (AIF-003).
 *
 * ```
 *   premise ──▶ layer 1  screenPremise()          deterministic, free, offline, always runs
 *                  │ block ─────────────────────▶ BLOCK   (the model is never called)
 *                  ▼ allow
 *               layer 2  gateway.g9Screen()       light tier, ~250-token prefix, live mode only
 *                  │ block ─────────────────────▶ BLOCK
 *                  │ allow ─────────────────────▶ ALLOW
 *                  └ could not answer ──────────▶ the failure policy below
 * ```
 *
 * The layers are **ANDed**: layer 2 can only ever take an allow away, never give one back. That is
 * enforced structurally rather than by convention — when layer 1 blocks, this function returns
 * before the gateway is touched, so there is no code path in which a model response can overwrite
 * a deterministic block.
 *
 * ## What happens when the model cannot answer
 *
 * | what happened                       | `model`   | verdict                                  |
 * |-------------------------------------|-----------|------------------------------------------|
 * | not live mode (replay / fail)       | `skipped` | layer 1's — the second layer is a no-op   |
 * | premise is empty after sanitising   | `skipped` | layer 1's                                 |
 * | model said allow                    | `allow`   | allow                                     |
 * | model said block                    | `block`   | **block**, category from the taxonomy     |
 * | model refused the request           | `refused` | **block** — see below                     |
 * | timeout / transport error / 5xx     | `error`   | layer 1's, unless `failClosed`            |
 * | junk that failed the schema twice   | `error`   | layer 1's, unless `failClosed`            |
 *
 * A **refusal is evidence about the premise**: the model declined to classify this specific text,
 * which is a judgement about the text and not about the network, so it becomes a block. An
 * **infrastructure failure is evidence about nothing**. Turning a provider outage into "no world
 * can be created" is a self-inflicted denial of service, and the premise has still passed layer 1,
 * still goes through prompts that carry the fleet-wide safety block, still faces G8 on every
 * in-game action, and still needs human review before it can be published (`WORLD_MODERATION`).
 * So the default on an infrastructure failure is to degrade to exactly today's behaviour — layer 1
 * alone — and to say so in the result. An operator who wants the other trade-off sets
 * `LLM_PREMISE_SCREEN_ON_ERROR=block` (or passes `failClosed: true`) and every creation stops
 * while the light tier is down.
 *
 * Either way the result carries `layer` and `model`, so the caller logs which layer decided and
 * the dashboard can see a run of `error` for what it is.
 */

export type PremiseScreenLayer = "deterministic" | "model";
export type PremiseModelStatus = "skipped" | "allow" | "block" | "refused" | "error";

export interface PremiseScreenDeepResult extends PremiseScreenResult {
  /** which layer produced `verdict`; `deterministic` also covers a degraded second layer */
  layer: PremiseScreenLayer;
  /** what the second layer did, including why it did nothing */
  model: PremiseModelStatus;
  /** the model call's `GenerationMeta` when one was made — cost, tokens, latency, stop reason */
  meta: GenerationMeta | null;
}

/**
 * The slice of the gateway this needs. Declared structurally rather than imported so this module
 * does not depend on `gateway.ts` (which imports the studio) — and so a test can drive it with a
 * two-method stub instead of an API key.
 */
export interface PremiseScreenGateway {
  mode(): "replay" | "live" | "fail";
  g9Screen(input: G9ScreenInput): Promise<GenerationResult<G9ScreenOutput>>;
}

export interface PremiseScreenDeepOptions {
  /** hard ceiling on the second layer; it runs on a user-visible path. Default 4000ms. */
  timeoutMs?: number;
  /** block instead of degrading when the model could not answer. Default from env, else false. */
  failClosed?: boolean;
}

const DEFAULT_TIMEOUT_MS = 4000;

function timeoutMsOf(opts: PremiseScreenDeepOptions): number {
  if (opts.timeoutMs !== undefined) return Math.max(1, opts.timeoutMs);
  const raw = process.env.LLM_PREMISE_SCREEN_TIMEOUT_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function failClosedOf(opts: PremiseScreenDeepOptions): boolean {
  if (opts.failClosed !== undefined) return opts.failClosed;
  return (process.env.LLM_PREMISE_SCREEN_ON_ERROR ?? "allow").toLowerCase() === "block";
}

/** Resolves to `null` when the promise has not settled in time. Never rejects, never leaks a timer. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function deterministic(first: PremiseScreenResult, model: PremiseModelStatus): PremiseScreenDeepResult {
  return { verdict: first.verdict, category: first.category, layer: "deterministic", model, meta: null };
}

/**
 * Screen a player-written premise with both layers. Never throws, never rejects: every failure
 * mode resolves to a verdict and says which layer produced it.
 *
 * `screenPremise` (layer 1, synchronous) stays exported and unchanged — apps/api calls it today and
 * its tests pin it. This is the strictly-stronger async form for callers that can await.
 */
export async function screenPremiseDeep(
  gateway: PremiseScreenGateway,
  premise: string,
  locale: Locale,
  opts: PremiseScreenDeepOptions = {},
): Promise<PremiseScreenDeepResult> {
  const first = screenPremise(premise, locale);
  // Layer 1 has the first and final word on a block: the model is not called, and cannot loosen it.
  if (first.verdict === "block") return deterministic(first, "skipped");

  let mode: string;
  try {
    mode = gateway.mode();
  } catch {
    mode = "replay";
  }
  // Offline modes keep the whole product deterministic: the second layer is a no-op there.
  if (mode !== "live") return deterministic(first, "skipped");
  if ((premise ?? "").trim().length === 0) return deterministic(first, "skipped");

  let res: GenerationResult<G9ScreenOutput> | null = null;
  try {
    res = await withTimeout(gateway.g9Screen({ premise, locale }), timeoutMsOf(opts));
  } catch {
    res = null;
  }

  // Timed out, or the gateway resolved to nothing at all.
  if (res === null || res === undefined) {
    return failClosedOf(opts)
      ? { verdict: "block", category: null, layer: "model", model: "error", meta: null }
      : deterministic(first, "error");
  }

  const meta = res.meta;

  // The gateway never throws; a failed call arrives as the spec's fallback with `fallback: true`.
  if (meta.fallback) {
    const refused = meta.stopReason === "refusal";
    if (refused) return { verdict: "block", category: null, layer: "model", model: "refused", meta };
    return failClosedOf(opts)
      ? { verdict: "block", category: null, layer: "model", model: "error", meta }
      : { verdict: first.verdict, category: first.category, layer: "deterministic", model: "error", meta };
  }

  if (res.output.verdict === "block") {
    // The gateway's `postprocess` already mapped this onto the taxonomy; mapping it again here
    // means the public result is valid even for a caller that hands us a raw model output.
    return { verdict: "block", category: coerceCategory(res.output.category), layer: "model", model: "block", meta };
  }
  // An allow from the model is only ever an agreement with layer 1 — it is already an allow here.
  return { verdict: "allow", category: null, layer: "model", model: "allow", meta };
}
