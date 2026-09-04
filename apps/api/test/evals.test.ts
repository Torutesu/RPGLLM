import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { BATCH_DISCOUNT, EVAL_GATE, EVAL_SET_SIZE, EvalCompareResZ, EvalRunsResZ, G1InputZ } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness } from "./helpers";
import { compareEvals, gatePassedVariants, seedEvalCases } from "../src/services/evals";
import { ensureArms } from "../src/services/bandit";
import { costReport, costWindow } from "../src/services/cost";

/**
 * §6.2 — the offline evaluation gate, end to end on the batch tier.
 *
 * The gateway under test is the injected `FakeGateway`, so these cases assert the *plumbing*:
 * the frozen set, the run bookkeeping, that every call is billed at `BATCH_DISCOUNT` and marked
 * batched, and that the gate arithmetic is `EVAL_GATE`. The scoring itself is unit-tested in
 * `packages/llm/src/eval.test.ts`.
 */

const CHAMP = "g1-sonnet-v1";
const CHALLENGER = "g1-haiku-v1";

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});
afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "EvalResult", "EvalRun", "EvalCase", "PromotionEvent", "BanditArm" RESTART IDENTITY CASCADE`);
});

describe("the frozen case set", () => {
  it("seeds EVAL_SET_SIZE cases including every hand-written hard case, and is idempotent", async () => {
    const first = await call<{ total: number; created: number; fromProduction: number }>(h, "POST", "/v1/evals/seed");
    expect(first.status).toBe(200);
    expect(first.data.total).toBe(EVAL_SET_SIZE);
    expect(first.data.created).toBe(EVAL_SET_SIZE);

    const hard = await prisma.evalCase.findMany({ where: { generator: "G1", label: { startsWith: "hard:" } } });
    expect(hard.length).toBeGreaterThanOrEqual(15);
    for (const topic of ["drama", "heartbreak", "honorifics", "abusive", "borderline-safety"]) {
      expect(hard.some((c) => c.label.includes(topic))).toBe(true);
    }
    expect(hard.some((c) => c.locale === "ja")).toBe(true);
    for (const c of hard) expect(G1InputZ.safeParse(c.input).success).toBe(true);

    const second = await call<{ total: number; created: number }>(h, "POST", "/v1/evals/seed");
    expect(second.data.created).toBe(0);
    expect(second.data.total).toBe(EVAL_SET_SIZE);
  });

  it("rebuilds real cases from real posts (GenerationLog stores no input, the rows do)", async () => {
    const fixture = await signupWithPersona(h);
    await call(h, "POST", "/v1/posts", { token: fixture.token, body: { personaId: fixture.personaId, text: "the label moved the release again" } });

    const seeded = await seedEvalCases(prisma, { size: 30, productionShare: 0.5 });
    expect(seeded.fromProduction).toBeGreaterThan(0);

    const production = await prisma.evalCase.findMany({ where: { generator: "G1", label: { startsWith: "prod:" } } });
    expect(production.length).toBeGreaterThan(0);
    const parsed = G1InputZ.parse(production[0]?.input);
    expect(parsed.cast.length).toBeGreaterThan(0);
    expect(parsed.worldBible.length).toBeGreaterThan(100);
    expect(production[0]?.frozen).toBe(false); // resamplable, unlike the hand-written ones
  });
});

describe("running an eval", () => {
  it("runs the set through the batch tier, persists every case, and logs the spend", async () => {
    const res = await call<{ runId: string; status: string; cases: number; passed: number; meanScore: number; costUsd: number; judgeCostUsd: number }>(
      h,
      "POST",
      "/v1/evals/run",
      { body: { generator: "G1", variantId: CHALLENGER, limit: 5 } },
    );
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("finished");
    expect(res.data.cases).toBe(5);
    expect(res.data.meanScore).toBeGreaterThan(0);
    expect(res.data.costUsd).toBeGreaterThan(0);
    expect(res.data.judgeCostUsd).toBeGreaterThan(0);

    const results = await prisma.evalResult.findMany({ where: { runId: res.data.runId } });
    expect(results).toHaveLength(5);
    for (const r of results) {
      const scores = r.scores as { machine?: Record<string, boolean>; judge?: Record<string, number> };
      expect(Object.keys(scores.machine ?? {}).length).toBeGreaterThan(5);
      expect(Object.keys(scores.judge ?? {}).length).toBe(6);
      expect(Number(r.costUsd)).toBeGreaterThan(0);
    }

    // CLAUDE.md rule 5: every LLM call is in GenerationLog — 5 candidates + 5 judgements,
    // every one of them marked as batched.
    const logs = await prisma.generationLog.findMany({ where: { generator: { in: ["G1", "GJ"] } } });
    expect(logs).toHaveLength(10);
    expect(logs.filter((l) => l.generator === "GJ")).toHaveLength(5);
    for (const l of logs) expect(l.stopReason.startsWith("batch:")).toBe(true);
  });

  it("caps the run at StartEvalReqZ.limit and rejects a silly one", async () => {
    const capped = await call<{ cases: number }>(h, "POST", "/v1/evals/run", { body: { generator: "G1", variantId: CHAMP, limit: 3 } });
    expect(capped.data.cases).toBe(3);
    const bad = await call(h, "POST", "/v1/evals/run", { body: { generator: "G1", variantId: CHAMP, limit: 9999 } });
    expect(bad.status).toBe(400);
  });

  it("lists runs newest first in the contract shape", async () => {
    await call(h, "POST", "/v1/evals/run", { body: { generator: "G1", variantId: CHAMP, limit: 2 } });
    await call(h, "POST", "/v1/evals/run", { body: { generator: "G1", variantId: CHALLENGER, limit: 2 } });

    const res = await call<unknown>(h, "GET", "/v1/evals?generator=G1");
    const parsed = EvalRunsResZ.parse(res.data);
    expect(parsed.runs).toHaveLength(2);
    expect(parsed.runs[0]?.variantId).toBe(CHALLENGER);
    expect(parsed.runs[0]?.status).toBe("finished");
    expect(parsed.runs[0]?.finishedAt).not.toBeNull();
  });
});

describe("the comparison and the gate", () => {
  async function seedRun(variantId: string, meanScore: number, costUsd: number, cases = 50): Promise<void> {
    await prisma.evalRun.create({
      data: {
        generator: "G1",
        variantId,
        status: "finished",
        cases,
        passed: cases,
        meanScore,
        costUsd: costUsd.toFixed(6),
        finishedAt: new Date(),
      },
    });
  }

  it("passes a cheaper arm that stays within MAX_SCORE_DROP", async () => {
    await ensureArms(prisma);
    await seedRun(CHAMP, 80, 0.5);
    await seedRun(CHALLENGER, 80 - EVAL_GATE.MAX_SCORE_DROP, 0.5 * (1 - EVAL_GATE.MIN_COST_SAVING));

    const res = await call<unknown>(h, "GET", "/v1/evals/compare?generator=G1");
    const table = EvalCompareResZ.parse(res.data);
    const champion = table.rows.find((r) => r.variantId === CHAMP);
    const challenger = table.rows.find((r) => r.variantId === CHALLENGER);
    expect(champion?.passesGate).toBe(true); // the baseline
    expect(champion?.scoreDelta).toBe(0);
    expect(challenger?.scoreDelta).toBe(-EVAL_GATE.MAX_SCORE_DROP);
    expect(challenger?.costDelta).toBeCloseTo(-EVAL_GATE.MIN_COST_SAVING, 6);
    expect(challenger?.passesGate).toBe(true);
    expect(await gatePassedVariants(prisma, "G1", CHAMP)).toContain(CHALLENGER);
  });

  it("fails a cheap arm that drops too far, and one that is close but not cheap enough", async () => {
    await ensureArms(prisma);
    await seedRun(CHAMP, 80, 0.5);
    await seedRun(CHALLENGER, 80 - EVAL_GATE.MAX_SCORE_DROP - 1, 0.05);
    let table = await compareEvals(prisma, "G1", CHAMP);
    expect(table.rows.find((r) => r.variantId === CHALLENGER)?.passesGate).toBe(false);

    await prisma.evalRun.deleteMany({ where: { variantId: CHALLENGER } });
    await seedRun(CHALLENGER, 79.5, 0.5 * (1 - (EVAL_GATE.MIN_COST_SAVING / 2)));
    table = await compareEvals(prisma, "G1", CHAMP);
    expect(table.rows.find((r) => r.variantId === CHALLENGER)?.passesGate).toBe(false);
    expect(await gatePassedVariants(prisma, "G1", CHAMP)).not.toContain(CHALLENGER);
  });

  it("passes an arm that is clearly better even when it is dearer", async () => {
    await ensureArms(prisma);
    await seedRun(CHAMP, 80, 0.5);
    await seedRun(CHALLENGER, 80 + EVAL_GATE.MIN_SCORE_GAIN, 2.0);
    const table = await compareEvals(prisma, "G1", CHAMP);
    const challenger = table.rows.find((r) => r.variantId === CHALLENGER);
    expect(challenger?.costDelta).toBeGreaterThan(0);
    expect(challenger?.passesGate).toBe(true);
  });

  it("weights several runs of the same variant by their case counts", async () => {
    await ensureArms(prisma);
    await seedRun(CHAMP, 90, 0.5, 10);
    await seedRun(CHAMP, 70, 0.5, 30);
    const table = await compareEvals(prisma, "G1", CHAMP);
    // (90*10 + 70*30) / 40 = 75
    expect(table.rows.find((r) => r.variantId === CHAMP)?.meanScore).toBeCloseTo(75, 4);
    expect(table.rows.find((r) => r.variantId === CHAMP)?.runs).toBe(2);
  });

  it("ignores unfinished runs", async () => {
    await ensureArms(prisma);
    await seedRun(CHAMP, 80, 0.5);
    await prisma.evalRun.create({
      data: { generator: "G1", variantId: CHALLENGER, status: "running", cases: 50, passed: 0, meanScore: 0, costUsd: "0" },
    });
    const table = await compareEvals(prisma, "G1", CHAMP);
    expect(table.rows.map((r) => r.variantId)).toEqual([CHAMP]);
  });
});

describe("the saving lands in the cost dashboard (§5.4)", () => {
  it("splits batched from interactive spend and reports the realised discount", async () => {
    const fixture = await signupWithPersona(h);
    // one interactive action…
    await call(h, "POST", "/v1/posts", { token: fixture.token, body: { personaId: fixture.personaId, text: "new song friday" } });
    // …and one batched eval run
    await call(h, "POST", "/v1/evals/run", { body: { generator: "G1", variantId: CHALLENGER, limit: 4 } });

    const report = await costReport(prisma, costWindow(h.clock.now(), 1));
    expect(report.batch.batched.calls).toBe(8); // 4 candidates + 4 judgements
    expect(report.batch.interactive.calls).toBeGreaterThan(0);
    expect(report.batch.batchedCallShare).toBeGreaterThan(0);
    expect(report.batch.batchedCallShare).toBeLessThan(1);
    expect(report.batch.savedUsd).toBeGreaterThan(0);
    // the batched rows were billed at half of what those tokens cost interactively
    expect(report.batch.realisedDiscount).toBeCloseTo(1 - BATCH_DISCOUNT, 2);
    expect(report.batch.byGenerator.map((g) => g.generator).sort()).toEqual(["G1", "GJ"]);

    // and the batch marker does not disturb the fallback accounting
    expect(report.totals.fallbacks).toBe(0);

    const live = await call<{ calls: number }>(h, "GET", "/v1/cost/summary?days=1");
    expect(live.status).toBe(200);
  });
});
