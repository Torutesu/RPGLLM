/**
 * **Exit 3 — make the twenty minutes shorter** (gtm.md §2.3).
 *
 * `docs/moderation.md` §2 tells a reviewer to read the complaints, then the bible in two locales,
 * then eight cast cards. Twenty minutes. Most of that is spent *finding* the two or three sentences
 * the decision actually turns on. This puts those sentences at the top of the card, against the
 * rule they bear on, with a confidence and the passage they came from.
 *
 * The design is four constraints:
 *
 *  1. **Advice, never a verdict.** No code path reads a digest to decide anything — not the queue
 *     order, not the sampling draw, not the decision endpoint. Grep `reviewDigest` and the only
 *     readers are this file and the serialiser. A world with a `high` on every rule still waits for
 *     a person; a world with an empty digest is not thereby approved.
 *  2. **Computed once, at submission, and stored.** The text of a world never changes after it is
 *     generated, so recomputing per queue read would be the same answer at N times the cost — and a
 *     queue that got slower as it got longer is a queue nobody works.
 *  3. **Optional at every point.** The column is nullable, the read is a `safeParse`, and the queue
 *     renders `digest: null` for a world that has none — worlds submitted before this existed, and
 *     worlds whose extraction could not run. A reviewer with no digest is a reviewer doing exactly
 *     what they did last week.
 *  4. **It works today, and gets better without an edit here.** `packages/llm` owns the policy
 *     (`reviewDigest`: the offline measurement, the model half, the merge, the timeout, the three
 *     result shapes). It is **feature-detected**, exactly as `services/g9.ts` detects `g9` and
 *     `screenPremiseDeep` — and behind it sits `review-digest-rules.ts`, a local deterministic
 *     extraction that needs no gateway, no seed and no network. Order of preference:
 *
 *       - `reviewDigest` present **and** this world has a stored `WorldSeed` → its answer;
 *       - it could not produce one (`digest: null`) → the local extraction, so a reviewer is never
 *         left with less than the free answer;
 *       - it is not there at all (an older `@rpgllm/llm`) → the local extraction.
 *
 * **The model half is asked for only when a person is actually going to read the world** — never
 * for a submission the sampling draw sent straight to the shelf. Paying a model to advise a
 * reviewer who does not exist is the cost this whole feature is here to remove. The package's
 * *offline* half is free (`build-notes.md` §8.2: ~30 ms, no gateway), so a sampled submission still
 * gets it — through the same entry point, with the gateway's mode reported as `replay`, which is
 * how `reviewDigest` is told to skip the call. A world that goes live unread and is later pulled
 * therefore arrives in the queue with a real digest rather than with nothing.
 */
import type { Gateway } from "@rpgllm/llm";
import { ReviewDigestZ } from "@rpgllm/shared";
import type { Locale, WorldGenre, WorldSeed } from "@rpgllm/shared";
import type { PrismaClient, World, WorldCharacter } from "@prisma/client";
import type { z } from "zod";
import { logLine } from "../middleware/request-log";
import { logGeneration } from "./generation";
import { getWorldSeed } from "./world-seeds";
import { extractPoints, type DigestCharacter } from "./review-digest-rules";
import type { Deps } from "../types";

export type ReviewDigest = z.infer<typeof ReviewDigestZ>;

/* ------------------------------------------------------- the optional generator ---- */

/**
 * The slice of `@rpgllm/llm`'s `reviewDigest` this calls, declared structurally so the API compiles
 * against a version of the package that does not export it. Same seam as `deepPremiseScreenFrom`.
 */
export interface DigestArgs {
  world: WorldSeed;
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  sampled: boolean;
  at: string;
}
export interface DigestResult {
  digest: ReviewDigest | null;
  model?: string;
  meta?: unknown;
}
export type DigestFn = (gateway: unknown, args: DigestArgs) => Promise<DigestResult>;

/** `reviewDigest` from `@rpgllm/llm` when it exists **and** the gateway can serve it, else null. */
export function digestFnFrom(mod: unknown, gateway: Gateway): DigestFn | null {
  const fn = (mod as { reviewDigest?: unknown } | null | undefined)?.reviewDigest;
  const servable = typeof (gateway as unknown as { g9Digest?: unknown }).g9Digest === "function";
  return typeof fn === "function" && servable ? (fn as DigestFn) : null;
}

/* ------------------------------------------------------------------ building ---- */

const asCharacters = (rows: readonly WorldCharacter[]): DigestCharacter[] =>
  rows.map((ch) => ({
    handle: ch.handle,
    displayName: ch.displayName,
    role: ch.role,
    roleLocalized: ch.roleLocalized,
    card: ch.card,
  }));

/**
 * The local floor: deterministic, free, and the whole digest when nothing better is available.
 *
 * `generatedAt` is null exactly when `points` is empty — the contract's own reading, and the
 * honest one. "We looked and found nothing" is a fact about the extraction, and a reviewer must
 * not be shown a reassuring timestamp over it.
 */
export function localDigest(
  world: Pick<World, "premise" | "title" | "scenario" | "bible">,
  characters: readonly WorldCharacter[],
  at: string,
  sampled: boolean,
): ReviewDigest {
  const points = extractPoints(world, asCharacters(characters));
  return { points, generatedAt: points.length > 0 ? at : null, sampled };
}

export interface BuildDigestOptions {
  /** true when this world is in the queue because the sampling draw put it there */
  sampled: boolean;
  /** false for a submission nobody will read — the **model** half is not worth paying for */
  enrich: boolean;
  actorId: string | null;
}

/**
 * The gateway with its mode reported as `replay`, which is how `@rpgllm/llm`'s `reviewDigest` is
 * asked for the offline measurement and no model call. `g9Digest` is still passed through: it is
 * simply never reached, and a wrapper that dropped it would fail the package's own probe.
 */
const offlineOnly = (gateway: Gateway): unknown => ({
  mode: () => "replay",
  g9Digest: (input: unknown) => (gateway as unknown as { g9Digest: (i: unknown) => unknown }).g9Digest(input),
});

/**
 * The digest as stored on the row. Never throws and never blocks a submission: a generator that is
 * missing, slow past its own timeout, or answers with something the contract does not describe
 * leaves the deterministic digest standing.
 */
export async function buildDigest(
  deps: Deps,
  world: Pick<World, "id" | "slug" | "premise" | "genre" | "genLocale" | "title" | "scenario" | "bible">,
  characters: readonly WorldCharacter[],
  opts: BuildDigestOptions,
): Promise<ReviewDigest> {
  const at = deps.clock.now().toISOString();
  const local = localDigest(world, characters, at, opts.sampled);

  const generate = await loadDigestFn(deps.gateway);
  if (!generate) return local;
  const seed = await getWorldSeed(world.slug, deps.prisma);
  // No stored seed (a preset, or a row written before seeds were kept) — the package's entry point
  // takes a `WorldSeed` and there is nothing honest to synthesise, so the local answer stands.
  if (!seed) return local;

  try {
    const result = await generate(opts.enrich ? deps.gateway : offlineOnly(deps.gateway), {
      world: seed,
      premise: world.premise,
      genre: (world.genre || "fame") as WorldGenre,
      locale: (world.genLocale ?? "en") as Locale,
      sampled: opts.sampled,
      at,
    });
    // CLAUDE.md rule 5: a call that reached the gateway gets a `GenerationLog` row. The package
    // hands back the meta when it made one and null when it stayed offline.
    if (isMeta(result.meta)) await logGeneration(deps.prisma, result.meta, opts.actorId);
    const parsed = ReviewDigestZ.safeParse(result.digest);
    // "It could not run" is `digest: null`. A reviewer must not end up with less than the free
    // answer because the paid one was unavailable.
    return parsed.success ? parsed.data : local;
  } catch (err: unknown) {
    logLine({ level: "warn", msg: "world.digest.generator_failed", worldId: world.id, reason: (err as Error).message });
    return local;
  }
}

/** `logGeneration` takes a `GenerationMeta`; anything else from an unknown package version is not one. */
const isMeta = (value: unknown): value is Parameters<typeof logGeneration>[1] =>
  Boolean(value) && typeof value === "object" && "generator" in (value as object);

/** Imported defensively, exactly like every other `@rpgllm/llm` symbol the API reaches for. */
async function loadDigestFn(gateway: Gateway): Promise<DigestFn | null> {
  try {
    return digestFnFrom(await import("@rpgllm/llm"), gateway);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- reading ---- */

/**
 * The digest on a row, or `null`. A column that is absent, or that holds something the contract
 * does not describe, is the same answer as never having had one — the queue is workable either way,
 * and a reviewer is never shown a half-parsed digest.
 */
export function storedDigest(world: Pick<World, "reviewDigest">): ReviewDigest | null {
  if (world.reviewDigest === null || world.reviewDigest === undefined) return null;
  const parsed = ReviewDigestZ.safeParse(world.reviewDigest);
  return parsed.success ? parsed.data : null;
}

/** The row patch that stores one, written in the same transaction as the submission it describes. */
export const digestPatch = (digest: ReviewDigest, now: Date): { reviewDigest: object; reviewDigestAt: Date } => ({
  reviewDigest: digest,
  reviewDigestAt: now,
});

/** For the metrics surface: how many queued worlds carry advice at all. */
export const countWithDigest = (prisma: PrismaClient): Promise<number> =>
  prisma.world.count({ where: { status: "review", reviewDigestAt: { not: null } } });
