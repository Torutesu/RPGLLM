import { LOCALES, WORLD_GENRES, type Locale, type WorldGenre } from "@rpgllm/shared";
import { frozenEvalCasesG9, type G9EvalCaseSpec } from "../eval-cases-g9.js";
import type { EvalCaseRun } from "../eval-core.js";
import { G9InputZ, type G9Input } from "../generators/g9/types.js";

/**
 * What a run is going to do, decided before a single token is spent.
 *
 * The set is the frozen G9 eval set (`eval-cases-g9.ts`) — the same eighteen cases the offline
 * gate uses, so a live number and a replay number are about the same premises — filtered, never
 * rewritten. Two rules govern the filtering:
 *
 *  - **genre pairs are indivisible.** Question 2 ("do two premises in one genre make two worlds")
 *    is only answerable when both halves of a genre are in the run, so `--genres` selects genres
 *    and never half of one. A locale filter would break the same pairing, which is why there
 *    isn't one: the pair is EN + JA by construction.
 *  - **the hard cases are opt-out, not opt-in.** They are the two that catch premise echo and
 *    the 400-character ceiling, and they are the cheapest insurance in the set.
 */

export interface PlanOptions {
  /** genres to include; empty or absent means all eight */
  genres?: readonly WorldGenre[];
  /** include the two hard cases (echo bait, at the limit). Default true. */
  hard?: boolean;
  /** cap the number of genre pairs, after filtering. `1` is the smoke test. */
  maxPairs?: number;
}

export interface VerifyPlan {
  cases: G9EvalCaseSpec[];
  genres: WorldGenre[];
  locales: readonly Locale[];
  worlds: number;
  /** 14 model calls per world, plus one judgement each */
  generatorCalls: number;
  judgeCalls: number;
}

export const CALLS_PER_WORLD = 14;

export function isWorldGenre(v: string): v is WorldGenre {
  return (WORLD_GENRES as readonly string[]).includes(v);
}

export function planRun(opts: PlanOptions = {}): VerifyPlan {
  const wanted = new Set<WorldGenre>(
    opts.genres === undefined || opts.genres.length === 0 ? WORLD_GENRES : opts.genres,
  );
  const all = frozenEvalCasesG9();

  const genreCases = all.filter((c) => c.label.startsWith("genre:"));
  const hardCases = all.filter((c) => c.label.startsWith("hard:"));

  const byGenre = new Map<WorldGenre, G9EvalCaseSpec[]>();
  for (const c of genreCases) {
    const input = G9InputZ.safeParse(c.input);
    if (!input.success || !wanted.has(input.data.genre)) continue;
    const list = byGenre.get(input.data.genre) ?? [];
    list.push(c);
    byGenre.set(input.data.genre, list);
  }

  const orderedGenres = WORLD_GENRES.filter((g) => byGenre.has(g));
  const limit = opts.maxPairs === undefined ? orderedGenres.length : Math.max(1, opts.maxPairs);
  const chosenGenres = orderedGenres.slice(0, limit);

  const cases: G9EvalCaseSpec[] = [];
  for (const g of chosenGenres) cases.push(...(byGenre.get(g) ?? []));
  if (opts.hard !== false) {
    for (const h of hardCases) {
      const input = G9InputZ.safeParse(h.input);
      if (input.success && wanted.has(input.data.genre)) cases.push(h);
    }
  }

  return {
    cases,
    genres: [...chosenGenres],
    locales: LOCALES,
    worlds: cases.length,
    generatorCalls: cases.length * CALLS_PER_WORLD,
    judgeCalls: cases.length,
  };
}

/** The gate's own case shape. `worldSlug` and `locale` come straight off the frozen spec. */
export function toEvalCases(plan: VerifyPlan): EvalCaseRun[] {
  return plan.cases.map((c) => ({
    key: c.key,
    label: c.label,
    locale: c.locale,
    worldSlug: c.worldSlug,
    input: c.input,
  }));
}

export function inputOf(spec: G9EvalCaseSpec): G9Input {
  return spec.input;
}
