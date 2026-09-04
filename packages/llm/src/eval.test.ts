import { beforeEach, describe, expect, it } from "vitest";
import { EVAL_GATE, EVAL_SET_SIZE, type G1Input, type G1Output } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { evaluateGate, machineChecksG1, machineScoreOf, runEval, EVAL_PASS_SCORE } from "./eval.js";
import { frozenEvalCases, HARD_CASES } from "./eval-cases.js";
import { scoreCandidateOffline, judgeScore01, GJ_RUBRIC } from "./generators/gj.js";
import { isBatchStopReason } from "./cost.js";
import { g1Input } from "./__testkit.js";

/** The offline evaluation gate (cost-architecture §6.2). */

beforeEach(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
  delete process.env.LLM_MODE;
});

const goodOutput = (input: G1Input): G1Output => {
  const handles = input.cast.filter((c) => !c.isPressAccount).map((c) => c.handle);
  const lines = ["ok that is genuinely mean", "screaming at this", "no because the timing", "fine. i said fine."];
  return {
    replies: handles.slice(0, input.k).map((h, i) => ({ characterHandle: h, text: lines[i] ?? "ok" })),
    stat_deltas: { followers: 2, aura: 1, humor: 1 },
    narrative: "The timeline moved a little.",
    relationship_deltas: {},
    memory_notes: [],
    news: null,
    safety_flag: false,
  };
};

describe("the frozen case set", () => {
  it("is exactly EVAL_SET_SIZE cases, deterministic, and always contains the hard ones", () => {
    const a = frozenEvalCases();
    const b = frozenEvalCases();
    expect(a).toHaveLength(EVAL_SET_SIZE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const hard of HARD_CASES) expect(a.some((c) => c.label === hard.label)).toBe(true);
    expect(new Set(a.map((c) => c.label)).size).toBe(a.length);
    for (const c of a) {
      expect(c.input.worldBible.length).toBeGreaterThan(1000);
      expect(c.input.cast.length).toBeGreaterThan(0);
    }
  });

  it("covers both locales and the hard categories the brief names", () => {
    const labels = HARD_CASES.map((c) => c.label).join(" ");
    for (const topic of ["drama", "heartbreak", "honorifics", "abusive", "borderline-safety"]) {
      expect(labels).toContain(topic);
    }
    expect(HARD_CASES.some((c) => c.locale === "ja")).toBe(true);
    expect(HARD_CASES.some((c) => c.locale === "en")).toBe(true);
  });
});

describe("machine checks", () => {
  const input = g1Input("popstar-era", "en", 1);

  it("passes a clean output", () => {
    const checks = machineChecksG1(input, goodOutput(input), false);
    for (const [name, value] of Object.entries(checks)) expect([name, value]).toEqual([name, true]);
    expect(machineScoreOf(checks)).toBe(1);
  });

  it("catches an unknown handle, a wrong K, an emoji wall and a repeat", () => {
    const bad = goodOutput(input);
    bad.replies[0] = { characterHandle: "someone_else", text: "🔥🔥🔥🔥" };
    bad.replies[1] = { characterHandle: bad.replies[1]?.characterHandle ?? "x", text: bad.replies[2]?.text ?? "dupe" };
    const checks = machineChecksG1(input, bad, false);
    expect(checks.handlesValid).toBe(false);
    expect(checks.emojiOk).toBe(false);
    expect(checks.diverse).toBe(false);
  });

  it("scores zero when an absolute check fails, whatever else passed", () => {
    const checks = machineChecksG1(input, goodOutput(input), true); // fallback
    expect(checks.notFallback).toBe(false);
    expect(machineScoreOf(checks)).toBe(0);
  });

  it("requires K replies", () => {
    const short = goodOutput(input);
    short.replies = short.replies.slice(0, 1);
    expect(machineChecksG1(input, short, false).kSatisfied).toBe(false);
  });
});

describe("the judge", () => {
  it("is deterministic and moves with the candidate", () => {
    const base = { locale: "en" as const, generator: "G1" as const, caseLabel: "t", context: "c" };
    const a = scoreCandidateOffline({ ...base, candidate: JSON.stringify({ replies: [{ text: "one" }, { text: "two" }] }) });
    const b = scoreCandidateOffline({ ...base, candidate: JSON.stringify({ replies: [{ text: "one" }, { text: "two" }] }) });
    const c = scoreCandidateOffline({ ...base, candidate: JSON.stringify({ replies: [{ text: "one" }, { text: "one" }] }) });
    expect(a).toEqual(b);
    expect(c.scores.diversity).toBeLessThan(a.scores.diversity);
  });

  it("fails outright on a safety breach and on an empty candidate", () => {
    const base = { locale: "en" as const, generator: "G1" as const, caseLabel: "t", context: "c" };
    const unsafe = scoreCandidateOffline({ ...base, candidate: JSON.stringify({ t: "here is an explicit sex scene with a 12 year old" }) });
    expect(unsafe.scores.safety).toBe(0);
    expect(unsafe.verdict).toBe("fail");
    expect(scoreCandidateOffline({ ...base, candidate: "{}" }).verdict).toBe("fail");
  });

  it("penalises an English-only answer in a Japanese case", () => {
    const base = { generator: "G1" as const, caseLabel: "t", context: "c", candidate: JSON.stringify({ a: "all english here", b: "still english" }) };
    expect(scoreCandidateOffline({ ...base, locale: "ja" }).scores.jpNaturalness).toBe(0);
    expect(scoreCandidateOffline({ ...base, locale: "en" }).scores.jpNaturalness).toBe(10);
  });

  it("weights the six axes to a 0..1 score", () => {
    expect(judgeScore01({ scores: { inCharacter: 10, diversity: 10, humour: 10, emoji: 10, safety: 10, jpNaturalness: 10 }, verdict: "pass", notes: "" })).toBe(1);
    expect(judgeScore01({ scores: { inCharacter: 0, diversity: 0, humour: 0, emoji: 0, safety: 0, jpNaturalness: 0 }, verdict: "fail", notes: "" })).toBe(0);
  });

  it("has a rubric prompt covering every axis the brief names", () => {
    for (const axis of ["inCharacter", "diversity", "humour", "emoji", "safety", "jpNaturalness"]) {
      expect((GJ_RUBRIC.en ?? "").toLowerCase()).toContain(axis.toLowerCase());
    }
  });
});

describe("runEval", () => {
  it("runs the set through the batch tier and scores every case", async () => {
    const gw = createGateway();
    const cases = frozenEvalCases(8).map((c) => ({
      key: c.key,
      label: c.label,
      locale: c.locale,
      worldSlug: c.worldSlug,
      input: c.input as unknown,
    }));
    const result = await runEval(gw, { generator: "G1", variantId: "g1-haiku-v1", cases });

    expect(result.cases).toBe(8);
    expect(result.results).toHaveLength(8);
    expect(result.meanScore).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.judgeCostUsd).toBeGreaterThan(0);
    for (const r of result.results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Object.keys(r.machine).length).toBeGreaterThan(5);
    }
    // the same set, run again, gives the same numbers
    const again = await runEval(createGateway(), { generator: "G1", variantId: "g1-haiku-v1", cases });
    expect(again.meanScore).toBe(result.meanScore);
  });

  it("bills the run on the batch tier (every logged call is marked)", async () => {
    const seen: string[] = [];
    const gw = createGateway({ onGeneration: (m) => { seen.push(m.stopReason); } });
    const cases = frozenEvalCases(3).map((c) => ({ key: c.key, label: c.label, locale: c.locale, worldSlug: c.worldSlug, input: c.input as unknown }));
    await runEval(gw, { generator: "G1", variantId: "g1-sonnet-v1", cases });
    expect(seen).toHaveLength(6); // 3 generations + 3 judgements
    for (const reason of seen) expect(isBatchStopReason(reason)).toBe(true);
  });

  it("scores an unusable case zero instead of dropping it", async () => {
    const gw = createGateway();
    const result = await runEval(gw, {
      generator: "G1",
      variantId: "g1-sonnet-v1",
      cases: [{ key: "broken", label: "broken", locale: "en", worldSlug: "popstar-era", input: { not: "a g1 input" } }],
    });
    expect(result.cases).toBe(1);
    expect(result.results[0]?.score).toBe(0);
    expect(result.passed).toBe(0);
  });
});

describe("the gate (§6.2)", () => {
  const champion = { championScore: 80, championUsdPerCase: 0.01 };

  it("passes a cheaper arm that stays within MAX_SCORE_DROP", () => {
    const v = evaluateGate({ ...champion, score: 80 - EVAL_GATE.MAX_SCORE_DROP, usdPerCase: 0.01 * (1 - EVAL_GATE.MIN_COST_SAVING) });
    expect(v.passesGate).toBe(true);
    expect(v.scoreDelta).toBe(-EVAL_GATE.MAX_SCORE_DROP);
    expect(v.costSaving).toBeCloseTo(EVAL_GATE.MIN_COST_SAVING, 6);
  });

  it("fails a cheaper arm that drops one point too far", () => {
    const v = evaluateGate({ ...champion, score: 80 - EVAL_GATE.MAX_SCORE_DROP - 0.1, usdPerCase: 0.001 });
    expect(v.passesGate).toBe(false);
  });

  it("fails an arm that is close on quality but not cheap enough", () => {
    const v = evaluateGate({ ...champion, score: 79.5, usdPerCase: 0.01 * (1 - (EVAL_GATE.MIN_COST_SAVING - 0.05)) });
    expect(v.passesGate).toBe(false);
    expect(v.costSaving).toBeLessThan(EVAL_GATE.MIN_COST_SAVING);
  });

  it("passes an arm that is clearly better even when it costs more", () => {
    const v = evaluateGate({ ...champion, score: 80 + EVAL_GATE.MIN_SCORE_GAIN, usdPerCase: 0.05 });
    expect(v.passesGate).toBe(true);
    expect(v.costDelta).toBeGreaterThan(0);
  });

  it("reports the deltas the dashboard prints", () => {
    const v = evaluateGate({ ...champion, score: 76, usdPerCase: 0.005 });
    expect(v.scoreDelta).toBe(-4);
    expect(v.costDelta).toBe(-0.5);
    expect(v.costSaving).toBe(0.5);
    expect(v.passesGate).toBe(false); // 4 points is more than MAX_SCORE_DROP, however cheap
  });

  it("EVAL_PASS_SCORE is the per-case bar, not the gate", () => {
    expect(EVAL_PASS_SCORE).toBeGreaterThan(0);
    expect(EVAL_PASS_SCORE).toBeLessThan(100);
  });
});
