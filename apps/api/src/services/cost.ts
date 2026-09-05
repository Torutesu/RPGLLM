/**
 * S3-5 — cost observability (cost-architecture §6.4).
 *
 * Everything here is aggregated **in Postgres**: `GenerationLog` grows by one row per generator
 * call (several per action), so the dashboard must never load the rows into the process. Each
 * breakdown is one `GROUP BY` over the `@@index([createdAt])` window.
 *
 * Percentiles are computed by Postgres' `percentile_disc` — the *nearest-rank* percentile, i.e. an
 * actual observed latency, never an interpolation and never an average. `percentile_disc(p)`
 * returns the first value whose cumulative distribution is >= p, which for n sorted samples is the
 * `ceil(p*n)`-th one; that makes the numbers hand-checkable (see test/cost.test.ts).
 *
 * Definition of an **action** (cost-architecture §2): a post / reply / DM send / event choice —
 * exactly the things that spend 1 energy. We count them as `LedgerEntry(source: "spend")` rows in
 * the window, which is the single place every energy spend is written (services/wallet.ts
 * `spendEnergy`), inside the same transaction as the action itself. A fallback refund is written
 * with `source: "admin"` and therefore does NOT cancel the spend: the LLM call was made and paid
 * for, so it still belongs in the denominator of $/action.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { worldModerationOps, type WorldModerationOps } from "./world-moderation";
import { championVariants } from "@rpgllm/llm";
import { BATCH_DISCOUNT, COST_DASHBOARD, PRICING, type CostSummaryResZ } from "@rpgllm/shared";
import type { z } from "zod";

export type CostRow = z.infer<typeof CostSummaryResZ>["totals"];
export type CostSummary = z.infer<typeof CostSummaryResZ>;

/** §6.4 alarms. */
export const COST_ALARMS = {
  /** cache hit rate below this is the "prompt caching silently broke" signal (§2.1 / §6.4) */
  CACHE_HIT_MIN: 0.8,
  /** an arm whose cost per call is more than +30% over its generator's champion */
  COST_OVER_CHAMPION: 0.3,
  /** TTFT P95 budget in ms */
  TTFT_P95_MAX_MS: 3000,
} as const;

/** `meta.fallback === true` is persisted only through `stopReason` (packages/llm/src/errors.ts). */
export const FALLBACK_STOP_REASONS = ["error", "refusal", "invalid_json"] as const;

/**
 * Batch tier marker (cost-architecture §5.4, Agent N). `GenerationLog` has no `batched` column, so
 * a batched call is written with its stop reason prefixed: `batch:replay`, `batch:end_turn`,
 * `batch:error`. Two SQL fragments follow from that: `REASON_EXPR` strips the prefix so failure
 * kinds keep matching, and `IS_BATCH` selects the batched half of the window.
 */
export const BATCH_STOP_PREFIX = "batch:";
const REASON_EXPR = Prisma.sql`regexp_replace("stopReason", '^batch:', '')`;
const IS_BATCH = Prisma.sql`"stopReason" LIKE 'batch:%'`;

export interface VariantArm {
  generator: string;
  variantId: string;
  /** the models this arm actually ran on, comma-joined (normally one) */
  model: string;
  isChampion: boolean;
  calls: number;
  /** share of all calls of the same generator */
  allocation: number;
  usdPerCall: number;
  /** usdPerCall / champion's usdPerCall − 1; null when the arm *is* the champion or it has no calls */
  costVsChampion: number | null;
  up: number;
  down: number;
  regenerations: number;
  /** cheap online quality proxy: 1 − (👎 + regenerations) / calls, clamped to [0,1] */
  qualityProxy: number;
}

export interface DailyPerAction {
  day: string;
  calls: number;
  costUsd: number;
  actions: number;
  activeUsers: number;
  usdPerAction: number;
  usdPerActiveUser: number;
  cacheHitRate: number;
  ttftP50Ms: number;
  ttftP95Ms: number;
}

/**
 * §5.4 made visible: what the Batch tier is actually saving. `listPriceUsd` re-prices the batched
 * tokens at interactive list price from `PRICING`, so `realisedDiscount` is a *measurement* (it
 * should sit at 1 - BATCH_DISCOUNT) rather than an assertion — if a batched call is ever billed at
 * full price, this number moves.
 */
export interface BatchSplit {
  batched: CostRow;
  interactive: CostRow;
  batchedCallShare: number;
  batchedCostShare: number;
  listPriceUsd: number;
  savedUsd: number;
  realisedDiscount: number;
  expectedDiscount: number;
  byGenerator: Array<{ generator: string; calls: number; costUsd: number; savedUsd: number }>;
}

export interface CostAlarms {
  cacheHitRateLow: boolean;
  costPerActionOverChampion: boolean;
  ttftP95High: boolean;
}

/**
 * What the dashboard renders. The first block is exactly `CostSummaryResZ`; `ttft`, `variants`,
 * `alarms` and `thresholds` are additive extras (a `CostSummaryResZ.parse()` strips them).
 */
export interface CostReport extends CostSummary {
  /**
   * The post-publication moderation backlog (WORLD_MODERATION). Nobody should have to remember to
   * look: overdue reviews and worlds the players pulled off the shelf show up on the surface an
   * operator already reads, next to the spend.
   */
  moderation: WorldModerationOps;
  ttft: { p50Ms: number; p95Ms: number; samples: number };
  /** §6.4 "$/action and $/DAU over time" — one point per UTC day in the window */
  perDay: DailyPerAction[];
  /** cost-architecture §5.4 — batched vs interactive spend and the discount actually realised */
  batch: BatchSplit;
  variants: VariantArm[];
  alarms: CostAlarms;
  thresholds: typeof COST_ALARMS;
}

export interface CostWindow { since: Date; until: Date }

/** `days` clamped to [1, COST_DASHBOARD.MAX_DAYS]; the window ends at `now`. */
export function costWindow(now: Date, days: number): CostWindow & { days: number } {
  const d = Number.isFinite(days) ? Math.floor(days) : COST_DASHBOARD.DEFAULT_DAYS;
  const clamped = Math.min(COST_DASHBOARD.MAX_DAYS, Math.max(1, d));
  return { days: clamped, since: new Date(now.getTime() - clamped * 86_400_000), until: now };
}

/* --------------------------------------------------------------------- SQL ---- */

interface RawGroupRow {
  key: string | null;
  calls: bigint;
  input: bigint | null;
  cacheWrite: bigint | null;
  cacheRead: bigint | null;
  output: bigint | null;
  cost: number | null;
  fallbacks: bigint;
  p50: number | null;
  p95: number | null;
}

const num = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

const FALLBACK_FILTER = Prisma.sql`${REASON_EXPR} IN (${Prisma.join(FALLBACK_STOP_REASONS.map((s) => Prisma.sql`${s}`))})`;

/**
 * One grouped scan of the window. `keyExpr` must be server-authored SQL (never user input) —
 * every call site below passes a literal.
 */
async function groupBy(
  prisma: PrismaClient,
  keyExpr: Prisma.Sql,
  w: CostWindow,
  orderBy: Prisma.Sql,
): Promise<CostRow[]> {
  const rows = await prisma.$queryRaw<RawGroupRow[]>`
    SELECT ${keyExpr} AS "key",
           count(*) AS "calls",
           sum("inputTokens") AS "input",
           sum("cacheWriteTokens") AS "cacheWrite",
           sum("cacheReadTokens") AS "cacheRead",
           sum("outputTokens") AS "output",
           sum("costUsd")::double precision AS "cost",
           count(*) FILTER (WHERE ${FALLBACK_FILTER}) AS "fallbacks",
           percentile_disc(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "p50",
           percentile_disc(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
    FROM "GenerationLog"
    WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until}
    GROUP BY 1
    ORDER BY ${orderBy}
  `;
  return rows.map((r) => ({
    key: r.key ?? "",
    calls: num(r.calls),
    inputTokens: num(r.input),
    cacheWriteTokens: num(r.cacheWrite),
    cacheReadTokens: num(r.cacheRead),
    outputTokens: num(r.output),
    costUsd: round6(num(r.cost)),
    fallbacks: num(r.fallbacks),
    p50LatencyMs: num(r.p50),
    p95LatencyMs: num(r.p95),
  }));
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);

const EMPTY_ROW = (key: string): CostRow => ({
  key,
  calls: 0,
  inputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  fallbacks: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
});

/* ------------------------------------------------------------------ report ---- */

interface RawArmRow { generator: string; variantId: string; models: string; calls: bigint; cost: number | null; regenerations: bigint }
interface RawRatingRow { variantId: string; up: bigint; down: bigint }
interface RawTtftRow { p50: number | null; p95: number | null; samples: bigint }
interface RawDailyRow {
  day: string;
  calls: bigint | null;
  cost: number | null;
  cacheRead: bigint | null;
  input: bigint | null;
  activeUsers: bigint | null;
  ttftP50: number | null;
  ttftP95: number | null;
  actions: bigint | null;
}

/**
 * The daily series the dashboard plots. One FULL OUTER JOIN so a day with actions but no
 * generations (or vice versa) still produces a point instead of silently disappearing.
 */
async function perDaySeries(prisma: PrismaClient, w: CostWindow): Promise<DailyPerAction[]> {
  const rows = await prisma.$queryRaw<RawDailyRow[]>`
    WITH g AS (
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "day",
             count(*) AS "calls",
             sum("costUsd")::double precision AS "cost",
             sum("cacheReadTokens") AS "cacheRead",
             sum("inputTokens") AS "input",
             count(DISTINCT "userId") AS "activeUsers",
             percentile_disc(0.5) WITHIN GROUP (ORDER BY "ttftMs") AS "ttftP50",
             percentile_disc(0.95) WITHIN GROUP (ORDER BY "ttftMs") AS "ttftP95"
      FROM "GenerationLog"
      WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until}
      GROUP BY 1
    ), a AS (
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "day", count(*) AS "actions"
      FROM "LedgerEntry"
      WHERE "source" = 'spend' AND "createdAt" >= ${w.since} AND "createdAt" <= ${w.until}
      GROUP BY 1
    )
    SELECT COALESCE(g."day", a."day") AS "day",
           g."calls", g."cost", g."cacheRead", g."input", g."activeUsers", g."ttftP50", g."ttftP95",
           a."actions"
    FROM g FULL OUTER JOIN a ON g."day" = a."day"
    ORDER BY 1 ASC
  `;
  return rows.map((r): DailyPerAction => {
    const costUsd = round6(num(r.cost));
    const actions = num(r.actions);
    const activeUsers = num(r.activeUsers);
    const cacheRead = num(r.cacheRead);
    return {
      day: r.day,
      calls: num(r.calls),
      costUsd,
      actions,
      activeUsers,
      usdPerAction: round6(ratio(costUsd, actions)),
      usdPerActiveUser: round6(ratio(costUsd, activeUsers)),
      cacheHitRate: Math.round(ratio(cacheRead, cacheRead + num(r.input)) * 1e4) / 1e4,
      ttftP50Ms: num(r.ttftP50),
      ttftP95Ms: num(r.ttftP95),
    };
  });
}

interface RawBatchModelRow {
  model: string;
  batched: bigint;
  input: bigint | null;
  cacheWrite: bigint | null;
  cacheRead: bigint | null;
  output: bigint | null;
  cost: number | null;
}

interface RawBatchGeneratorRow { generator: string; calls: bigint; cost: number | null }

/**
 * The batch split. Two grouped scans: one per model (to re-price the batched tokens at list price)
 * and one per generator. Both are tiny result sets — no row is ever loaded.
 */
export async function batchSplit(prisma: PrismaClient, w: CostWindow): Promise<BatchSplit> {
  const [halves, byModel, byGenerator] = await Promise.all([
    groupBy(
      prisma,
      Prisma.sql`CASE WHEN ${IS_BATCH} THEN 'batched' ELSE 'interactive' END`,
      w,
      Prisma.sql`1 ASC`,
    ),
    prisma.$queryRaw<RawBatchModelRow[]>`
      SELECT "model",
             count(*) AS "batched",
             sum("inputTokens") AS "input",
             sum("cacheWriteTokens") AS "cacheWrite",
             sum("cacheReadTokens") AS "cacheRead",
             sum("outputTokens") AS "output",
             sum("costUsd")::double precision AS "cost"
      FROM "GenerationLog"
      WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until} AND ${IS_BATCH}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.$queryRaw<RawBatchGeneratorRow[]>`
      SELECT "generator"::text AS "generator",
             count(*) AS "calls",
             sum("costUsd")::double precision AS "cost"
      FROM "GenerationLog"
      WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until} AND ${IS_BATCH}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const batched = halves.find((r) => r.key === "batched") ?? EMPTY_ROW("batched");
  const interactive = halves.find((r) => r.key === "interactive") ?? EMPTY_ROW("interactive");
  const calls = batched.calls + interactive.calls;
  const cost = batched.costUsd + interactive.costUsd;

  let listPriceUsd = 0;
  for (const row of byModel) {
    const p = PRICING[row.model];
    if (p === undefined) continue;
    listPriceUsd +=
      (num(row.input) * p.input +
        num(row.output) * p.output +
        num(row.cacheRead) * p.cacheRead +
        num(row.cacheWrite) * p.cacheWrite) /
      1_000_000;
  }
  listPriceUsd = round6(listPriceUsd);
  const savedUsd = round6(Math.max(0, listPriceUsd - batched.costUsd));

  return {
    batched,
    interactive,
    batchedCallShare: Math.round(ratio(batched.calls, calls) * 1e4) / 1e4,
    batchedCostShare: Math.round(ratio(batched.costUsd, cost) * 1e4) / 1e4,
    listPriceUsd,
    savedUsd,
    realisedDiscount: Math.round(ratio(savedUsd, listPriceUsd) * 1e4) / 1e4,
    expectedDiscount: 1 - BATCH_DISCOUNT,
    byGenerator: byGenerator.map((g) => {
      const generatorCost = round6(num(g.cost));
      return {
        generator: g.generator,
        calls: num(g.calls),
        costUsd: generatorCost,
        // at BATCH_DISCOUNT, what was paid is the discounted half: the saving is the same amount
        savedUsd: round6(BATCH_DISCOUNT > 0 ? generatorCost / BATCH_DISCOUNT - generatorCost : 0),
      };
    }),
  };
}

/** The full §6.4 dashboard for one window. Six grouped queries + four scalars, no row loading. */
export async function costReport(prisma: PrismaClient, w: CostWindow): Promise<CostReport> {
  const [totalsRows, byDay, byGenerator, byVariant, byModel] = await Promise.all([
    groupBy(prisma, Prisma.sql`'all'`, w, Prisma.sql`1`),
    groupBy(prisma, Prisma.sql`to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD')`, w, Prisma.sql`1 ASC`),
    groupBy(prisma, Prisma.sql`"generator"::text`, w, Prisma.sql`1 ASC`),
    groupBy(prisma, Prisma.sql`"variantId"`, w, Prisma.sql`1 ASC`),
    groupBy(prisma, Prisma.sql`"model"`, w, Prisma.sql`1 ASC`),
  ]);
  const totals = totalsRows[0] ?? EMPTY_ROW("all");

  const [arms, armRatings, ttftRows, perDay, batch, actions, activeUsers, ratings, regenerations, moderation] = await Promise.all([
    prisma.$queryRaw<RawArmRow[]>`
      SELECT "generator"::text AS "generator",
             "variantId",
             string_agg(DISTINCT "model", ',' ORDER BY "model") AS "models",
             count(*) AS "calls",
             sum("costUsd")::double precision AS "cost",
             count(*) FILTER (WHERE "escalatedFrom" IS NOT NULL) AS "regenerations"
      FROM "GenerationLog"
      WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `,
    prisma.$queryRaw<RawRatingRow[]>`
      SELECT g."variantId",
             count(*) FILTER (WHERE r."value" > 0) AS "up",
             count(*) FILTER (WHERE r."value" < 0) AS "down"
      FROM "Rating" r JOIN "GenerationLog" g ON g."id" = r."generationId"
      WHERE r."createdAt" >= ${w.since} AND r."createdAt" <= ${w.until}
      GROUP BY 1
    `,
    prisma.$queryRaw<RawTtftRow[]>`
      SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY "ttftMs") AS "p50",
             percentile_disc(0.95) WITHIN GROUP (ORDER BY "ttftMs") AS "p95",
             count("ttftMs") AS "samples"
      FROM "GenerationLog"
      WHERE "createdAt" >= ${w.since} AND "createdAt" <= ${w.until} AND "ttftMs" IS NOT NULL
    `,
    perDaySeries(prisma, w),
    batchSplit(prisma, w),
    prisma.ledgerEntry.count({ where: { source: "spend", createdAt: { gte: w.since, lte: w.until } } }),
    prisma.generationLog.findMany({
      where: { createdAt: { gte: w.since, lte: w.until }, userId: { not: null } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.rating.groupBy({
      by: ["value"],
      where: { createdAt: { gte: w.since, lte: w.until } },
      _count: { _all: true },
    }),
    prisma.generationLog.count({ where: { createdAt: { gte: w.since, lte: w.until }, escalatedFrom: { not: null } } }),
    // Not a windowed number: "how many worlds are waiting for a human right now" has no `since`.
    worldModerationOps(prisma, w.until),
  ]);

  const up = ratings.filter((r) => r.value > 0).reduce((s, r) => s + r._count._all, 0);
  const down = ratings.filter((r) => r.value < 0).reduce((s, r) => s + r._count._all, 0);
  const ttftRow = ttftRows[0];
  const ttft = { p50Ms: num(ttftRow?.p50), p95Ms: num(ttftRow?.p95), samples: num(ttftRow?.samples) };

  const variants = buildArms(arms, armRatings);
  const cacheHitRate = ratio(totals.cacheReadTokens, totals.cacheReadTokens + totals.inputTokens);

  const summary: CostSummary = {
    since: w.since.toISOString(),
    until: w.until.toISOString(),
    totals,
    byDay,
    byGenerator,
    byVariant,
    byModel,
    perAction: {
      actions,
      usdPerAction: round6(ratio(totals.costUsd, actions)),
      usdPerActiveUser: round6(ratio(totals.costUsd, activeUsers.length)),
    },
    cacheHitRate: Math.round(cacheHitRate * 1e4) / 1e4,
    ratings: { up, down, regenerations },
  };

  return {
    ...summary,
    moderation,
    ttft,
    perDay,
    batch,
    variants,
    alarms: {
      // an empty window is not an alarm — nothing has been sampled yet
      cacheHitRateLow: totals.calls > 0 && cacheHitRate < COST_ALARMS.CACHE_HIT_MIN,
      costPerActionOverChampion: variants.some((v) => v.costVsChampion !== null && v.costVsChampion > COST_ALARMS.COST_OVER_CHAMPION),
      ttftP95High: ttft.samples > 0 && ttft.p95Ms > COST_ALARMS.TTFT_P95_MAX_MS,
    },
    thresholds: COST_ALARMS,
  };
}

function buildArms(arms: RawArmRow[], armRatings: RawRatingRow[]): VariantArm[] {
  const champions = championVariants(); // generator -> champion variantId
  const ratingsByVariant = new Map(armRatings.map((r) => [r.variantId, { up: num(r.up), down: num(r.down) }]));
  const callsByGenerator = new Map<string, number>();
  for (const a of arms) callsByGenerator.set(a.generator, (callsByGenerator.get(a.generator) ?? 0) + num(a.calls));

  const championCostPerCall = new Map<string, number>();
  for (const a of arms) {
    if (champions[a.generator] === a.variantId && num(a.calls) > 0) {
      championCostPerCall.set(a.generator, num(a.cost) / num(a.calls));
    }
  }

  return arms.map((a): VariantArm => {
    const calls = num(a.calls);
    const usdPerCall = calls === 0 ? 0 : num(a.cost) / calls;
    const isChampion = champions[a.generator] === a.variantId;
    const champCost = championCostPerCall.get(a.generator);
    const r = ratingsByVariant.get(a.variantId) ?? { up: 0, down: 0 };
    const regenerations = num(a.regenerations);
    return {
      generator: a.generator,
      variantId: a.variantId,
      model: a.models,
      isChampion,
      calls,
      allocation: Math.round(ratio(calls, callsByGenerator.get(a.generator) ?? 0) * 1e4) / 1e4,
      usdPerCall: round6(usdPerCall),
      costVsChampion:
        isChampion || champCost === undefined || champCost === 0 || calls === 0
          ? null
          : Math.round((usdPerCall / champCost - 1) * 1e4) / 1e4,
      up: r.up,
      down: r.down,
      regenerations,
      qualityProxy: calls === 0 ? 0 : Math.max(0, Math.min(1, 1 - (r.down + regenerations) / calls)),
    };
  });
}

/** `/v1/cost/live` — the probe payload (§6.4 alarms over the last hour). */
export interface CostLive {
  since: string;
  until: string;
  calls: number;
  usdPerAction: number;
  cacheHitRate: number;
  fallbackRate: number;
  p95LatencyMs: number;
  ttftP95Ms: number;
  alarms: CostAlarms;
  /** the review backlog right now — a probe that reads this one payload sees it too */
  moderation: WorldModerationOps;
  thresholds: typeof COST_ALARMS;
}

export async function costLive(prisma: PrismaClient, now: Date, windowMs = 3_600_000): Promise<CostLive> {
  const w: CostWindow = { since: new Date(now.getTime() - windowMs), until: now };
  const report = await costReport(prisma, w);
  return {
    since: report.since,
    until: report.until,
    calls: report.totals.calls,
    usdPerAction: report.perAction.usdPerAction,
    cacheHitRate: report.cacheHitRate,
    fallbackRate: Math.round(ratio(report.totals.fallbacks, report.totals.calls) * 1e4) / 1e4,
    p95LatencyMs: report.totals.p95LatencyMs,
    ttftP95Ms: report.ttft.p95Ms,
    alarms: report.alarms,
    moderation: report.moderation,
    thresholds: report.thresholds,
  };
}
