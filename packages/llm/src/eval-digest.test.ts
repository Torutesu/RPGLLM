import { beforeAll, describe, expect, it } from "vitest";
import { WorldSeedZ, type WorldSeed } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { deterministicWorld } from "./generators/g9/assemble.js";
import { measuredPoints, worldPassages, type DigestRule, type ReviewPoint } from "./generators/g9/digest-offline.js";
import { toReviewDigest, type ReviewDigest } from "./generators/g9/digest-run.js";
import { createStubDigestGateway } from "./verify-live/digest-stub.js";
import { caseWorld, frozenEvalCasesDigest, DAMAGES } from "./eval-cases-digest.js";
import { confidenceAllowed, machineChecksDigest, runEvalDigest, DIGEST_ABSOLUTE_CHECKS } from "./eval-digest.js";

/**
 * The digest in the offline gate. Every number here is produced today, in replay or against the
 * stub, with no key and no cost — and every check is broken on purpose once, so a check that
 * silently stopped being load-bearing fails this file rather than passing a bad digest.
 */

beforeAll(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
});

const CASES = frozenEvalCasesDigest();
const AT = "2026-01-01T00:00:00.000Z";
const WORLD = deterministicWorld(CASES[0]!.input);

const passage = (world: WorldSeed, min = 60): string =>
  (worldPassages(world).find((p) => p.locale === "en" && p.text.length > min)?.text ?? "").slice(0, 200);

const onePoint = (over: Partial<ReviewPoint> = {}): ReviewPoint => ({
  rule: "playable",
  concern: "Two accounts could be written from this sentence; compare them before reading the rest.",
  evidence: passage(WORLD),
  confidence: "medium",
  ...over,
});

const digestOf = (points: ReviewPoint[]): ReviewDigest => toReviewDigest(points, { sampled: false, at: AT });

/* ------------------------------------------------------------- the case set ---- */

describe("the frozen digest case set", () => {
  it("is deterministic and covers all five rules plus clean worlds", () => {
    expect(JSON.stringify(frozenEvalCasesDigest())).toBe(JSON.stringify(CASES));
    expect(CASES.filter((c) => c.expect.length === 0)).toHaveLength(3);
    const planted = new Set(CASES.flatMap((c) => c.expect));
    expect([...planted].sort()).toEqual(["age", "locales", "original", "playable", "vector"]);
  });

  it("every damage actually damages, and leaves a world the schema still accepts", () => {
    for (const spec of CASES) {
      const clean = deterministicWorld(spec.input);
      const damaged = caseWorld(spec);
      expect(WorldSeedZ.safeParse(damaged).success, spec.label).toBe(true);
      const changed = JSON.stringify(clean) !== JSON.stringify(damaged);
      expect(changed, spec.label).toBe(spec.expect.length > 0);
    }
  });

  it("every clean case is genuinely clean and every planted one is genuinely found", () => {
    for (const spec of CASES) {
      const raised = new Set(measuredPoints(caseWorld(spec)).map((p) => p.rule));
      for (const rule of spec.expect) expect(raised.has(rule), `${spec.label}/${rule}`).toBe(true);
      if (spec.expect.length === 0) expect([...raised], spec.label).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------- the checks ---- */

describe("each check is load-bearing", () => {
  const base = { world: WORLD, expect: ["playable"] as const, locale: "en" as const };
  const broken = (digest: ReviewDigest | null, expected: readonly DigestRule[] = ["playable"]): string[] =>
    Object.entries(machineChecksDigest({ ...base, expect: expected, digest }))
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .sort();

  it("passes everything for a well-formed digest of a damaged world", () => {
    expect(broken(digestOf([onePoint()]))).toEqual([]);
  });

  it("catches a quote the world does not contain — the failure a reviewer must never have to spot", () => {
    const invented = onePoint({ evidence: "the back room after midnight, where nobody writes anything down" });
    expect(broken(digestOf([invented]))).toEqual(["evidenceGrounded"]);
    expect(DIGEST_ABSOLUTE_CHECKS).toContain("evidenceGrounded");
  });

  it("catches a quote lifted from a different world", () => {
    const other = deterministicWorld(CASES[5]!.input);
    expect(broken(digestOf([onePoint({ evidence: passage(other, 120) })]))).toEqual(["evidenceGrounded"]);
  });

  it("catches a point that decides", () => {
    expect(broken(digestOf([onePoint({ concern: "This world should be rejected; the cast is one person." })]))).toEqual(
      ["noVerdictLanguage"],
    );
  });

  it("catches a timestamp printed over an empty list", () => {
    const lying: ReviewDigest = { points: [], generatedAt: AT, sampled: false };
    expect(broken(lying, [])).toEqual(["emptyIsExplicit"]);
  });

  it("catches a planted defect the digest walked past", () => {
    expect(broken(digestOf([onePoint()]), ["age"])).toEqual(["foundExpected"]);
  });

  it("catches a rule outside the taxonomy", () => {
    const alien = { ...onePoint(), rule: "vibes" } as unknown as ReviewPoint;
    expect(broken(digestOf([alien]))).toEqual(["foundExpected", "rulesInTaxonomy", "schemaValid"]);
  });

  it("catches a digest that quotes half the world at a reviewer", () => {
    const longest = worldPassages(WORLD)
      .map((p) => p.text)
      .sort((a, b) => b.length - a.length)[0]!;
    expect(broken(digestOf([onePoint({ evidence: longest })]))).toEqual(["boundedSize"]);
  });

  it("catches an original point claiming certainty it cannot have", () => {
    const overconfident = onePoint({ rule: "original", confidence: "high" });
    expect(broken(digestOf([overconfident]), ["original"])).toEqual(["confidenceLadder"]);
    // ...and allows it when the passage literally contains the name.
    const named = digestOf([
      {
        rule: "original",
        concern: "A named franchise appears in the bible.",
        evidence: "the whole timetable runs on the Hogwarts calendar",
        confidence: "high",
      },
    ]);
    const world = DAMAGES.namedFranchise(WORLD);
    expect(
      Object.entries(machineChecksDigest({ world, digest: named, expect: ["original"], locale: "en" }))
        .filter(([, v]) => !v)
        .map(([k]) => k),
    ).toEqual([]);
  });

  it("catches the digest repeating our own plumbing in its own voice", () => {
    expect(broken(digestOf([onePoint({ concern: "# TASK — the bible echoes a stage header." })]))).toEqual([
      "noSelfInstruction",
    ]);
  });

  it("catches noise on a world that is fine", () => {
    expect(broken(digestOf([onePoint()]), [])).toEqual(["quietWhenClean"]);
  });

  it("scores a missing digest at zero on every check", () => {
    expect(broken(null, []).length).toBe(10);
  });

  it("knows which evidence may carry a high original point", () => {
    expect(
      confidenceAllowed(
        { rule: "original", concern: "x", evidence: "Friday night is Pokemon night", confidence: "high" },
        "en",
      ),
    ).toBe(true);
    expect(
      confidenceAllowed(
        { rule: "original", concern: "x", evidence: "a school with four houses and a scoreboard", confidence: "high" },
        "en",
      ),
    ).toBe(false);
    expect(
      confidenceAllowed(
        { rule: "original", concern: "x", evidence: "a school with four houses", confidence: "medium" },
        "en",
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------- the run ---- */

describe("the gate, in replay — the numbers it produces today", () => {
  it("finds every planted defect, says nothing about the clean worlds, and costs nothing", async () => {
    const run = await runEvalDigest(createGateway({ mode: "replay" }), {
      variantId: "G9-digest@v1",
      cases: CASES,
      at: AT,
    });
    expect(run.cases).toBe(12);
    expect(run.passed).toBe(12);
    expect(run.meanScore).toBe(100);
    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.quiet).toBe(3);
    expect(run.cleanCases).toBe(3);
    expect(run.costUsd).toBe(0);
    // Replay is the deterministic half alone, and the table says so on every row.
    expect(run.results.every((r) => r.model === "skipped")).toBe(true);
    expect(run.results.every((r) => r.modelCount === 0)).toBe(true);
    // Every measured point is a literal match, so the ladder is legitimately all `high` here.
    expect(run.confidence).toEqual({ high: 11, medium: 0, low: 0 });
  });

  it("is reproducible", async () => {
    const gw = createGateway({ mode: "replay" });
    const a = await runEvalDigest(gw, { variantId: "v", cases: CASES, at: AT });
    const b = await runEvalDigest(gw, { variantId: "v", cases: CASES, at: AT });
    expect(JSON.stringify(a.results.map((r) => r.points))).toBe(JSON.stringify(b.results.map((r) => r.points)));
  });
});

describe("the gate, against the stub — what it does and does not prove", () => {
  it("takes the live branch, still finds every planted defect, and prices the call", async () => {
    const run = await runEvalDigest(createStubDigestGateway(), { variantId: "v", cases: CASES, at: AT });
    expect(run.results.every((r) => r.model === "ok")).toBe(true);
    expect(run.recall).toBe(1);
    expect(run.passed).toBe(12);
    // About a cent a world, dominated by the uncached excerpt.
    expect(run.costUsd / run.cases).toBeLessThan(0.02);
    expect(run.costUsd / run.cases).toBeGreaterThan(0.002);
    // Three confidence levels in use — a digest that marked everything the same is the failure.
    expect(run.confidence.high).toBeGreaterThan(0);
    expect(run.confidence.medium).toBeGreaterThan(0);
    expect(run.confidence.low).toBeGreaterThan(0);
  });

  it("proves the enforcement, not the model: a misbehaving stub produces the same digests", async () => {
    const good = await runEvalDigest(createStubDigestGateway(), { variantId: "v", cases: CASES, at: AT });
    const bad = await runEvalDigest(createStubDigestGateway({ misbehave: true }), {
      variantId: "v",
      cases: CASES,
      at: AT,
    });
    expect(JSON.stringify(bad.results.map((r) => r.points))).toBe(JSON.stringify(good.results.map((r) => r.points)));
    // The stub's precision is a property of the stub — it says the same three things about every
    // world, including the clean ones — and is not evidence about any model.
    expect(good.precision).toBeLessThan(0.5);
    expect(good.quiet).toBe(0);
  });

  it("a silent model leaves the measured half, and every clean world stays quiet", async () => {
    const run = await runEvalDigest(createStubDigestGateway({ silent: true }), {
      variantId: "v",
      cases: CASES,
      at: AT,
    });
    expect(run.results.every((r) => r.model === "empty")).toBe(true);
    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.quiet).toBe(3);
    expect(run.passed).toBe(12);
  });

  it("a model that cannot answer produces no digest for a clean world, and the gate says so", async () => {
    const run = await runEvalDigest(createStubDigestGateway({ failSlugs: CASES.map((c) => c.input.slug) }), {
      variantId: "v",
      cases: CASES,
      at: AT,
    });
    expect(run.results.every((r) => r.model === "error")).toBe(true);
    // The three clean worlds have nothing measured and nothing modelled -> no digest -> zero.
    const zeroes = run.results.filter((r) => r.score === 0);
    expect(zeroes.map((r) => r.label)).toEqual(["clean:fame:en", "clean:academy:ja", "clean:mystery:en"]);
    expect(run.passed).toBe(9);
    // ...and the planted ones still carry their measured points, because those never needed a model.
    expect(run.results.filter((r) => r.expect.length > 0).every((r) => r.points.length > 0)).toBe(true);
  });

  it("reports how much of each world the model was actually shown", async () => {
    const run = await runEvalDigest(createStubDigestGateway(), { variantId: "v", cases: CASES, at: AT });
    for (const r of run.results) {
      expect(r.coverage.excerptChars).toBeGreaterThan(4000);
      expect(r.coverage.excerptChars / r.coverage.worldChars).toBeLessThan(0.2);
      expect(r.coverage.passages).toBeGreaterThan(400);
    }
  });
});
