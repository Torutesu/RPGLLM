import {
  GEM_PACKS,
  WORLD_STUDIO,
  type GenerationMeta,
  type GeneratorId,
  type Locale,
  type WorldGenre,
  type WorldSeed,
} from "@rpgllm/shared";
import { round, type EvalRunResult } from "../eval-core.js";
import { distinctnessOf, g9Metrics, type G9Distinctness } from "../eval-g9.js";
import { runEval } from "../eval.js";
import { createGateway, type Gateway } from "../gateway.js";
import { deterministicWorld } from "../generators/g9/assemble.js";
import { G9InputZ, type G9Input } from "../generators/g9/types.js";
import { baseStopReason } from "../cost.js";
import {
  bilingualPanel,
  cacheHitRate,
  castDistinctnessOf,
  liveEvidenceOf,
  stageSpend,
  totalUsage,
  CAST_OVERLAP_LIMIT,
  JA_HUMAN_CHECKLIST,
  type CastDistinctness,
} from "./measure.js";
import { planRun, toEvalCases, type VerifyPlan } from "./plan.js";
import type {
  Answer,
  CastRow,
  DistinctnessReport,
  FailureRow,
  GenrePairRow,
  JapaneseReport,
  JapaneseRow,
  SpendReport,
  VerifyMode,
  VerifyReport,
} from "./types.js";
import { DISTINCTNESS_LIMITS, MAX_JA_ECHO, MIN_JA_CJK_RATIO } from "../eval-g9.js";

/**
 * The live verification harness.
 *
 * The eval gate proves a world is well-formed; it has never once been run against a real model,
 * because there is no API key in this repository's environment. Everything below exists for the
 * morning a key arrives: one command that spends real money on purpose, in a bounded amount,
 * and comes back with a page that answers the three questions replay cannot.
 *
 * Two rules shape it:
 *
 *  1. **It refuses rather than degrades.** No key, or a mode that is not `live`, is a refusal
 *     naming the environment variable — never a quiet fall-through to replay. A report that
 *     cannot be told apart from a replay report is worse than no report, so the run also *checks
 *     its own evidence* afterwards (`liveEvidenceOf`) and stamps itself NOT LIVE if any call
 *     came from the fixtures.
 *  2. **Every failure is a row, not an exception.** A refusal, a timeout, a fallback and a
 *     safety block are all *results* about live behaviour — the most interesting ones — so they
 *     land in the report's ledger and the run continues.
 */

export class VerifyRefusal extends Error {
  readonly hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = "VerifyRefusal";
    this.hint = hint;
  }
}

export const API_KEY_ENV = "ANTHROPIC_API_KEY";

/** Collects what the gateway logs. CLAUDE.md rule 5: every call is a row, evaluation included. */
export function createCollector(): {
  metas: GenerationMeta[];
  onGeneration: (meta: GenerationMeta & { userId: string | null; generator: GeneratorId }) => void;
} {
  const metas: GenerationMeta[] = [];
  return {
    metas,
    onGeneration: (meta) => {
      metas.push(meta);
    },
  };
}

/**
 * The gate before the money. Called by the CLI before anything is constructed, and again by
 * `runVerification` so a programmatic caller cannot skip it.
 */
export function preflightLive(env: NodeJS.ProcessEnv = process.env): void {
  const key = (env[API_KEY_ENV] ?? "").trim();
  if (key === "") {
    throw new VerifyRefusal(
      `${API_KEY_ENV} is not set — refusing to run.`,
      [
        `A live verification with no key would silently fall through to replay and produce a`,
        `report that looks live and is not. Set the key and run again:`,
        ``,
        `    export ${API_KEY_ENV}=sk-ant-...`,
        `    pnpm --filter llm verify:live`,
        ``,
        `To see what the report looks like without spending anything, run the rehearsal:`,
        ``,
        `    pnpm --filter llm verify:live --stub`,
      ].join("\n"),
    );
  }
  const mode = (env.LLM_MODE ?? "live").trim();
  if (mode !== "live") {
    throw new VerifyRefusal(
      `LLM_MODE=${mode} — refusing to run a "live" verification in ${mode} mode.`,
      `Unset LLM_MODE or set LLM_MODE=live. Use --stub if you meant the rehearsal.`,
    );
  }
}

/* ----------------------------------------------------------------- estimate ---- */

export interface CostEstimate {
  totalUsd: number;
  perWorldUsd: number;
  stages: ReturnType<typeof stageSpend>;
  worlds: number;
  calls: number;
}

/**
 * What the plan will cost, before it runs.
 *
 * Measured, not guessed: the identical pipeline is executed in **replay** — free, no key, no
 * network — and its token counts are priced at the real model rates (`priceOf` already prices
 * replay usage against the would-be model id, which is what makes the $/action dashboard work
 * without a key). Live output is longer and less predictable than the blueprint's, so this is a
 * floor with the right shape rather than a promise; the report prints estimate against actual so
 * the next operator knows by how much it was wrong.
 */
export async function estimateRun(plan: VerifyPlan): Promise<CostEstimate> {
  const collector = createCollector();
  const gateway = createGateway({ mode: "replay", onGeneration: collector.onGeneration });
  const previous = process.env.LLM_REPLAY_LATENCY_MS;
  process.env.LLM_REPLAY_LATENCY_MS = "0"; // the estimator must not sleep 252 times
  try {
    await runEval(gateway, {
      generator: "G9",
      variantId: "G9@v1",
      cases: toEvalCases(plan),
    });
  } finally {
    if (previous === undefined) delete process.env.LLM_REPLAY_LATENCY_MS;
    else process.env.LLM_REPLAY_LATENCY_MS = previous;
  }
  const stages = stageSpend(collector.metas);
  const totalUsd = round(
    stages.reduce((s, r) => s + r.costUsd, 0),
    6,
  );
  return {
    totalUsd,
    perWorldUsd: plan.worlds === 0 ? 0 : round(totalUsd / plan.worlds, 6),
    stages,
    worlds: plan.worlds,
    calls: collector.metas.length,
  };
}

/* --------------------------------------------------------------------- run ---- */

export interface VerifyOptions {
  gateway: Gateway;
  /** the metas array the gateway's `onGeneration` fills — see `createCollector` */
  metas: GenerationMeta[];
  mode: VerifyMode;
  plan?: VerifyPlan;
  variantId?: string;
  concurrency?: number;
  /** per world; a hung call costs one case, not the run */
  timeoutMs?: number;
  /** refuse to start if the estimate exceeds this */
  maxUsd?: number;
  /** skip the replay-based estimate (it costs nothing but a few seconds) */
  estimate?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

const isG9Input = (v: unknown): v is G9Input => G9InputZ.safeParse(v).success;

export async function runVerification(opts: VerifyOptions): Promise<VerifyReport> {
  if (opts.mode === "live") preflightLive(opts.env ?? process.env);

  const plan = opts.plan ?? planRun();
  const variantId = opts.variantId ?? "G9@v1";
  const now = opts.now ?? (() => new Date());
  const startedAt = now();
  const notes: string[] = [];

  let estimate: CostEstimate | null = null;
  if (opts.estimate !== false) {
    estimate = await estimateRun(plan);
    if (opts.maxUsd !== undefined && estimate.totalUsd > opts.maxUsd) {
      throw new VerifyRefusal(
        `estimated $${estimate.totalUsd.toFixed(2)} exceeds the --max-usd budget of $${opts.maxUsd.toFixed(2)}.`,
        `Run fewer genres (--genres fame,idol) or --pairs 2, or raise --max-usd deliberately.`,
      );
    }
  }

  // The gate, once. Worlds are captured on the way past so nothing is generated twice.
  //
  // The gate itself is defensive at every layer below this (the gateway never throws, and the
  // batch path resolves every entry), but by the time it runs the money is already spent — so an
  // unexpected rejection must still produce a report saying what was bought. Losing the run and
  // the receipt in the same exception is the one failure mode that cannot be recovered by
  // running it again.
  const worlds = new Map<string, WorldSeed>();
  let gate: EvalRunResult;
  try {
    gate = await runEval(opts.gateway, {
      generator: "G9",
      variantId,
      cases: toEvalCases(plan),
      concurrency: opts.concurrency ?? 2,
      ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
      onWorld: (key, world) => {
        worlds.set(key, world);
      },
    });
  } catch (cause) {
    notes.push(
      `the evaluation gate threw (${String(cause)}). Everything already generated is reported below; the gate's own scores are missing.`,
    );
    gate = {
      generator: "G9",
      variantId,
      cases: 0,
      passed: 0,
      meanScore: 0,
      costUsd: 0,
      generatorCostUsd: 0,
      judgeCostUsd: 0,
      results: [],
    };
  }

  const inputs = new Map<string, G9Input>();
  for (const c of plan.cases) if (isG9Input(c.input)) inputs.set(c.key, c.input);

  const blueprint = new Map<string, WorldSeed>();
  for (const [key, input] of inputs) {
    try {
      blueprint.set(key, deterministicWorld(input));
    } catch {
      // The blueprint is a comparison column, not the run. Losing one is a missing cell.
    }
  }

  const missing = plan.cases.filter((c) => !worlds.has(c.key)).map((c) => c.key);
  if (missing.length > 0) {
    notes.push(
      `${missing.length} case(s) produced no world at all (timeout or hard failure); they score zero and are listed in the ledger.`,
    );
  }

  const finishedAt = now();
  const evidence = liveEvidenceOf(opts.metas);
  const report: VerifyReport = {
    mode: opts.mode,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    plan: {
      genres: plan.genres,
      worlds: plan.worlds,
      generatorCalls: plan.generatorCalls,
      judgeCalls: plan.judgeCalls,
    },
    variantId,
    evidence,
    judgeSource: judgeSourceOf(opts.metas),
    gate,
    spend: spendReport(opts.metas, plan.worlds, estimate),
    distinctness: distinctnessReport(plan, inputs, worlds, blueprint),
    cast: castReport(plan, inputs, worlds, blueprint),
    japanese: japaneseReport(plan, inputs, worlds),
    failures: failureLedger(opts.metas, missing),
    answers: [],
    missing,
    notes,
    metas: opts.metas,
  };
  report.answers = answersFor(report);
  return report;
}

/* ------------------------------------------------------------------ sections ---- */

function judgeSourceOf(metas: readonly GenerationMeta[]): VerifyReport["judgeSource"] {
  const judge = metas.filter((m) => m.variantId.startsWith("GJ"));
  if (judge.length === 0) return "absent";
  const replayed = judge.filter((m) => baseStopReason(m.stopReason) === "replay").length;
  if (replayed === 0) return "live";
  if (replayed === judge.length) return "replay heuristic";
  return "mixed";
}

function spendReport(metas: readonly GenerationMeta[], worlds: number, estimate: CostEstimate | null): SpendReport {
  const stages = stageSpend(metas);
  const usage = totalUsage(metas);
  const totalUsd = round(
    stages.reduce((s, r) => s + r.costUsd, 0),
    8,
  );
  const judgeUsd = round(
    stages.filter((s) => s.stage.startsWith("GJ")).reduce((s, r) => s + r.costUsd, 0),
    8,
  );
  return {
    stages,
    usage,
    totalUsd,
    judgeUsd,
    generatorUsd: round(totalUsd - judgeUsd, 8),
    worlds,
    usdPerWorld: worlds === 0 ? 0 : round(totalUsd / worlds, 6),
    cacheHitRate: cacheHitRate(usage),
    estimateUsd: estimate?.totalUsd ?? null,
    estimatePerWorldUsd: estimate?.perWorldUsd ?? null,
  };
}

/** The gem line from gtm.md §2, recomputed from what the run actually paid. */
export function gemEconomics(usdPerWorld: number): {
  gemCost: number;
  packUsd: number;
  assumedUsd: number;
  marginBeforeReviewUsd: number;
  reviewUsd: number;
  marginAfterReviewUsd: number;
} {
  const packUsd = GEM_PACKS.gems_small.usd;
  const reviewUsd = 5.0; // gtm.md §2: 20 minutes at $15/hour
  return {
    gemCost: WORLD_STUDIO.GEM_COST,
    packUsd,
    assumedUsd: 0.32,
    marginBeforeReviewUsd: round(packUsd - usdPerWorld, 4),
    reviewUsd,
    marginAfterReviewUsd: round(packUsd - usdPerWorld - reviewUsd, 4),
  };
}

function meanOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return round(xs.reduce((s, x) => s + x, 0) / xs.length);
}

function distinctnessReport(
  plan: VerifyPlan,
  inputs: ReadonlyMap<string, G9Input>,
  live: ReadonlyMap<string, WorldSeed>,
  blueprint: ReadonlyMap<string, WorldSeed>,
): DistinctnessReport {
  const byGenre = new Map<WorldGenre, string[]>();
  for (const c of plan.cases) {
    const input = inputs.get(c.key);
    if (input === undefined) continue;
    const list = byGenre.get(input.genre) ?? [];
    list.push(c.key);
    byGenre.set(input.genre, list);
  }

  const pairs: GenrePairRow[] = [];
  const failing: string[] = [];
  for (const [genre, keys] of byGenre) {
    if (keys.length < 2) continue;
    const [aKey, bKey] = keys;
    if (aKey === undefined || bKey === undefined) continue;
    const pair = (m: ReadonlyMap<string, WorldSeed>): G9Distinctness | null => {
      const a = m.get(aKey);
      const b = m.get(bKey);
      return a === undefined || b === undefined ? null : distinctnessOf(a, b);
    };
    const row: GenrePairRow = { genre, aKey, bKey, live: pair(live), blueprint: pair(blueprint) };
    if (row.live !== null && !row.live.distinct) failing.push(genre);
    pairs.push(row);
  }

  // The floor: worlds of different genres, from this same run. If same-genre overlap is not
  // meaningfully above it, premises are producing worlds as different as genres are.
  const crossOf = (m: ReadonlyMap<string, WorldSeed>): number | null => {
    const firstOfGenre = [...byGenre.values()]
      .map((keys) => keys[0])
      .filter((k): k is string => k !== undefined)
      .map((k) => m.get(k))
      .filter((w): w is WorldSeed => w !== undefined);
    const xs: number[] = [];
    for (let i = 0; i + 1 < firstOfGenre.length; i += 1) {
      const a = firstOfGenre[i];
      const b = firstOfGenre[i + 1];
      if (a !== undefined && b !== undefined) xs.push(distinctnessOf(a, b).bibleLineOverlap);
    }
    return meanOf(xs);
  };

  return {
    pairs,
    meanBibleLineOverlapLive: meanOf(
      pairs.map((p) => p.live?.bibleLineOverlap).filter((n): n is number => n !== undefined && n !== null),
    ),
    meanBibleLineOverlapBlueprint: meanOf(
      pairs.map((p) => p.blueprint?.bibleLineOverlap).filter((n): n is number => n !== undefined && n !== null),
    ),
    meanCastCardOverlapLive: meanOf(
      pairs.map((p) => p.live?.castCardOverlap).filter((n): n is number => n !== undefined && n !== null),
    ),
    meanCastCardOverlapBlueprint: meanOf(
      pairs.map((p) => p.blueprint?.castCardOverlap).filter((n): n is number => n !== undefined && n !== null),
    ),
    crossGenreLive: crossOf(live),
    crossGenreBlueprint: crossOf(blueprint),
    failing,
  };
}

function castReport(
  plan: VerifyPlan,
  inputs: ReadonlyMap<string, G9Input>,
  live: ReadonlyMap<string, WorldSeed>,
  blueprint: ReadonlyMap<string, WorldSeed>,
): CastRow[] {
  const rows: CastRow[] = [];
  for (const c of plan.cases) {
    const input = inputs.get(c.key);
    if (input === undefined) continue;
    const locale: Locale = input.locale;
    const liveWorld = live.get(c.key);
    const bpWorld = blueprint.get(c.key);
    rows.push({
      key: c.key,
      locale,
      live: liveWorld === undefined ? null : castDistinctnessOf(liveWorld, locale),
      blueprint: bpWorld === undefined ? null : castDistinctnessOf(bpWorld, locale),
    });
  }
  return rows;
}

function japaneseReport(
  plan: VerifyPlan,
  inputs: ReadonlyMap<string, G9Input>,
  live: ReadonlyMap<string, WorldSeed>,
): JapaneseReport {
  const rows: JapaneseRow[] = [];
  const panels: JapaneseReport["panels"] = [];
  for (const c of plan.cases) {
    const input = inputs.get(c.key);
    const world = live.get(c.key);
    if (input === undefined || world === undefined) continue;
    const m = g9Metrics(input, world);
    rows.push({
      key: c.key,
      label: c.label,
      jaCjkRatio: m.jaCjkRatio,
      jaEchoesEn: m.jaEchoesEn,
      jaRoleCjkRatio: m.jaRoleCjkRatio,
      castRolesLocalized: m.castRolesLocalized,
      castSize: m.cast,
      bibleTokensJa: m.bibleTokens.ja,
      bibleTokensEn: m.bibleTokens.en,
    });
    // The panel is for a human, and a human will read two or three of these, not eighteen.
    if (input.locale === "ja" && panels.length < 3) {
      panels.push({
        key: c.key,
        label: c.label,
        titleEn: world.title.en ?? "",
        titleJa: world.title.ja ?? "",
        rows: bilingualPanel(world),
      });
    }
  }
  return { rows, panels, checklist: JA_HUMAN_CHECKLIST };
}

/** Every non-clean outcome, as a row. This is the section that makes a bad run still useful. */
function failureLedger(metas: readonly GenerationMeta[], missing: readonly string[]): FailureRow[] {
  const out: FailureRow[] = [];
  for (const key of missing) {
    out.push({
      key,
      stage: "(whole world)",
      kind: "no-result",
      detail: "no world came back within the timeout; scored zero",
    });
  }
  for (const m of metas) {
    const reason = baseStopReason(m.stopReason);
    const clean = reason === "end_turn" || reason === "replay";
    if (!m.fallback && clean) continue;
    out.push({
      key: m.promptHash.slice(0, 8),
      stage: m.variantId,
      kind: m.fallback ? `fallback:${reason}` : reason,
      detail: `${m.model} · ${m.usage.outputTokens} output tokens · ${m.latencyMs}ms`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ answers ---- */

function fmt(n: number | null): string {
  return n === null ? "n/a" : n.toFixed(2);
}

function answersFor(r: VerifyReport): Answer[] {
  const d = r.distinctness;
  const castLive = r.cast.map((c) => c.live).filter((c): c is CastDistinctness => c !== null);
  const castBp = r.cast.map((c) => c.blueprint).filter((c): c is CastDistinctness => c !== null);
  const meanCardLive = meanOf(castLive.map((c) => c.meanCard));
  const meanCardBp = meanOf(castBp.map((c) => c.meanCard));
  const meanSpeechLive = meanOf(castLive.map((c) => c.meanSpeech));
  const meanSpeechBp = meanOf(castBp.map((c) => c.meanSpeech));
  const worstCard = castLive.reduce((acc, c) => Math.max(acc, c.maxCard), 0);

  const jaRows = r.japanese.rows;
  const jaEcho = meanOf(jaRows.map((j) => j.jaEchoesEn));
  const jaCjk = meanOf(jaRows.map((j) => j.jaCjkRatio));
  const rolesOk = jaRows.every((j) => j.castRolesLocalized === j.castSize);

  const q2Live = d.meanBibleLineOverlapLive;
  const q2Verdict: Answer["verdict"] =
    q2Live === null ? "unknown" : q2Live <= DISTINCTNESS_LIMITS.bibleLines ? "pass" : "fail";

  return [
    {
      id: "ja-native",
      question: "Is the Japanese native, or is it the English translated?",
      verdict:
        jaEcho === null || jaCjk === null
          ? "unknown"
          : jaEcho <= MAX_JA_ECHO && jaCjk >= MIN_JA_CJK_RATIO && rolesOk
            ? "human"
            : "fail",
      headline:
        jaEcho === null
          ? "no Japanese world was produced"
          : `JA fields identical to their EN twin: ${(jaEcho * 100).toFixed(1)}% (limit ${(MAX_JA_ECHO * 100).toFixed(0)}%) · CJK density ${fmt(jaCjk)} (floor ${MIN_JA_CJK_RATIO})`,
      detail: [
        `Every cast role line localized in every world: ${rolesOk ? "yes" : "no"}.`,
        `Bible tokens, JA vs EN, per world: ${jaRows
          .slice(0, 4)
          .map((j) => `${j.key} ${j.bibleTokensJa}/${j.bibleTokensEn}`)
          .join(", ")}`,
      ],
      limits: [
        "A verdict of `human` is the strongest a machine can give here: CJK density and byte-equality",
        "both pass a *good translation*, which is exactly the failure being looked for. The side-by-side",
        "panel below is the deliverable — read one JA world against its EN half with the checklist.",
      ],
    },
    {
      id: "distinct-worlds",
      question: "Do two different premises in the same genre produce genuinely different worlds?",
      verdict: q2Verdict,
      headline: `bible-line overlap, same genre: live ${fmt(q2Live)} vs blueprint ${fmt(d.meanBibleLineOverlapBlueprint)} (gate limit ${DISTINCTNESS_LIMITS.bibleLines}; different genres, same run: ${fmt(d.crossGenreLive)})`,
      detail: [
        `Cast-card overlap: live ${fmt(d.meanCastCardOverlapLive)} vs blueprint ${fmt(d.meanCastCardOverlapBlueprint)}.`,
        d.failing.length === 0
          ? "Every genre pair cleared every distinctness limit."
          : `Genres whose two premises produced the same world: ${d.failing.join(", ")}.`,
        "This is the number the harness exists for: it is the difference between worlds that have",
        "authors and worlds that have labels.",
      ],
      limits: [
        "Overlap is measured on the English halves (locale-independent), over bible lines of 40+",
        "characters, handles, display names and cast cards. Two worlds can share little text and",
        "still feel the same; that residue is a human judgement.",
      ],
    },
    {
      id: "distinct-cast",
      question: "Are the eight characters distinguishable from one another?",
      verdict:
        meanCardLive === null
          ? "unknown"
          : meanCardLive <= CAST_OVERLAP_LIMIT && worstCard <= CAST_OVERLAP_LIMIT + 0.15
            ? "pass"
            : "fail",
      headline: `within-world pair overlap: description ${fmt(meanCardLive)} (blueprint ${fmt(meanCardBp)}), speech ${fmt(meanSpeechLive)} (blueprint ${fmt(meanSpeechBp)}); worst pair ${worstCard.toFixed(2)}`,
      detail: [
        "Description = role + card + first post. Speech = the five fallback lines, the welcome post",
        "and this account's ambient posts — what a player actually reads.",
        `Cast members with a role line nobody else shares: ${castLive
          .slice(0, 4)
          .map((c) => `${c.distinctRoles}/${c.castSize}`)
          .join(", ")}`,
      ],
      limits: [
        `The ${CAST_OVERLAP_LIMIT} bar is calibrated against the blueprint printed beside it, not against`,
        "a corpus. Read the two columns, not the verdict.",
      ],
    },
  ];
}
