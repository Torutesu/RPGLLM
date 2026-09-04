import { describe, expect, it } from "vitest";
import { BANDIT_FLOOR, BANDIT_GUARDRAILS, BANDIT_LAMBDA } from "@rpgllm/shared";
import {
  allocate,
  betaSample,
  credibleInterval,
  dayKey,
  foldReward,
  guardrailBreach,
  mulberry32,
  pBestByArm,
  posteriorMean,
  promotionDecision,
  qualityOf,
  rewardFor,
  UNRATED_QUALITY_PRIOR,
  type ArmState,
} from "./bandit.js";

/** Thompson sampling with guardrails (cost-architecture §6.3). Everything here is deterministic. */

const arm = (over: Partial<ArmState> = {}): ArmState => ({
  generator: "G1",
  variantId: "g1-sonnet-v1",
  alpha: 1,
  beta: 1,
  calls: 0,
  rewardSum: 0,
  costSum: 0,
  isChampion: false,
  floor: BANDIT_FLOOR,
  disabled: false,
  disabledReason: null,
  ...over,
});

describe("reward formula (§6.1)", () => {
  it("maps the signals that exist to a quality, with silence as a soft prior", () => {
    expect(qualityOf({ rating: 1, regenerated: false, fallback: false })).toBe(1);
    expect(qualityOf({ rating: -1, regenerated: false, fallback: false })).toBe(0);
    expect(qualityOf({ rating: null, regenerated: true, fallback: false })).toBe(0);
    expect(qualityOf({ rating: 1, regenerated: false, fallback: true })).toBe(0);
    expect(qualityOf({ rating: null, regenerated: false, fallback: false })).toBe(UNRATED_QUALITY_PRIOR);
  });

  it("is quality minus lambda times the cost ratio", () => {
    const r = rewardFor({
      signals: { rating: 1, regenerated: false, fallback: false },
      costUsd: 0.002,
      championCostUsd: 0.002,
    });
    expect(r).toBeCloseTo(1 - BANDIT_LAMBDA, 10);

    const cheaper = rewardFor({
      signals: { rating: 1, regenerated: false, fallback: false },
      costUsd: 0.001,
      championCostUsd: 0.002,
    });
    expect(cheaper).toBeCloseTo(1 - BANDIT_LAMBDA * 0.5, 10);
    expect(cheaper).toBeGreaterThan(r); // half the price at the same quality must win
  });

  it("clamps to [0,1] — a dear failure is 0, not negative", () => {
    expect(
      rewardFor({ signals: { rating: -1, regenerated: false, fallback: false }, costUsd: 0.01, championCostUsd: 0.001 }),
    ).toBe(0);
    expect(
      rewardFor({ signals: { rating: 1, regenerated: false, fallback: false }, costUsd: 0, championCostUsd: 0.002 }),
    ).toBe(1);
  });

  it("folds into the posterior so the mean tracks the observed reward", () => {
    let a = arm();
    for (let i = 0; i < 200; i += 1) a = foldReward(a, 0.8);
    expect(a.calls).toBe(200);
    expect(posteriorMean(a)).toBeGreaterThan(0.78);
    expect(posteriorMean(a)).toBeLessThan(0.82);
  });
});

describe("sampling", () => {
  it("betaSample stays in (0,1) and concentrates around alpha/(alpha+beta)", () => {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 500; i += 1) {
      const draw = betaSample(80, 20, rng);
      expect(draw).toBeGreaterThan(0);
      expect(draw).toBeLessThan(1);
      sum += draw;
    }
    expect(sum / 500).toBeCloseTo(0.8, 1);
  });

  it("credibleInterval brackets the mean and is deterministic", () => {
    const a = arm({ alpha: 40, beta: 10 });
    const [lo, hi] = credibleInterval(a);
    expect(lo).toBeLessThan(posteriorMean(a));
    expect(hi).toBeGreaterThan(posteriorMean(a));
    expect(credibleInterval(a)).toEqual([lo, hi]);
    // a thin arm reads as uncertain: its interval is far wider
    const thin = arm({ alpha: 2, beta: 1 });
    const [tlo, thi] = credibleInterval(thin);
    expect(thi - tlo).toBeGreaterThan(hi - lo);
  });
});

describe("allocation", () => {
  const arms = (): ArmState[] => [
    arm({ variantId: "champ", isChampion: true, alpha: 60, beta: 40, calls: 100 }),
    arm({ variantId: "challenger", alpha: 90, beta: 10, calls: 100 }),
  ];

  it("is user-sticky: same user, same day, same arm", () => {
    const day = dayKey(new Date("2026-09-04T10:00:00Z"));
    for (const userId of ["u1", "u2", "u3", "u4"]) {
      const first = allocate({ generator: "G1", arms: arms(), userId, day });
      for (let i = 0; i < 5; i += 1) {
        expect(allocate({ generator: "G1", arms: arms(), userId, day })).toBe(first);
      }
    }
  });

  it("returns null when the bandit has no data, so the deterministic assignment stands in", () => {
    const cold = [arm({ variantId: "a" }), arm({ variantId: "b" })];
    expect(allocate({ generator: "G1", arms: cold, userId: "u1", day: "2026-09-04" })).toBeNull();
    expect(allocate({ generator: "G1", arms: [], userId: "u1", day: "2026-09-04" })).toBeNull();
  });

  it("keeps a floor for the losing arm and still sends the bulk to the leader", () => {
    const day = "2026-09-04";
    const counts = new Map<string, number>();
    const n = 4000;
    for (let i = 0; i < n; i += 1) {
      const v = allocate({ generator: "G1", arms: arms(), userId: `user-${i}`, day });
      counts.set(v ?? "?", (counts.get(v ?? "?") ?? 0) + 1);
    }
    const champShare = (counts.get("champ") ?? 0) / n;
    const challengerShare = (counts.get("challenger") ?? 0) / n;
    expect(challengerShare).toBeGreaterThan(0.7);
    // the loser never falls below the exploration floor
    expect(champShare).toBeGreaterThanOrEqual(BANDIT_FLOOR * 0.8);
    expect(champShare + challengerShare).toBeCloseTo(1, 10);
  });

  it("never allocates to a disabled arm", () => {
    const list = [
      arm({ variantId: "champ", isChampion: true, alpha: 30, beta: 70, calls: 100 }),
      arm({ variantId: "bad", alpha: 99, beta: 1, calls: 100, disabled: true, disabledReason: "guardrail" }),
    ];
    for (let i = 0; i < 200; i += 1) {
      expect(allocate({ generator: "G1", arms: list, userId: `u${i}`, day: "2026-09-04" })).toBe("champ");
    }
  });

  it("converges to the better arm on synthetic traffic", () => {
    // Arm B is genuinely better (higher quality at the same price). Simulate a fortnight.
    let a = arm({ variantId: "A", isChampion: true, alpha: 1, beta: 1, calls: 0 });
    let b = arm({ variantId: "B", alpha: 1, beta: 1, calls: 0 });
    const noise = mulberry32(99);
    const trueReward = { A: 0.45, B: 0.75 } as const;

    // a warm-up so the bandit has data at all
    for (let i = 0; i < 10; i += 1) {
      a = foldReward(a, noise() < trueReward.A ? 1 : 0);
      b = foldReward(b, noise() < trueReward.B ? 1 : 0);
    }

    let lateB = 0;
    let lateTotal = 0;
    for (let day = 0; day < 14; day += 1) {
      const key = `2026-09-${String(day + 1).padStart(2, "0")}`;
      for (let u = 0; u < 200; u += 1) {
        const chosen = allocate({ generator: "G1", arms: [a, b], userId: `u${u}`, day: key });
        const win = noise() < (chosen === "B" ? trueReward.B : trueReward.A) ? 1 : 0;
        if (chosen === "B") b = foldReward(b, win);
        else a = foldReward(a, win);
        if (day >= 12) {
          lateTotal += 1;
          if (chosen === "B") lateB += 1;
        }
      }
    }

    expect(posteriorMean(b)).toBeGreaterThan(posteriorMean(a));
    expect(lateB / lateTotal).toBeGreaterThan(0.85);
    expect(b.calls).toBeGreaterThan(a.calls * 3);
  });

  it("p(best) finds the leader and sums to one", () => {
    const list = [
      arm({ variantId: "champ", isChampion: true, alpha: 60, beta: 40, calls: 100 }),
      arm({ variantId: "challenger", alpha: 900, beta: 100, calls: 1000 }),
    ];
    const p = pBestByArm(list, 400);
    expect((p.get("challenger") ?? 0)).toBeGreaterThan(0.9);
    expect([...p.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 2);
  });
});

describe("guardrails", () => {
  it("fires on a regeneration rate over the limit", () => {
    const breach = guardrailBreach({ calls: 200, regenerations: 30, safetyFlags: 0, fallbacks: 0 });
    expect(breach?.metric).toBe("regenerate_rate");
    expect(breach?.limit).toBe(BANDIT_GUARDRAILS.MAX_REGENERATE_RATE);
  });

  it("fires on safety flags and on fallbacks", () => {
    expect(guardrailBreach({ calls: 1000, regenerations: 0, safetyFlags: 5, fallbacks: 0 })?.metric).toBe("safety_flag_rate");
    expect(guardrailBreach({ calls: 1000, regenerations: 0, safetyFlags: 0, fallbacks: 100 })?.metric).toBe("fallback_rate");
  });

  it("never fires on too few calls — one bad draw is not evidence", () => {
    expect(guardrailBreach({ calls: 5, regenerations: 5, safetyFlags: 5, fallbacks: 5 })).toBeNull();
    expect(guardrailBreach({ calls: 0, regenerations: 0, safetyFlags: 0, fallbacks: 0 })).toBeNull();
  });

  it("passes a healthy arm", () => {
    expect(guardrailBreach({ calls: 1000, regenerations: 40, safetyFlags: 1, fallbacks: 10 })).toBeNull();
  });
});

describe("promotion", () => {
  const leader = () => arm({ variantId: "challenger", alpha: 900, beta: 100, calls: 600 });
  const champion = () => arm({ variantId: "champ", isChampion: true, alpha: 60, beta: 40, calls: 600 });

  it("requires the offline gate even when the numbers are overwhelming", () => {
    const d = promotionDecision({ arms: [champion(), leader()], gatePassed: new Set(), minCalls: 500 });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("offline gate");
  });

  it("requires the call count", () => {
    const thin = arm({ variantId: "challenger", alpha: 90, beta: 10, calls: 12 });
    const d = promotionDecision({ arms: [champion(), thin], gatePassed: new Set(["challenger"]), minCalls: 500 });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("500 calls");
  });

  it("requires p(best)", () => {
    const close = arm({ variantId: "challenger", alpha: 61, beta: 39, calls: 600 });
    const d = promotionDecision({ arms: [champion(), close], gatePassed: new Set(["challenger"]), minCalls: 500 });
    expect(d.promote).toBe(false);
    expect(d.reason).toContain("p(best)");
  });

  it("promotes when all three hold", () => {
    const d = promotionDecision({ arms: [champion(), leader()], gatePassed: new Set(["challenger"]), minCalls: 500 });
    expect(d.promote).toBe(true);
    expect(d.from).toBe("champ");
    expect(d.to).toBe("challenger");
    expect(d.pBest).toBeGreaterThanOrEqual(0.95);
  });

  it("does nothing while the champion still leads", () => {
    const d = promotionDecision({
      arms: [arm({ variantId: "champ", isChampion: true, alpha: 900, beta: 100, calls: 900 }), arm({ variantId: "c", alpha: 10, beta: 90, calls: 900 })],
      gatePassed: new Set(["c"]),
    });
    expect(d.promote).toBe(false);
    expect(d.reason).toBe("champion still leads");
  });
});
