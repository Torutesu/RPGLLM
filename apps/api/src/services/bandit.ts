/**
 * Thompson sampling with guardrails (cost-architecture §6.3) — persistence side.
 *
 * `packages/llm/src/bandit.ts` owns every rule (reward, posteriors, sampler, guardrails,
 * promotion). This file owns the Postgres half: it folds `GenerationLog` + `Rating` into the
 * `BanditArm` posteriors **in SQL**, writes the `PromotionEvent` audit trail, and serves the
 * `/v1/bandit` payload.
 *
 * Two things are worth knowing before reading on:
 *
 * 1. **The watermark.** `updateFromLogs` is incremental, so a re-run must not double count. There
 *    is no column for a cursor and the schema is frozen, so the watermark is a singleton
 *    `PromotionEvent` row per generator with `reason = "watermark"` and `metrics.at` holding the
 *    ISO timestamp of the last log row folded. It is updated in place, and every reader of the
 *    audit trail filters it out (`reason <> 'watermark'`).
 * 2. **Escalations and batched calls are excluded.** A 👎 regeneration runs one tier up under the
 *    *user's* arm id (build-notes, Agent I), so counting it would make the challenger look
 *    expensive and bad; a batched call is offline work with no user and no rating. The fold and the
 *    guardrails see neither — see `windowStats`.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  BANDIT_FLOOR,
  BANDIT_GUARDRAILS,
  BANDIT_LAMBDA,
  BANDIT_PROMOTION,
} from "@rpgllm/shared";
import {
  GENERATOR_EXPERIMENTS,
  championVariants,
  allocate,
  credibleInterval,
  dayKey,
  guardrailBreach,
  pBestByArm,
  posteriorMean,
  promotionDecision,
  rewardFor,
  type ArmState,
} from "@rpgllm/llm";
import { gatePassedVariants } from "./evals";

export const WATERMARK_REASON = "watermark";
/** How far back a first-ever fold reaches when there is no watermark yet. */
export const FOLD_BACKFILL_MS = 30 * 86_400_000;
/** The window the guardrails judge an arm over. */
export const GUARDRAIL_WINDOW_MS = 24 * 3_600_000;

const round = (n: number, p = 6): number => Math.round(n * 10 ** p) / 10 ** p;

/* ------------------------------------------------------------------ arms ---- */

/** Every registry variant has a row; index 0 of each experiment is the initial champion. */
export async function ensureArms(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const exp of GENERATOR_EXPERIMENTS) {
    for (const [i, variant] of exp.variants.entries()) {
      const existing = await prisma.banditArm.findUnique({
        where: { generator_variantId: { generator: exp.generator, variantId: variant.id } },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.banditArm.create({
        data: {
          generator: exp.generator,
          variantId: variant.id,
          isChampion: i === 0,
          floor: BANDIT_FLOOR,
        },
      });
      created += 1;
    }
  }
  return created;
}

export interface ArmRow extends ArmState {
  updatedAt: Date;
}

export async function loadArms(prisma: PrismaClient, generator?: string): Promise<ArmRow[]> {
  const rows = await prisma.banditArm.findMany({
    where: generator ? { generator } : {},
    orderBy: [{ generator: "asc" }, { variantId: "asc" }],
  });
  return rows.map((r) => ({
    generator: r.generator,
    variantId: r.variantId,
    alpha: r.alpha,
    beta: r.beta,
    calls: r.calls,
    rewardSum: r.rewardSum,
    costSum: r.costSum,
    isChampion: r.isChampion,
    floor: r.floor,
    disabled: r.disabledAt !== null,
    disabledReason: r.disabledReason,
    updatedAt: r.updatedAt,
  }));
}

/* ------------------------------------------------------- window aggregation ---- */

export interface WindowArmStats {
  generator: string;
  variantId: string;
  calls: number;
  costUsd: number;
  good: number;
  bad: number;
  unrated: number;
  regenerations: number;
  safetyFlags: number;
  fallbacks: number;
}

interface RawWindowRow {
  generator: string;
  variantId: string;
  calls: bigint;
  cost: number | null;
  good: bigint;
  bad: bigint;
  regenerations: bigint;
  safetyFlags: bigint;
  fallbacks: bigint;
}

/**
 * One grouped scan of `GenerationLog` over `(since, until]`, joined to its ratings. Nothing is
 * loaded into the process.
 *
 * Two rows are deliberately invisible to the online bandit:
 *   - **escalations** (`escalatedFrom IS NOT NULL`) run one tier up under the user's own arm id,
 *     so counting them makes the challenger look dear and bad (build-notes, Agent I);
 *   - **batched calls** (`stopReason LIKE 'batch:%'`) are offline work — an eval run, a nightly
 *     refill — with no user and no rating. Folding them in would drown the posteriors in the
 *     unrated prior and let an eval run move production traffic.
 */
export async function windowStats(
  prisma: PrismaClient,
  since: Date,
  until: Date,
): Promise<WindowArmStats[]> {
  const rows = await prisma.$queryRaw<RawWindowRow[]>`
    SELECT g."generator"::text AS "generator",
           g."variantId",
           count(*) AS "calls",
           sum(g."costUsd")::double precision AS "cost",
           count(*) FILTER (
             WHERE rt."up" IS TRUE AND rt."down" IS NOT TRUE AND rt."regen" IS NOT TRUE
               AND regexp_replace(g."stopReason", '^batch:', '') NOT IN ('error','refusal','invalid_json')
           ) AS "good",
           count(*) FILTER (
             WHERE rt."down" IS TRUE OR rt."regen" IS TRUE
               OR regexp_replace(g."stopReason", '^batch:', '') IN ('error','refusal','invalid_json')
           ) AS "bad",
           count(*) FILTER (WHERE rt."regen" IS TRUE) AS "regenerations",
           count(*) FILTER (WHERE g."safetyVerdict"::text IN ('block','soften')) AS "safetyFlags",
           count(*) FILTER (
             WHERE regexp_replace(g."stopReason", '^batch:', '') IN ('error','refusal','invalid_json')
           ) AS "fallbacks"
    FROM "GenerationLog" g
    LEFT JOIN LATERAL (
      SELECT bool_or(r."value" > 0) AS "up",
             bool_or(r."value" < 0) AS "down",
             bool_or(r."regenerate") AS "regen"
      FROM "Rating" r WHERE r."generationId" = g."id"
    ) rt ON TRUE
    WHERE g."createdAt" > ${since} AND g."createdAt" <= ${until}
      AND g."escalatedFrom" IS NULL
      AND g."stopReason" NOT LIKE 'batch:%'
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  return rows.map((r) => {
    const calls = Number(r.calls);
    const good = Number(r.good);
    const bad = Number(r.bad);
    return {
      generator: r.generator,
      variantId: r.variantId,
      calls,
      costUsd: round(Number(r.cost ?? 0)),
      good,
      bad,
      unrated: Math.max(0, calls - good - bad),
      regenerations: Number(r.regenerations),
      safetyFlags: Number(r.safetyFlags),
      fallbacks: Number(r.fallbacks),
    };
  });
}

/* ------------------------------------------------------------- watermark ---- */

export async function readWatermark(prisma: PrismaClient, generator: string): Promise<Date | null> {
  const row = await prisma.promotionEvent.findFirst({
    where: { generator, reason: WATERMARK_REASON },
    orderBy: { createdAt: "desc" },
  });
  const at = (row?.metrics as { at?: string } | null)?.at;
  if (typeof at !== "string") return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function writeWatermark(prisma: PrismaClient, generator: string, at: Date, folded: number): Promise<void> {
  const existing = await prisma.promotionEvent.findFirst({
    where: { generator, reason: WATERMARK_REASON },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const metrics = { at: at.toISOString(), folded };
  if (existing) {
    await prisma.promotionEvent.update({ where: { id: existing.id }, data: { metrics } });
    return;
  }
  await prisma.promotionEvent.create({
    data: { generator, fromVariant: null, toVariant: "-", reason: WATERMARK_REASON, metrics },
  });
}

/* ------------------------------------------------------------ the fold ---- */

export interface UpdateResult {
  generators: string[];
  arms: number;
  calls: number;
  until: string;
}

/**
 * Fold everything logged since the watermark into the posteriors.
 *
 * Rewards are folded per quality class rather than per row: within one (arm, window) the cost
 * ratio is the same for every call, so `good`, `bad` and `unrated` counts plus the arm's mean cost
 * reproduce the per-call reward exactly — and it is one `GROUP BY` instead of a row scan.
 */
export async function updateFromLogs(
  prisma: PrismaClient,
  now: Date,
  opts: { since?: Date } = {},
): Promise<UpdateResult> {
  await ensureArms(prisma);
  const arms = await loadArms(prisma);
  const generators = [...new Set(arms.map((a) => a.generator))];
  const result: UpdateResult = { generators, arms: 0, calls: 0, until: now.toISOString() };

  for (const generator of generators) {
    const watermark = opts.since ?? (await readWatermark(prisma, generator)) ?? new Date(now.getTime() - FOLD_BACKFILL_MS);
    if (watermark.getTime() >= now.getTime()) {
      await writeWatermark(prisma, generator, now, 0);
      continue;
    }
    const stats = (await windowStats(prisma, watermark, now)).filter((s) => s.generator === generator);
    const armsHere = arms.filter((a) => a.generator === generator);
    const champion = armsHere.find((a) => a.isChampion) ?? armsHere[0];
    const championWindow = stats.find((s) => s.variantId === champion?.variantId);
    const championCost =
      championWindow !== undefined && championWindow.calls > 0
        ? championWindow.costUsd / championWindow.calls
        : champion !== undefined && champion.calls > 0
          ? champion.costSum / champion.calls
          : 0;

    for (const s of stats) {
      if (s.calls === 0) continue;
      const arm = armsHere.find((a) => a.variantId === s.variantId);
      if (arm === undefined) continue; // a variant that is not in the registry is not an arm
      const costPerCall = s.costUsd / s.calls;
      const reward = (rating: number | null, fallback: boolean): number =>
        rewardFor({
          signals: { rating, regenerated: false, fallback },
          costUsd: costPerCall,
          championCostUsd: championCost,
          lambda: BANDIT_LAMBDA,
        });
      const rGood = reward(1, false);
      const rBad = reward(-1, false);
      const rUnrated = reward(null, false);

      const alphaAdd = s.good * rGood + s.bad * rBad + s.unrated * rUnrated;
      const betaAdd = s.good * (1 - rGood) + s.bad * (1 - rBad) + s.unrated * (1 - rUnrated);

      await prisma.banditArm.update({
        where: { generator_variantId: { generator, variantId: s.variantId } },
        data: {
          alpha: { increment: round(alphaAdd, 8) },
          beta: { increment: round(betaAdd, 8) },
          calls: { increment: s.calls },
          rewardSum: { increment: round(alphaAdd, 8) },
          costSum: { increment: s.costUsd },
        },
      });
      result.arms += 1;
      result.calls += s.calls;
    }

    await writeWatermark(prisma, generator, now, stats.reduce((n, s) => n + s.calls, 0));
  }
  return result;
}

/* ------------------------------------------------------------ guardrails ---- */

export interface GuardrailResult {
  disabled: Array<{ generator: string; variantId: string; metric: string; value: number; limit: number }>;
  checked: number;
}

/**
 * §6.3's automatic rollback. An arm that breaches a guardrail over the last day is disabled and the
 * breach is written to `PromotionEvent`; the champion is never disabled (there would be nothing to
 * fall back to) and neither is an arm with too few calls to judge.
 */
export async function checkGuardrails(
  prisma: PrismaClient,
  now: Date,
  opts: { windowMs?: number; minCalls?: number } = {},
): Promise<GuardrailResult> {
  const since = new Date(now.getTime() - (opts.windowMs ?? GUARDRAIL_WINDOW_MS));
  const stats = await windowStats(prisma, since, now);
  const arms = await loadArms(prisma);
  const out: GuardrailResult = { disabled: [], checked: stats.length };

  for (const s of stats) {
    const arm = arms.find((a) => a.generator === s.generator && a.variantId === s.variantId);
    if (arm === undefined || arm.isChampion || arm.disabled) continue;
    const breach = guardrailBreach(
      { calls: s.calls, regenerations: s.regenerations, safetyFlags: s.safetyFlags, fallbacks: s.fallbacks },
      opts.minCalls,
    );
    if (breach === null) continue;

    const reason = `guardrail:${breach.metric}`;
    await prisma.banditArm.update({
      where: { generator_variantId: { generator: s.generator, variantId: s.variantId } },
      data: { disabledAt: now, disabledReason: `${breach.metric} ${breach.value} > ${breach.limit}` },
    });
    const champion = arms.find((a) => a.generator === s.generator && a.isChampion);
    await prisma.promotionEvent.create({
      data: {
        generator: s.generator,
        fromVariant: s.variantId,
        toVariant: champion?.variantId ?? s.variantId,
        reason,
        metrics: {
          metric: breach.metric,
          value: breach.value,
          limit: breach.limit,
          calls: s.calls,
          windowMs: opts.windowMs ?? GUARDRAIL_WINDOW_MS,
        },
      },
    });
    out.disabled.push({ generator: s.generator, variantId: s.variantId, metric: breach.metric, value: breach.value, limit: breach.limit });
  }
  return out;
}

/* ------------------------------------------------------------- promotion ---- */

export interface PromoteResult {
  generator: string;
  champion: string;
  previous: string | null;
}

/** Move `isChampion` and record why. Used by both auto-promotion and the manual override. */
export async function promoteVariant(
  prisma: PrismaClient,
  args: { generator: string; variantId: string; reason: string; metrics?: Record<string, unknown> },
): Promise<PromoteResult | null> {
  await ensureArms(prisma);
  const arms = await loadArms(prisma, args.generator);
  const target = arms.find((a) => a.variantId === args.variantId);
  if (target === undefined) return null;
  const previous = arms.find((a) => a.isChampion) ?? null;
  if (previous !== null && previous.variantId === target.variantId) {
    return { generator: args.generator, champion: target.variantId, previous: previous.variantId };
  }

  await prisma.$transaction([
    prisma.banditArm.updateMany({ where: { generator: args.generator }, data: { isChampion: false } }),
    prisma.banditArm.update({
      where: { generator_variantId: { generator: args.generator, variantId: args.variantId } },
      // a promoted arm is never left disabled: promotion is the statement that it is the safe one
      data: { isChampion: true, disabledAt: null, disabledReason: null },
    }),
    prisma.promotionEvent.create({
      data: {
        generator: args.generator,
        fromVariant: previous?.variantId ?? null,
        toVariant: args.variantId,
        reason: args.reason,
        metrics: (args.metrics ?? {}) as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { generator: args.generator, champion: args.variantId, previous: previous?.variantId ?? null };
}

export interface MaybePromoteResult {
  generator: string;
  promoted: boolean;
  from: string | null;
  to: string | null;
  reason: string;
  pBest: number;
  calls: number;
}

/**
 * Auto-promotion. Requires all of: the leader beats the champion on posterior mean, has
 * `BANDIT_PROMOTION.MIN_CALLS` calls, `p(best) >= P_BEST`, **and** has passed the §6.2 offline
 * gate. The offline gate is the reason a cheaper-but-worse arm cannot promote itself on price.
 */
export async function maybePromote(
  prisma: PrismaClient,
  generator: string,
  opts: { minCalls?: number; pBestMin?: number } = {},
): Promise<MaybePromoteResult> {
  const arms = await loadArms(prisma, generator);
  const champion = arms.find((a) => a.isChampion) ?? null;
  const gatePassed = await gatePassedVariants(prisma, generator, champion?.variantId ?? null);
  const decision = promotionDecision({
    arms,
    gatePassed,
    ...(opts.minCalls !== undefined ? { minCalls: opts.minCalls } : {}),
    ...(opts.pBestMin !== undefined ? { pBestMin: opts.pBestMin } : {}),
  });

  if (!decision.promote || decision.to === null) {
    return { generator, promoted: false, from: decision.from, to: decision.to, reason: decision.reason, pBest: decision.pBest, calls: decision.calls };
  }
  await promoteVariant(prisma, {
    generator,
    variantId: decision.to,
    reason: "auto:thompson+gate",
    metrics: { pBest: decision.pBest, calls: decision.calls, minCalls: opts.minCalls ?? BANDIT_PROMOTION.MIN_CALLS },
  });
  return { generator, promoted: true, from: decision.from, to: decision.to, reason: decision.reason, pBest: decision.pBest, calls: decision.calls };
}

/** The whole hourly job in one call: fold, guardrail, then try to promote. */
export async function refreshBandit(
  prisma: PrismaClient,
  now: Date,
  opts: { minCalls?: number; pBestMin?: number; guardrailMinCalls?: number } = {},
): Promise<{ update: UpdateResult; guardrails: GuardrailResult; promotions: MaybePromoteResult[] }> {
  const update = await updateFromLogs(prisma, now);
  const guardrails = await checkGuardrails(prisma, now, opts.guardrailMinCalls === undefined ? {} : { minCalls: opts.guardrailMinCalls });
  const promotions: MaybePromoteResult[] = [];
  for (const generator of update.generators) {
    promotions.push(await maybePromote(prisma, generator, opts));
  }
  return { update, guardrails, promotions };
}

/* ------------------------------------------------------------- the state ---- */

export interface BanditArmView {
  generator: string;
  variantId: string;
  model: string;
  tier: string;
  isChampion: boolean;
  disabled: boolean;
  disabledReason: string | null;
  calls: number;
  meanReward: number;
  ci: [number, number];
  usdPerCall: number;
  allocation: number;
}

export interface BanditStateView {
  generators: Array<{ generator: string; champion: string; arms: BanditArmView[]; pBest: number; promotable: boolean }>;
  lambda: number;
  updatedAt: string;
}

const VARIANT_META = new Map(
  GENERATOR_EXPERIMENTS.flatMap((e) => e.variants.map((v) => [v.id, v] as const)),
);

function modelForTierName(tier: string): string {
  switch (tier) {
    case "high":
      return process.env.LLM_MODEL_HIGH ?? "claude-opus-5";
    case "mid":
      return process.env.LLM_MODEL_MID ?? "claude-sonnet-5";
    default:
      return process.env.LLM_MODEL_LIGHT ?? "claude-haiku-4-5";
  }
}

/** `GET /v1/bandit` — arms, posteriors, allocation and whether the leader could be promoted. */
export async function banditState(prisma: PrismaClient, now: Date): Promise<BanditStateView> {
  await ensureArms(prisma);
  const arms = await loadArms(prisma);
  const recent = await windowStats(prisma, new Date(now.getTime() - GUARDRAIL_WINDOW_MS), now);
  const registryChampions = championVariants();

  const byGenerator = new Map<string, ArmRow[]>();
  for (const arm of arms) {
    const list = byGenerator.get(arm.generator) ?? [];
    list.push(arm);
    byGenerator.set(arm.generator, list);
  }

  const generators: BanditStateView["generators"] = [];
  for (const [generator, list] of [...byGenerator].sort(([a], [b]) => a.localeCompare(b))) {
    const champion = list.find((a) => a.isChampion)?.variantId ?? registryChampions[generator] ?? list[0]?.variantId ?? "";
    const probabilities = pBestByArm(list);
    const recentHere = recent.filter((r) => r.generator === generator);
    const recentTotal = recentHere.reduce((n, r) => n + r.calls, 0);
    const lifetimeTotal = list.reduce((n, a) => n + a.calls, 0);

    const views: BanditArmView[] = list.map((arm) => {
      const meta = VARIANT_META.get(arm.variantId);
      const recentCalls = recentHere.find((r) => r.variantId === arm.variantId)?.calls ?? 0;
      const allocation =
        recentTotal > 0 ? recentCalls / recentTotal : lifetimeTotal > 0 ? arm.calls / lifetimeTotal : 0;
      return {
        generator: arm.generator,
        variantId: arm.variantId,
        model: modelForTierName(meta?.tier ?? "mid"),
        tier: meta?.tier ?? "mid",
        isChampion: arm.isChampion,
        disabled: arm.disabled,
        disabledReason: arm.disabledReason,
        calls: arm.calls,
        meanReward: Math.round(posteriorMean(arm) * 1e4) / 1e4,
        ci: credibleInterval(arm),
        usdPerCall: arm.calls > 0 ? round(arm.costSum / arm.calls, 8) : 0,
        allocation: Math.round(allocation * 1e4) / 1e4,
      };
    });

    const leaderId = [...probabilities.entries()].sort((a, b) => b[1] - a[1])[0];
    const pBest = leaderId?.[1] ?? 0;
    const gatePassed = await gatePassedVariants(prisma, generator, champion);
    const decision = promotionDecision({ arms: list, gatePassed });
    generators.push({ generator, champion, arms: views, pBest: Math.round(pBest * 1e4) / 1e4, promotable: decision.promote });
  }

  return { generators, lambda: BANDIT_LAMBDA, updatedAt: now.toISOString() };
}

/* ------------------------------------------------------------ allocation ---- */

/**
 * The allocator the gateway calls. It cannot await, so it reads a snapshot that
 * `refreshAllocatorSnapshot` keeps warm; with no snapshot (or no data) it returns `null` and the
 * gateway falls back to the deterministic sticky assignment in `experiments.ts`.
 *
 * Wiring (one line, in `apps/api/src/index.ts`, whoever owns it):
 *   `const { gateway } = await loadGateway({ allocate: banditAllocate });`
 * and call `refreshAllocatorSnapshot(prisma)` from the hourly `bandit-update` job.
 */
let snapshot: ArmState[] = [];
let snapshotAt: Date | null = null;

export async function refreshAllocatorSnapshot(prisma: PrismaClient, now = new Date()): Promise<number> {
  snapshot = await loadArms(prisma);
  snapshotAt = now;
  return snapshot.length;
}

export function allocatorSnapshotAt(): Date | null {
  return snapshotAt;
}

/** Clears the snapshot — used by tests so one case cannot leak into the next. */
export function clearAllocatorSnapshot(): void {
  snapshot = [];
  snapshotAt = null;
}

export function banditAllocate(generator: string, userId: string | null, now = new Date()): string | null {
  const arms = snapshot.filter((a) => a.generator === generator);
  if (arms.length === 0) return null;
  return allocate({ generator, arms, userId, day: dayKey(now), floor: BANDIT_FLOOR });
}

export const GUARDRAILS = BANDIT_GUARDRAILS;
