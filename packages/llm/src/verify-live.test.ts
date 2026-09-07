import { beforeEach, describe, expect, it } from "vitest";
import type { GenerationMeta, WorldSeed } from "@rpgllm/shared";
import { deterministicWorld } from "./generators/g9/assemble.js";
import type { G9Input } from "./generators/g9/types.js";
import {
  castDistinctnessOf,
  jaccard,
  liveEvidenceOf,
  shingles,
  stageSpend,
  textOverlap,
} from "./verify-live/measure.js";
import { planRun, toEvalCases } from "./verify-live/plan.js";
import { renderHtml } from "./verify-live/report-html.js";
import { estimateBanner, renderText } from "./verify-live/report-text.js";
import { createStubLiveGateway, stubLiveWorld } from "./verify-live/stub-gateway.js";
import {
  createCollector,
  estimateRun,
  gemEconomics,
  preflightLive,
  runVerification,
  VerifyRefusal,
  API_KEY_ENV,
} from "./verify-live/run.js";
import { exitCodeFor, main, parseArgs, type CliIo } from "./verify-live/cli.js";
import type { VerifyReport } from "./verify-live/types.js";

/**
 * The live verification harness, exercised without a live key.
 *
 * What this file can prove: the harness refuses correctly, plans correctly, measures what it says
 * it measures, rolls up real usage into real prices, survives a refusal and a timeout, and writes
 * a report that cannot be mistaken for a live one. What it cannot prove — and no test in this
 * repository can — is anything about how Claude actually writes a world. That needs a key, and
 * the report says so on its face.
 */

const SMALL = { genres: ["fame" as const, "idol" as const], hard: false };

beforeEach(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
});

describe("the refusal", () => {
  it("names the environment variable and does not fall through to replay", () => {
    const env = { LLM_MODE: undefined } as unknown as NodeJS.ProcessEnv;
    let refusal: VerifyRefusal | null = null;
    try {
      preflightLive(env);
    } catch (err) {
      refusal = err instanceof VerifyRefusal ? err : null;
    }
    expect(refusal).not.toBeNull();
    expect(refusal?.message).toContain(API_KEY_ENV);
    expect(refusal?.hint).toContain("--stub");
  });

  it("refuses a 'live' verification asked for in replay mode", () => {
    expect(() => preflightLive({ [API_KEY_ENV]: "sk-x", LLM_MODE: "replay" })).toThrow(/replay/);
  });

  it("accepts a key with no LLM_MODE set", () => {
    expect(() => preflightLive({ [API_KEY_ENV]: "sk-x" })).not.toThrow();
  });

  it("treats whitespace as no key at all", () => {
    expect(() => preflightLive({ [API_KEY_ENV]: "   " })).toThrow(new RegExp(API_KEY_ENV));
  });
});

describe("the plan", () => {
  it("is the frozen eval set, and keeps both premises of every genre", () => {
    const plan = planRun();
    expect(plan.worlds).toBe(18);
    expect(plan.genres).toHaveLength(8);
    expect(plan.generatorCalls).toBe(18 * 14);
    for (const genre of plan.genres) {
      const forGenre = plan.cases.filter((c) => c.label.startsWith(`genre:${genre}:`));
      expect(forGenre.map((c) => c.locale).sort()).toEqual(["en", "ja"]);
    }
  });

  it("lets the operator run a subset without breaking the pairing", () => {
    const plan = planRun(SMALL);
    expect(plan.genres).toEqual(["fame", "idol"]);
    expect(plan.worlds).toBe(4);
    expect(new Set(plan.cases.map((c) => c.locale))).toEqual(new Set(["en", "ja"]));
  });

  it("caps by pairs and keeps the hard cases when asked", () => {
    expect(planRun({ maxPairs: 1, hard: false }).worlds).toBe(2);
    expect(planRun({ maxPairs: 8 }).cases.filter((c) => c.label.startsWith("hard:"))).toHaveLength(2);
  });

  it("hands the gate exactly the frozen inputs", () => {
    const plan = planRun(SMALL);
    const cases = toEvalCases(plan);
    expect(cases).toHaveLength(4);
    expect(cases[0]?.input).toBe(plan.cases[0]?.input);
  });
});

describe("the estimate", () => {
  it("prices a full run before anything is spent, with no key", async () => {
    const plan = planRun(SMALL);
    const estimate = await estimateRun(plan);
    expect(estimate.worlds).toBe(4);
    expect(estimate.calls).toBe(4 * 14 + 4);
    // The whole point of the number: it must be in the neighbourhood of gtm.md's $0.32.
    expect(estimate.perWorldUsd).toBeGreaterThan(0.1);
    expect(estimate.perWorldUsd).toBeLessThan(1);
    expect(estimate.stages.length).toBeGreaterThanOrEqual(5);
  });

  it("prints what it will cost, per stage", async () => {
    const plan = planRun({ maxPairs: 1, hard: false });
    const text = estimateBanner(plan, await estimateRun(plan));
    expect(text).toContain("ESTIMATE");
    expect(text).toContain("G9-bible@v1");
    expect(text).toContain("per world");
  });
});

describe("the measurements", () => {
  it("compares English by word and Japanese by character, not one rule for both", () => {
    expect(textOverlap("the quiet lighthouse keeper", "the quiet lighthouse keeper")).toBe(1);
    expect(textOverlap("lighthouse keeper watches", "bakery owner argues")).toBe(0);
    expect(shingles("路上ライブの動画が伸びた").size).toBeGreaterThan(5);
    expect(textOverlap("路上ライブの動画が伸びた", "路上ライブの動画が伸びた")).toBe(1);
    expect(textOverlap("路上ライブの動画", "商店街の定食屋")).toBeLessThan(0.2);
  });

  it("jaccard is symmetric and bounded", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "z"]);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
    expect(jaccard(a, b)).toBeCloseTo(1 / 3, 4);
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it("catches two cast members who are one character with two names", () => {
    const input: G9Input = {
      slug: "clones",
      premise: "a bakery on a shopping street where everyone knows everyone",
      genre: "slice_of_life",
      locale: "en",
      seed: 7,
    };
    const world = deterministicWorld(input);
    const honest = castDistinctnessOf(world, "en");

    const cloned: WorldSeed = JSON.parse(JSON.stringify(world)) as WorldSeed;
    const first = cloned.cast[0];
    const second = cloned.cast[1];
    if (first !== undefined && second !== undefined) {
      second.card = { ...first.card };
      second.intro = { ...first.intro };
      second.roleLocalized = first.roleLocalized === undefined ? undefined : { ...first.roleLocalized };
      second.role = first.role;
      const firstLines = cloned.fallbackReplies[first.handle];
      if (firstLines !== undefined) cloned.fallbackReplies[second.handle] = JSON.parse(JSON.stringify(firstLines)) as typeof firstLines;
    }
    const cloneScore = castDistinctnessOf(cloned, "en");

    expect(cloneScore.maxCard).toBeGreaterThan(honest.maxCard);
    expect(cloneScore.maxCard).toBeCloseTo(1, 1);
    expect(cloneScore.maxSpeech).toBeGreaterThan(honest.maxSpeech);
    expect(cloneScore.distinctRoles).toBeLessThan(honest.distinctRoles);
    expect(cloneScore.worstPair).toContain(first?.handle ?? "");
  });

  it("rolls per-call metas up into per-stage spend", () => {
    const meta = (variantId: string, cost: number, fallback = false): GenerationMeta => ({
      generator: "G9",
      variantId,
      model: "claude-opus-5",
      tier: "high",
      promptHash: "abc",
      usage: { inputTokens: 10, cacheWriteTokens: 5, cacheReadTokens: 20, outputTokens: 30 },
      costUsd: cost,
      ttftMs: 1,
      latencyMs: 100,
      stopReason: "end_turn",
      fallback,
      escalatedFrom: null,
    });
    const rows = stageSpend([meta("a", 0.1), meta("a", 0.2, true), meta("b", 0.05)]);
    expect(rows[0]?.stage).toBe("a");
    expect(rows[0]?.calls).toBe(2);
    expect(rows[0]?.costUsd).toBeCloseTo(0.3, 8);
    expect(rows[0]?.fallbacks).toBe(1);
    expect(rows[0]?.usage.outputTokens).toBe(60);
  });

  it("refuses to call a run live when a fixture answered any call", () => {
    const base: GenerationMeta = {
      generator: "G9",
      variantId: "G9-concept@v1",
      model: "claude-opus-5",
      tier: "high",
      promptHash: "h",
      usage: { inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1 },
      costUsd: 0.001,
      ttftMs: null,
      latencyMs: 10,
      stopReason: "end_turn",
      fallback: false,
      escalatedFrom: null,
    };
    expect(liveEvidenceOf([base, base]).live).toBe(true);
    const tainted = liveEvidenceOf([base, { ...base, stopReason: "replay", model: "replay" }]);
    expect(tainted.live).toBe(false);
    expect(tainted.replayCalls).toBe(1);
    expect(tainted.reasons.join(" ")).toContain("replay");
    expect(liveEvidenceOf([]).live).toBe(false);
  });

  it("recomputes the gem line from what the run actually paid", () => {
    const gems = gemEconomics(0.5);
    expect(gems.gemCost).toBe(120);
    expect(gems.packUsd).toBeCloseTo(2.99, 4);
    expect(gems.marginBeforeReviewUsd).toBeCloseTo(2.49, 4);
    expect(gems.marginAfterReviewUsd).toBeLessThan(0);
  });
});

describe("the stub world", () => {
  it("is deterministic, valid, and not the blueprint", () => {
    const input: G9Input = {
      slug: "stub-one",
      premise: "a photographer who accidentally becomes the most followed account in the city",
      genre: "fame",
      locale: "en",
      seed: 11,
    };
    const a = stubLiveWorld(input);
    const b = stubLiveWorld(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.cast).toHaveLength(8);
    expect(new Set(a.cast.map((c) => c.handle)).size).toBe(8);
    expect(Object.keys(a.fallbackReplies).sort()).toEqual(a.cast.map((c) => c.handle).sort());
    expect(a.bible.en).not.toBe(deterministicWorld(input).bible.en);
  });
});

/* ------------------------------------------------------------------ the run ---- */

async function stubRun(over: Parameters<typeof createStubLiveGateway>[0] = {}, plan = planRun(SMALL)): Promise<VerifyReport> {
  const collector = createCollector();
  const gateway = createStubLiveGateway({ ...over, onGeneration: collector.onGeneration });
  return runVerification({
    gateway,
    metas: collector.metas,
    mode: "stub",
    plan,
    concurrency: 2,
    estimate: false,
  });
}

describe("a whole run, against the stub", () => {
  it("answers all three questions and costs what it says", async () => {
    const report = await stubRun();

    expect(report.mode).toBe("stub");
    expect(report.answers.map((a) => a.id)).toEqual([
      "ja-native",
      "distinct-worlds",
      "distinct-cast",
    ]);
    expect(report.gate.cases).toBe(4);
    expect(report.evidence.calls).toBe(4 * 14 + 4);
    expect(report.evidence.models).not.toContain("replay");

    // cost, from the metas the gateway emitted
    expect(report.spend.totalUsd).toBeGreaterThan(0);
    expect(report.spend.usdPerWorld).toBeGreaterThan(0.1);
    expect(report.spend.stages.map((s) => s.stage)).toContain("G9-bible@v1");
    expect(report.spend.cacheHitRate).toBeGreaterThan(0.5);

    // question 2 — the headline number, and the blueprint measured beside it in the same run
    const d = report.distinctness;
    expect(d.pairs).toHaveLength(2);
    expect(d.meanBibleLineOverlapBlueprint ?? 0).toBeGreaterThan(0.5);
    expect(d.meanBibleLineOverlapLive ?? 1).toBeLessThan(d.meanBibleLineOverlapBlueprint ?? 0);
    expect(report.answers[1]?.headline).toContain("blueprint");

    // question 1 — measurable half passes, and the verdict is honest about the rest
    expect(report.answers[0]?.verdict).toBe("human");
    expect(report.japanese.panels.length).toBeGreaterThan(0);
    expect(report.japanese.checklist.length).toBeGreaterThan(3);
    const panel = report.japanese.panels[0];
    expect(panel?.rows.some((r) => r.field.includes("card"))).toBe(true);
    expect(panel?.rows.every((r) => r.en.length > 0 || r.ja.length > 0)).toBe(true);

    // question 3
    expect(report.cast).toHaveLength(4);
    expect(report.cast[0]?.live?.pairs).toHaveLength(28);
  });

  it("keeps a refusal as a result instead of losing the run", async () => {
    const plan = planRun(SMALL);
    const refused = plan.cases[0]?.input.slug ?? "";
    const report = await stubRun({ refuseSlugs: [refused] });

    expect(report.gate.cases).toBe(4);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.some((f) => f.kind.includes("refusal"))).toBe(true);
    // the world still exists (the deterministic fallback), so the rest of the report is intact
    expect(report.missing).toEqual([]);
    expect(report.spend.totalUsd).toBeGreaterThan(0);
  });

  it("keeps a hung call as a result too, and scores that case zero", async () => {
    const plan = planRun(SMALL);
    const hung = plan.cases[0]?.input.slug ?? "";
    const collector = createCollector();
    const gateway = createStubLiveGateway({ hangSlugs: [hung], onGeneration: collector.onGeneration });
    const report = await runVerification({
      gateway,
      metas: collector.metas,
      mode: "stub",
      plan,
      concurrency: 4,
      timeoutMs: 30,
      estimate: false,
    });

    expect(report.missing).toHaveLength(1);
    expect(report.gate.cases).toBe(4);
    expect(report.gate.results.find((r) => r.key === plan.cases[0]?.key)?.score).toBe(0);
    expect(report.failures.some((f) => f.kind === "no-result")).toBe(true);
    expect(report.notes.join(" ")).toContain("timeout");
    // the other three worlds still answered
    expect(report.distinctness.pairs.some((p) => p.live !== null)).toBe(true);
  });

  it("fails question 2 when the worlds really are the template", async () => {
    // `authorship: 0` returns the blueprint's own bible untouched — the exact failure the number
    // is looking for. The measure has to say so, or it is not measuring anything.
    const report = await stubRun({ authorship: 0 });
    const q2 = report.answers.find((a) => a.id === "distinct-worlds");
    expect(report.distinctness.meanBibleLineOverlapLive ?? 0).toBeGreaterThan(0.5);
    expect(q2?.verdict).toBe("fail");
    expect(report.distinctness.failing.length).toBeGreaterThan(0);
  });

  it("still reports the spend when the gate itself throws", async () => {
    // The money is gone before the gate runs. Losing the receipt with the exception is the one
    // failure that a second run cannot undo.
    const plan = planRun(SMALL);
    const collector = createCollector();
    const gateway = createStubLiveGateway({ onGeneration: collector.onGeneration });
    const broken = {
      ...gateway,
      batchGJ: () => Promise.reject(new Error("batch api exploded")),
    };
    const report = await runVerification({
      gateway: broken,
      metas: collector.metas,
      mode: "stub",
      plan,
      estimate: false,
    });
    expect(report.gate.cases).toBe(0);
    expect(report.notes.join(" ")).toContain("evaluation gate threw");
    expect(report.spend.totalUsd).toBeGreaterThan(0);
    expect(report.spend.stages.length).toBeGreaterThan(0);
  });

  it("reports a dented stage without calling the world lost", async () => {
    const plan = planRun(SMALL);
    const dented = plan.cases[1]?.input.slug ?? "";
    const report = await stubRun({ degradeSlugs: [dented] });
    expect(report.failures.some((f) => f.stage === "G9-cards@v1")).toBe(true);
    expect(report.missing).toEqual([]);
  });
});

describe("the report a person reads", () => {
  it("cannot be mistaken for a live run", async () => {
    const report = await stubRun();
    const text = renderText(report, "/tmp/x.html");
    const html = renderHtml(report);
    expect(text).toContain("STUB RUN — NOT LIVE");
    expect(html).toContain("STUB RUN — NOT LIVE");
    expect(html).toContain("none of it is evidence about a model");
  });

  it("shouts when a run claims live and the evidence says otherwise", async () => {
    const report = await stubRun();
    const faked: VerifyReport = {
      ...report,
      mode: "live",
      evidence: { ...report.evidence, live: false, reasons: ["3 of 60 calls came from replay fixtures"] },
    };
    expect(renderText(faked, null)).toContain("*** NOT A LIVE RUN ***");
    expect(renderHtml(faked)).toContain("NOT A LIVE RUN");
  });

  it("puts the JA and EN halves side by side and flags the identical ones", async () => {
    const report = await stubRun();
    const html = renderHtml(report);
    expect(html).toContain("日本語");
    expect(html).toContain("pairhead");
    expect(html).toContain("byte-identical");
    // the checklist a human uses
    expect(html).toContain("語順が英語のまま");
  });

  it("escapes what the model wrote", () => {
    const base: VerifyReport = {
      mode: "stub",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      plan: { genres: [], worlds: 0, generatorCalls: 0, judgeCalls: 0 },
      variantId: "G9@v1",
      evidence: { live: true, calls: 0, replayCalls: 0, models: [], reasons: [] },
      judgeSource: "absent",
      gate: { generator: "G9", variantId: "G9@v1", cases: 0, passed: 0, meanScore: 0, costUsd: 0, generatorCostUsd: 0, judgeCostUsd: 0, results: [] },
      spend: { stages: [], usage: { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 }, totalUsd: 0, generatorUsd: 0, judgeUsd: 0, worlds: 0, usdPerWorld: 0, cacheHitRate: 0, estimateUsd: null, estimatePerWorldUsd: null },
      distinctness: { pairs: [], meanBibleLineOverlapLive: null, meanBibleLineOverlapBlueprint: null, meanCastCardOverlapLive: null, meanCastCardOverlapBlueprint: null, crossGenreLive: null, crossGenreBlueprint: null, failing: [] },
      cast: [],
      japanese: {
        rows: [],
        panels: [
          {
            key: "k",
            label: "l",
            titleEn: "<script>alert(1)</script>",
            titleJa: "テスト",
            rows: [{ field: "title", en: "<b>bold</b>", ja: "<b>太字</b>", identical: false, jaCjk: 1 }],
          },
        ],
        checklist: ["x"],
      },
      failures: [],
      answers: [],
      missing: [],
      notes: [],
      metas: [],
    };
    const html = renderHtml(base);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;太字&lt;/b&gt;");
  });
});

/* ------------------------------------------------------------------- the CLI ---- */

function fakeIo(env: NodeJS.ProcessEnv = {}): CliIo & { lines: string[]; errs: string[]; files: Map<string, string> } {
  const lines: string[] = [];
  const errs: string[] = [];
  const files = new Map<string, string>();
  return {
    lines,
    errs,
    files,
    env,
    out: (s) => lines.push(s),
    err: (s) => errs.push(s),
    writeFile: (p, c) => files.set(p, c),
    mkdir: () => undefined,
  };
}

describe("the command", () => {
  it("parses the operator's options", () => {
    const args = parseArgs(["--stub", "--genres", "fame,idol", "--pairs", "2", "--max-usd", "1.5", "--timeout", "30"]);
    expect(args).toMatchObject({ stub: true, genres: ["fame", "idol"], pairs: 2, maxUsd: 1.5, timeoutMs: 30_000 });
    expect(parseArgs([]).hard).toBe(true);
    expect(parseArgs(["--no-hard"]).hard).toBe(false);
  });

  it("rejects an unknown genre rather than silently running everything", () => {
    expect(() => parseArgs(["--genres", "cyberpunk"])).toThrow(/cyberpunk/);
  });

  it("exits 1 and spends nothing when the key is missing", async () => {
    const io = fakeIo({});
    const code = await main(["--pairs", "1"], io);
    expect(code).toBe(1);
    expect(io.errs.join("\n")).toContain(API_KEY_ENV);
    expect(io.files.size).toBe(0);
  });

  it("estimates without a key and stops there", async () => {
    const io = fakeIo({});
    const code = await main(["--estimate-only", "--pairs", "1", "--no-hard"], io);
    expect(code).toBe(0);
    expect(io.lines.join("\n")).toContain("ESTIMATE");
    expect(io.lines.join("\n")).toContain("nothing was spent");
    expect(io.files.size).toBe(0);
  });

  it("refuses a plan that costs more than the budget", async () => {
    const io = fakeIo({ [API_KEY_ENV]: "sk-test" });
    const code = await main(["--stub", "--max-usd", "0.01", "--pairs", "1", "--no-hard"], io);
    expect(code).toBe(1);
    expect(io.errs.join("\n")).toContain("max-usd");
    expect(io.files.size).toBe(0);
  });

  it("runs the rehearsal end to end and writes a report that is labelled a rehearsal", async () => {
    const io = fakeIo({});
    const code = await main(["--stub", "--pairs", "1", "--no-hard", "--out", "/tmp/verify-test"], io);
    expect(code).toBe(0);
    const paths = [...io.files.keys()];
    expect(paths.some((p) => p.endsWith(".html"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".json"))).toBe(true);
    for (const p of paths) expect(p).toContain("verify-stub-");
    const html = [...io.files.entries()].find(([p]) => p.endsWith(".html"))?.[1] ?? "";
    expect(html).toContain("STUB RUN — NOT LIVE");
    expect(io.lines.join("\n")).toContain("THE THREE QUESTIONS");
    expect(io.lines.join("\n")).toContain("per world");
  }, 30_000);

  it("exits 2 — not 0 — when the run answered and an answer was no", async () => {
    // A CI job that runs this must not go green on "the command worked".
    const good = await stubRun();
    expect(exitCodeFor(good)).toBe(0);

    const q2Failed: VerifyReport = {
      ...good,
      answers: good.answers.map((a) => (a.id === "distinct-worlds" ? { ...a, verdict: "fail" as const } : a)),
    };
    expect(exitCodeFor(q2Failed)).toBe(2);

    const notReallyLive: VerifyReport = {
      ...good,
      mode: "live",
      evidence: { ...good.evidence, live: false },
    };
    expect(exitCodeFor(notReallyLive)).toBe(2);

    // "needs a human" is where the machine stops, not a failure.
    expect(good.answers.find((a) => a.id === "ja-native")?.verdict).toBe("human");
  });

  it("prints its own usage", async () => {
    const io = fakeIo({});
    expect(await main(["--help"], io)).toBe(0);
    expect(io.lines.join("\n")).toContain("--stub");
    expect(io.lines.join("\n")).toContain(API_KEY_ENV);
  });
});
