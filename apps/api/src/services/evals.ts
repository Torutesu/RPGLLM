/**
 * The offline evaluation gate (cost-architecture §6.2) — persistence side.
 *
 * `packages/llm` owns the maths (`runEval`, the machine checks, the judge and `evaluateGate`);
 * this file owns the frozen case set in Postgres, the run bookkeeping (`EvalRun` / `EvalResult`)
 * and the comparison the promotion decision reads.
 *
 * **Deviation from §6.2, recorded here and in build-notes.** §6.2 says "150 cases sampled from
 * production logs". `GenerationLog` stores a `promptHash`, never the input, so a production case
 * cannot be replayed from a log row. Instead the seeder reconstructs cases **from the rows the
 * action was made of** — a real `Post`, its persona, its world, its relationships — through the
 * very same builders the live G1 path uses (`services/story.ts`). Hand-written hard cases come
 * from `@rpgllm/llm`'s frozen list. When the database has no posts yet (a fresh install, CI), the
 * set is filled entirely from the frozen list, so an eval is always runnable.
 */
import type { PrismaClient, EvalStatus } from "@prisma/client";
import { G1InputZ, EVAL_SET_SIZE, PACING, type G1Input } from "@rpgllm/shared";
import {
  evaluateGate,
  frozenEvalCases,
  runEval,
  type EvalCaseRun,
  type EvalRunResult,
} from "@rpgllm/llm";
import { localized } from "./locale";
import { logGeneration } from "./generation";
import { normHandle } from "./handles";
import type { Deps } from "../types";

export interface SeedEvalCasesResult {
  generator: string;
  created: number;
  fromProduction: number;
  total: number;
}

const GENERATOR = "G1";

/** Frozen-set identity: (generator, label). Labels are unique inside a generator by construction. */
async function upsertCase(
  prisma: PrismaClient,
  row: { generator: string; locale: string; worldSlug: string; label: string; frozen: boolean; input: unknown },
): Promise<boolean> {
  const existing = await prisma.evalCase.findFirst({
    where: { generator: row.generator, label: row.label },
    select: { id: true },
  });
  if (existing) {
    await prisma.evalCase.update({
      where: { id: existing.id },
      data: { locale: row.locale, worldSlug: row.worldSlug, frozen: row.frozen, input: row.input as object },
    });
    return false;
  }
  await prisma.evalCase.create({
    data: {
      generator: row.generator,
      locale: row.locale,
      worldSlug: row.worldSlug,
      label: row.label,
      frozen: row.frozen,
      input: row.input as object,
    },
  });
  return true;
}

/**
 * Real cases rebuilt from real rows: the last N player posts, each turned back into the G1 input
 * that produced it. `frozen: false` marks them as resamplable — the hand-written ones are not.
 */
export async function productionCases(prisma: PrismaClient, limit: number): Promise<Array<{ label: string; locale: string; worldSlug: string; input: G1Input }>> {
  if (limit <= 0) return [];
  const posts = await prisma.post.findMany({
    where: { kind: "user" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      persona: { include: { world: true, user: true } },
      parent: { include: { authorCharacter: true } },
    },
  });

  const out: Array<{ label: string; locale: string; worldSlug: string; input: G1Input }> = [];
  for (const [i, post] of posts.entries()) {
    const persona = post.persona;
    if (!persona) continue;
    const world = persona.world;
    const user = persona.user;
    const locale = user.locale;
    const [characters, relationships, feed] = await Promise.all([
      prisma.worldCharacter.findMany({ where: { worldId: world.id }, orderBy: { handle: "asc" } }),
      prisma.relationshipState.findMany({ where: { personaId: persona.id }, orderBy: { affinity: "desc" }, take: 3 }),
      prisma.post.findMany({
        where: { personaId: persona.id, createdAt: { lt: post.createdAt } },
        orderBy: { createdAt: "desc" },
        take: PACING.FEED_RECENT_FOR_PROMPT,
        include: { authorCharacter: true },
      }),
    ]);
    if (characters.length === 0) continue;
    const byId = new Map(characters.map((c) => [c.id, c]));

    const input: G1Input = {
      userId: null, // an eval case is nobody's traffic
      locale,
      worldSlug: world.slug,
      worldBible: localized(world.bible, locale),
      isMinor: user.isMinor,
      persona: {
        handle: persona.handle,
        displayName: persona.displayName,
        bio: persona.bio,
        voiceNotes: persona.voiceNotes,
        followers: persona.followers,
        aura: persona.aura,
        humor: persona.humor,
        level: persona.level,
        worldSummary: persona.worldSummary,
      },
      cast: characters.map((c) => ({
        handle: normHandle(c.handle),
        displayName: c.displayName,
        role: c.role,
        card: localized(c.card, locale),
        isPressAccount: c.isPressAccount,
      })),
      involved: relationships
        .map((r) => {
          const ch = byId.get(r.characterId);
          return ch === undefined
            ? null
            : { handle: normHandle(ch.handle), affinity: r.affinity, summary: r.summary, isFollower: r.isFollower };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .slice(0, 3),
      recentFeed: feed.map((f) => ({
        authorHandle: f.authorCharacter ? normHandle(f.authorCharacter.handle) : persona.handle,
        kind: f.kind,
        text: f.text,
      })),
      post: {
        text: post.text,
        parentAuthorHandle: post.parent?.authorCharacter ? normHandle(post.parent.authorCharacter.handle) : null,
        parentText: post.parent?.text ?? null,
      },
      k: PACING.K_INITIAL,
      softened: false,
      seed: post.id.split("").reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7),
      includeNews: false,
    };
    const check = G1InputZ.safeParse(input);
    if (!check.success) continue;
    out.push({ label: `prod:${String(i).padStart(3, "0")}`, locale, worldSlug: world.slug, input: check.data });
  }
  return out;
}

/**
 * Make sure the frozen set exists and is `EVAL_SET_SIZE` cases. Production cases are added first
 * (they are what the product actually sees); the hand-written hard cases always survive.
 */
export async function seedEvalCases(
  prisma: PrismaClient,
  opts: { size?: number; productionShare?: number } = {},
): Promise<SeedEvalCasesResult> {
  const size = opts.size ?? EVAL_SET_SIZE;
  const frozen = frozenEvalCases(size);
  const hard = frozen.filter((c) => c.label.startsWith("hard:"));
  const wantProduction = Math.max(0, Math.floor((opts.productionShare ?? 0.5) * size));
  const production = await productionCases(prisma, Math.min(wantProduction, Math.max(0, size - hard.length)));

  let created = 0;
  for (const c of hard) {
    if (await upsertCase(prisma, { generator: GENERATOR, locale: c.locale, worldSlug: c.worldSlug, label: c.label, frozen: true, input: c.input })) created += 1;
  }
  for (const p of production) {
    if (await upsertCase(prisma, { generator: GENERATOR, locale: p.locale, worldSlug: p.worldSlug, label: p.label, frozen: false, input: p.input })) created += 1;
  }
  // Fill whatever is left from the frozen pool, so the set is always the full size.
  for (const c of frozen.filter((f) => !f.label.startsWith("hard:"))) {
    const count = await prisma.evalCase.count({ where: { generator: GENERATOR } });
    if (count >= size) break;
    if (await upsertCase(prisma, { generator: GENERATOR, locale: c.locale, worldSlug: c.worldSlug, label: c.label, frozen: true, input: c.input })) created += 1;
  }

  // The set is *frozen at EVAL_SET_SIZE*: when new production cases arrive, filler cases make room
  // for them rather than the set growing run over run (which would make scores incomparable).
  const over = (await prisma.evalCase.count({ where: { generator: GENERATOR } })) - size;
  if (over > 0) {
    const surplus = await prisma.evalCase.findMany({
      where: { generator: GENERATOR, label: { startsWith: "pool:" } },
      orderBy: { createdAt: "desc" },
      take: over,
      select: { id: true },
    });
    if (surplus.length > 0) {
      await prisma.evalCase.deleteMany({ where: { id: { in: surplus.map((s2) => s2.id) } } });
    }
  }

  const total = await prisma.evalCase.count({ where: { generator: GENERATOR } });
  return { generator: GENERATOR, created, fromProduction: production.length, total };
}

export async function loadCases(prisma: PrismaClient, generator: string, limit: number): Promise<EvalCaseRun[]> {
  const rows = await prisma.evalCase.findMany({
    where: { generator },
    orderBy: [{ frozen: "desc" }, { createdAt: "asc" }],
    take: limit,
  });
  return rows.map((r) => ({
    key: r.id,
    label: r.label,
    locale: r.locale === "ja" ? "ja" : "en",
    worldSlug: r.worldSlug,
    input: r.input as unknown,
  }));
}

export interface StartEvalArgs {
  generator: string;
  variantId: string;
  limit: number;
}

/**
 * One evaluation run, end to end: seed the set if it is empty, execute it through the batch tier,
 * persist every case's score. Never throws — a failed run is recorded with `status: "failed"` so
 * the comparison can ignore it.
 */
export async function startEvalRun(deps: Deps, args: StartEvalArgs): Promise<{ runId: string; result: EvalRunResult | null; status: EvalStatus }> {
  const existing = await deps.prisma.evalCase.count({ where: { generator: args.generator } });
  if (existing === 0) await seedEvalCases(deps.prisma);

  const cases = await loadCases(deps.prisma, args.generator, args.limit);
  const run = await deps.prisma.evalRun.create({
    data: { generator: args.generator, variantId: args.variantId, status: "running", cases: cases.length },
    select: { id: true },
  });

  try {
    const result = await runEval(deps.gateway, {
      generator: args.generator,
      variantId: args.variantId,
      cases,
    });
    for (const r of result.results) {
      // CLAUDE.md rule 5: every LLM call lands in GenerationLog — the eval's own spend included,
      // which is what puts an eval run into the §5.4 batch split of the cost dashboard.
      for (const meta of r.metas) await logGeneration(deps.prisma, meta, null);
      await deps.prisma.evalResult.create({
        data: {
          runId: run.id,
          caseId: r.key,
          scores: {
            machine: r.machine,
            machineScore: r.machineScore,
            judge: r.judge,
            judgeVerdict: r.judgeVerdict,
            judgeScore: r.judgeScore,
          },
          score: r.score,
          passed: r.passed,
          costUsd: r.costUsd.toFixed(6),
          latencyMs: r.latencyMs,
        },
      });
    }
    await deps.prisma.evalRun.update({
      where: { id: run.id },
      data: {
        status: "finished",
        cases: result.cases,
        passed: result.passed,
        meanScore: result.meanScore,
        costUsd: result.costUsd.toFixed(6),
        notes: `generator $${result.generatorCostUsd.toFixed(6)} + judge $${result.judgeCostUsd.toFixed(6)} (batch tier)`,
        finishedAt: deps.clock.now(),
      },
    });
    return { runId: run.id, result, status: "finished" };
  } catch (err) {
    await deps.prisma.evalRun.update({
      where: { id: run.id },
      data: { status: "failed", notes: String(err).slice(0, 400), finishedAt: deps.clock.now() },
    });
    return { runId: run.id, result: null, status: "failed" };
  }
}

export interface EvalRunRow {
  id: string;
  generator: string;
  variantId: string;
  status: EvalStatus;
  cases: number;
  passed: number;
  meanScore: number;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

export async function listEvalRuns(prisma: PrismaClient, generator?: string, limit = 50): Promise<EvalRunRow[]> {
  const rows = await prisma.evalRun.findMany({
    where: generator ? { generator } : {},
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    generator: r.generator,
    variantId: r.variantId,
    status: r.status,
    cases: r.cases,
    passed: r.passed,
    meanScore: r.meanScore,
    costUsd: Number(r.costUsd),
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}

export interface CompareRow {
  variantId: string;
  runs: number;
  cases: number;
  passRate: number;
  meanScore: number;
  usdPerCase: number;
  costDelta: number;
  scoreDelta: number;
  passesGate: boolean;
}

interface RawCompareRow {
  variantId: string;
  runs: bigint;
  cases: bigint | null;
  passed: bigint | null;
  score: number | null;
  cost: number | null;
}

const round = (n: number, p = 4): number => Math.round(n * 10 ** p) / 10 ** p;

/**
 * The §6.2 comparison table. Aggregated in SQL over finished runs; the champion (from the arm
 * table, falling back to the registry champion) is the baseline every other row is measured
 * against, and `passesGate` is `evaluateGate` from `@rpgllm/llm`.
 */
export async function compareEvals(
  prisma: PrismaClient,
  generator: string,
  championVariantId: string | null,
): Promise<{ generator: string; rows: CompareRow[] }> {
  const raw = await prisma.$queryRaw<RawCompareRow[]>`
    SELECT r."variantId",
           count(*) AS "runs",
           sum(r."cases") AS "cases",
           sum(r."passed") AS "passed",
           sum(r."meanScore" * r."cases")::double precision AS "score",
           sum(r."costUsd")::double precision AS "cost"
    FROM "EvalRun" r
    WHERE r."generator" = ${generator} AND r."status" = 'finished' AND r."cases" > 0
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const rows = raw.map((r) => {
    const cases = Number(r.cases ?? 0);
    return {
      variantId: r.variantId,
      runs: Number(r.runs),
      cases,
      passRate: cases === 0 ? 0 : round(Number(r.passed ?? 0) / cases),
      meanScore: cases === 0 ? 0 : round(Number(r.score ?? 0) / cases, 2),
      usdPerCase: cases === 0 ? 0 : round(Number(r.cost ?? 0) / cases, 8),
    };
  });

  const champion =
    rows.find((r) => r.variantId === championVariantId) ??
    // no run for the champion yet: the best-covered row stands in as the baseline
    [...rows].sort((a, b) => b.cases - a.cases)[0];

  const out: CompareRow[] = rows.map((r) => {
    if (champion === undefined || r.variantId === champion.variantId) {
      return { ...r, costDelta: 0, scoreDelta: 0, passesGate: true };
    }
    const gate = evaluateGate({
      score: r.meanScore,
      usdPerCase: r.usdPerCase,
      championScore: champion.meanScore,
      championUsdPerCase: champion.usdPerCase,
    });
    return { ...r, costDelta: gate.costDelta, scoreDelta: gate.scoreDelta, passesGate: gate.passesGate };
  });

  return { generator, rows: out };
}

/** Variant ids that currently clear the offline gate — the set `maybePromote` requires. */
export async function gatePassedVariants(
  prisma: PrismaClient,
  generator: string,
  championVariantId: string | null,
): Promise<Set<string>> {
  const { rows } = await compareEvals(prisma, generator, championVariantId);
  return new Set(rows.filter((r) => r.passesGate && r.variantId !== championVariantId).map((r) => r.variantId));
}
