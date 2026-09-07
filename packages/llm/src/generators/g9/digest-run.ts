import {
  ReviewDigestZ,
  ReviewPointZ,
  type GenerationMeta,
  type GenerationResult,
  type Locale,
  type WorldGenre,
  type WorldSeed,
} from "@rpgllm/shared";
import type { z } from "zod";
import { measuredPoints, worldPassages, type ReviewPoint } from "./digest-offline.js";
import {
  capPoints,
  worldChars,
  worldExcerpt,
  type DigestInput,
  type DigestOutput,
} from "./digest.js";

/**
 * G9 — building one review digest (docs/moderation.md §3).
 *
 * ```
 *   world ──▶ measuredPoints()          offline, free, deterministic, always runs
 *               │
 *               ├── live? ──▶ gateway.g9Digest()   one mid-tier call, policy prefix cached
 *               │                 │ ok        ─▶ measured + model points, capped
 *               │                 │ nothing   ─▶ measured points alone
 *               │                 └ could not ─▶ measured points alone, or NO DIGEST
 *               └── replay/fail ─▶ measured points alone
 * ```
 *
 * ## The three shapes, and why there are three
 *
 * `ReviewDigestZ` is nullable in the queue row and its `generatedAt` is nullable inside it. That
 * is not two kinds of missing by accident — it is exactly the room needed to keep rule 4 ("silence
 * is a fact, not a pass") from being unwriteable:
 *
 * | what happened | queue row | digest |
 * |---|---|---|
 * | it ran and found things | `digest` set | `points` non-empty, `generatedAt` set |
 * | it ran and extracted nothing | `digest` set | `points` empty, `generatedAt` **null** |
 * | it could not run at all | `digest` **null** | — |
 *
 * A reviewer who sees an empty digest is being told "nothing was extracted from this world", and a
 * reviewer who sees no digest is being told "nothing looked at this world". Neither says the world
 * is clean, and neither can be turned into "skip this one" by a client that only checks whether the
 * list is empty — because the empty list is a state the client has to render, not a falsy value it
 * can drop. `generatedAt` is null in that state so a UI cannot print a reassuring timestamp over
 * a digest that found nothing.
 *
 * ## The clock
 *
 * `at` is a parameter. Nothing in `packages/llm` reads a clock — the prompt renderers say so
 * explicitly — and a digest that stamped itself would be non-deterministic in replay, which the
 * API's tests and the E2E suite depend on not being. The caller owns the timestamp.
 */

export type ReviewDigest = z.infer<typeof ReviewDigestZ>;

/** What the model half did, including why it did nothing. Mirrors `PremiseModelStatus`. */
export type DigestModelStatus = "skipped" | "ok" | "empty" | "error";

/** How much of the world the model was shown. Reported, because it read a sample. */
export interface DigestCoverage {
  /** characters of the excerpt the model was given */
  excerptChars: number;
  /** characters of the whole world seed */
  worldChars: number;
  /** quotable passages the offline pass read — it reads all of them */
  passages: number;
}

export interface ReviewDigestResult {
  /** null when no digest could be produced at all; see the table above */
  digest: ReviewDigest | null;
  model: DigestModelStatus;
  /** the model call's meta when one was made — cost, tokens, latency, stop reason */
  meta: GenerationMeta | null;
  measuredCount: number;
  modelCount: number;
  /** points that survived the caps, i.e. what the reviewer actually sees */
  shownCount: number;
  coverage: DigestCoverage;
}

/**
 * The slice of the gateway this needs, declared structurally so this module does not depend on
 * `gateway.ts` (which imports the studio) and so a test can drive it with a two-method stub
 * instead of an API key. Same seam as `screen-deep.ts`.
 */
export interface ReviewDigestGateway {
  mode(): "replay" | "live" | "fail";
  g9Digest(input: DigestInput): Promise<GenerationResult<DigestOutput>>;
}

export interface ReviewDigestArgs {
  world: WorldSeed;
  premise: string;
  genre: WorldGenre;
  /** the locale the creator wrote in */
  locale: Locale;
  /**
   * The API's audit-sample decision (`WORLD_MODERATION.TRUST_SAMPLE_EVERY`): this world is to be
   * read end to end whatever the digest says. Carried through the digest rather than beside it so
   * a surface cannot render one without the other — a shortened review of a world that was drawn
   * for a full read is the one failure this flag exists to prevent.
   */
  sampled: boolean;
  /** ISO timestamp for `generatedAt`. Required: nothing here reads a clock. */
  at: string;
  /** hard ceiling on the model half. It is off the reviewer's path, but not off every path. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function timeoutMsOf(args: ReviewDigestArgs): number {
  if (args.timeoutMs !== undefined) return Math.max(1, args.timeoutMs);
  const raw = process.env.LLM_REVIEW_DIGEST_TIMEOUT_MS;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
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

/**
 * Assemble the stored contract from a list of points.
 *
 * The one invariant it enforces in both directions: `points` is empty **iff** `generatedAt` is
 * null. Pure, and exported so a test can hold it without a gateway.
 */
export function toReviewDigest(
  points: readonly ReviewPoint[],
  opts: { sampled: boolean; at: string },
): ReviewDigest {
  const capped = capPoints(points);
  return {
    points: capped,
    generatedAt: capped.length === 0 ? null : opts.at,
    sampled: opts.sampled,
  };
}

/**
 * Build the digest for one world. Never throws, never rejects: every failure mode resolves to one
 * of the three shapes above and says which.
 */
export async function reviewDigest(
  gateway: ReviewDigestGateway,
  args: ReviewDigestArgs,
): Promise<ReviewDigestResult> {
  const measured = measuredPoints(args.world);
  const input: DigestInput = {
    world: args.world,
    premise: args.premise,
    genre: args.genre,
    locale: args.locale,
    measured,
  };
  const coverage: DigestCoverage = {
    excerptChars: worldExcerpt(input).length,
    worldChars: worldChars(args.world),
    passages: worldPassages(args.world).length,
  };

  const finish = (
    points: readonly ReviewPoint[],
    model: DigestModelStatus,
    meta: GenerationMeta | null,
    modelCount: number,
  ): ReviewDigestResult => {
    // "It could not run and found nothing" is not an empty digest, it is no digest.
    const digest =
      model === "error" && points.length === 0
        ? null
        : toReviewDigest(points, { sampled: args.sampled, at: args.at });
    return {
      digest,
      model,
      meta,
      measuredCount: measured.length,
      modelCount,
      shownCount: digest?.points.length ?? 0,
      coverage,
    };
  };

  let mode: string;
  try {
    mode = gateway.mode();
  } catch {
    mode = "replay";
  }
  // Offline mode keeps the product deterministic: the model half is a no-op, and the digest is
  // exactly what a measurement can establish. That is a real digest, not a degraded one.
  if (mode === "replay") return finish(measured, "skipped", null, 0);

  let res: GenerationResult<DigestOutput> | null = null;
  try {
    res = await withTimeout(gateway.g9Digest(input), timeoutMsOf(args));
  } catch {
    res = null;
  }
  if (res === null || res === undefined) return finish(measured, "error", null, 0);

  const meta = res.meta;
  // The gateway never throws; a failed call arrives as the spec's fallback with `fallback: true`.
  if (meta.fallback) return finish(measured, "error", meta, 0);

  // `postprocess` has already mapped every survivor onto the taxonomy; re-validating here means
  // the result is sound even for a caller that hands us a raw model output.
  const points: ReviewPoint[] = [];
  for (const p of res.output.points) {
    const parsed = ReviewPointZ.safeParse(p);
    if (parsed.success) points.push(parsed.data);
  }
  const merged = capPoints([...measured, ...points]);
  return finish(merged, points.length === 0 ? "empty" : "ok", meta, points.length);
}
