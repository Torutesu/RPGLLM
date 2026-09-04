import { beforeEach, describe, expect, it } from "vitest";
import type { GenerationMeta, GeneratorId } from "@rpgllm/shared";
import { G1OutputZ, PRICING, WORLD_SLUGS } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { g1Input, g4Input, g5Input, g7Input, seedFor } from "./__testkit.js";

type Logged = GenerationMeta & { userId: string | null; generator: GeneratorId };

beforeEach(() => {
  // deterministic, instant replay in tests (E2E sets the same)
  process.env.LLM_REPLAY_LATENCY_MS = "0";
  delete process.env.LLM_MODE;
});

describe("gateway — replay mode", () => {
  it("defaults to replay and honours setMode", () => {
    const gw = createGateway();
    expect(gw.mode()).toBe("replay");
    gw.setMode("fail");
    expect(gw.mode()).toBe("fail");
    expect(createGateway({ mode: "live" }).mode()).toBe("live");
  });

  it("reads LLM_MODE from the environment when no mode is passed", () => {
    process.env.LLM_MODE = "fail";
    expect(createGateway().mode()).toBe("fail");
    process.env.LLM_MODE = "nonsense";
    expect(createGateway().mode()).toBe("replay");
  });

  it("produces a valid G1 result with full meta and a concrete model id", async () => {
    const gw = createGateway();
    const res = await gw.g1(g1Input("popstar-era", "en", 42));
    expect(() => G1OutputZ.parse(res.output)).not.toThrow();

    const m = res.meta;
    expect(m.generator).toBe("G1");
    expect(["g1-sonnet-v1", "g1-haiku-v1"]).toContain(m.variantId);
    // replay bills the *would-be* model so the cost dashboards work without an API key
    expect(Object.keys(PRICING)).toContain(m.model);
    expect(m.model).not.toBe("replay");
    expect(m.stopReason).toBe("replay");
    expect(m.tier === "mid" || m.tier === "light").toBe(true);
    expect(m.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.fallback).toBe(false);
    expect(m.escalatedFrom).toBeNull();
    expect(m.usage.inputTokens).toBeGreaterThan(0);
    expect(m.usage.outputTokens).toBeGreaterThan(0);
    expect(m.costUsd).toBeGreaterThan(0);
    expect(m.latencyMs).toBeGreaterThanOrEqual(0);
    expect(m.ttftMs).toBe(0);
  });

  it("bills the first call as a cache write and later ones as cache reads", async () => {
    const gw = createGateway();
    const a = await gw.g1(g1Input("popstar-era", "en", 1));
    const b = await gw.g1(g1Input("popstar-era", "en", 2));
    expect(a.meta.usage.cacheWriteTokens).toBeGreaterThan(4096);
    expect(a.meta.usage.cacheReadTokens).toBe(0);
    expect(b.meta.usage.cacheWriteTokens).toBe(0);
    expect(b.meta.usage.cacheReadTokens).toBe(a.meta.usage.cacheWriteTokens);

    // a different world/locale is a different cached prefix
    const c = await gw.g1(g1Input("popstar-era", "ja", 1));
    expect(c.meta.usage.cacheWriteTokens).toBeGreaterThan(4096);
  });

  it("calls onGeneration exactly once per call, with usage and cost", async () => {
    const seen: Logged[] = [];
    const gw = createGateway({ onGeneration: (m) => void seen.push(m) });
    await gw.g1(g1Input("popstar-era", "en", 3));
    await gw.g4(g4Input("popstar-era", "en", 3));
    await gw.g5(g5Input("popstar-era", "en", 3));
    await gw.g7(g7Input("popstar-era", "en"));
    await gw.g8({ locale: "en", isMinor: false, text: "hello", surface: "post" });
    expect(seen.map((m) => m.generator)).toEqual(["G1", "G4", "G5", "G7", "G8"]);
    for (const m of seen) {
      expect(m.costUsd).toBeGreaterThan(0);
      expect(m.usage.outputTokens).toBeGreaterThan(0);
    }
    expect(seen[0]?.userId).toBe("user-1");
    expect(seen[4]?.userId).toBeNull();
  });

  it("never lets an onGeneration failure escape", async () => {
    const gw = createGateway({
      onGeneration: () => {
        throw new Error("log sink is down");
      },
    });
    await expect(gw.g1(g1Input("popstar-era", "en", 3))).resolves.toBeDefined();
  });

  it("uses the champion tiers and honours a tier override for escalation", async () => {
    const gw = createGateway();
    const escalated = await gw.g1(g1Input("popstar-era", "en", 3), {
      tier: "high",
      escalatedFrom: "gen_123",
    });
    expect(escalated.meta.tier).toBe("high");
    expect(escalated.meta.model).toBe("claude-opus-5");
    expect(escalated.meta.escalatedFrom).toBe("gen_123");

    const g5res = await gw.g5(g5Input("popstar-era", "en", 3));
    expect(g5res.meta.tier).toBe("high");
    expect(g5res.meta.variantId).toBe("g5-opus-v1");
  });

  it("reads model ids from LLM_MODEL_* env", async () => {
    process.env.LLM_MODEL_MID = "claude-sonnet-5";
    const gw = createGateway();
    const res = await gw.g4(g4Input("popstar-era", "en", 3));
    expect(res.meta.model).toBe("claude-sonnet-5");
    expect(res.meta.variantId).toBe("g4-sonnet-v1");
  });

  it("is deterministic across worlds and locales", async () => {
    for (const slug of WORLD_SLUGS) {
      const a = await createGateway().g1(g1Input(slug, "ja", 77));
      const b = await createGateway().g1(g1Input(slug, "ja", 77));
      expect(a.output).toEqual(b.output);
      expect(a.meta.promptHash).toBe(b.meta.promptHash);
    }
  });
});

describe("gateway — fail mode (E2E-010)", () => {
  it("returns the deterministic fallback and never throws", async () => {
    const seen: Logged[] = [];
    const gw = createGateway({ mode: "fail", onGeneration: (m) => void seen.push(m) });

    const r1 = await gw.g1(g1Input("popstar-era", "en", 5));
    expect(r1.meta.fallback).toBe(true);
    expect(r1.meta.stopReason).toBe("error");
    expect(r1.output.replies.length).toBeGreaterThanOrEqual(1);
    expect(r1.output.replies[0]?.characterHandle).toBe("hivequeenbea");
    // one of the five canned lines for that character (E2E-010: "@hivequeenbea: 👀" or similar)
    expect(seedFor("popstar-era").fallbackReplies.hivequeenbea?.en).toContain(
      r1.output.replies[0]?.text,
    );
    expect(r1.output.stat_deltas).toEqual({ followers: 0, aura: 0, humor: 0 });

    const r4 = await gw.g4(g4Input("popstar-era", "ja", 5));
    expect(r4.meta.fallback).toBe(true);
    expect(r4.output.bubbles.length).toBeGreaterThanOrEqual(1);
    expect(r4.output.affinity_delta).toBe(0);

    const r5 = await gw.g5(g5Input("popstar-era", "en", 5));
    expect(r5.meta.fallback).toBe(true);
    expect(r5.output.choices).toHaveLength(3);

    const r7 = await gw.g7(g7Input("popstar-era", "en"));
    expect(r7.meta.fallback).toBe(true);
    expect(r7.output.relationships[0]?.summary).toBe("believed in you first");

    const r8 = await gw.g8({ locale: "en", isMinor: true, text: "hello", surface: "post" });
    expect(r8.meta.fallback).toBe(true);
    expect(r8.output.verdict).toBe("soften");

    expect(seen).toHaveLength(5);
    for (const m of seen) expect(m.fallback).toBe(true);
  });

  it("still produces per-character canned replies for every world and locale", async () => {
    const gw = createGateway({ mode: "fail" });
    for (const slug of WORLD_SLUGS) {
      for (const locale of ["en", "ja"] as const) {
        const res = await gw.g1(g1Input(slug, locale, 9, { k: 3 }));
        expect(res.output.replies.length).toBeGreaterThanOrEqual(1);
        for (const r of res.output.replies) expect(r.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("gateway — experiments", () => {
  it("assignment is user-sticky and covers every key", () => {
    const gw = createGateway();
    const a = gw.assignments("user-abc");
    const b = gw.assignments("user-abc");
    expect(a).toEqual(b);
    // G2/G10/GJ joined the registry with the Batch tier (§5.4 / §6.2, Agent N).
    expect(Object.keys(a).sort()).toEqual([
      "g1",
      "g10",
      "g2",
      "g4",
      "g5",
      "g7",
      "g8",
      "gj",
      "paywall_adfree",
      "paywall_trial",
    ]);
    expect(["g1-sonnet-v1", "g1-haiku-v1"]).toContain(a.g1);
    expect(["trial_0", "trial_7"]).toContain(a.paywall_trial);
    expect(["adfree_off", "adfree_on"]).toContain(a.paywall_adfree);
  });

  it("splits users across both G1 variants", () => {
    const gw = createGateway();
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`);
    const variants = new Set(ids.map((id) => gw.assignments(id).g1));
    expect(variants).toEqual(new Set(["g1-sonnet-v1", "g1-haiku-v1"]));
  });

  it("the variantId in meta matches the assignment for that user", async () => {
    const gw = createGateway();
    const userId = "user-42";
    const res = await gw.g1(g1Input("popstar-era", "en", 1, { userId }));
    expect(res.meta.variantId).toBe(gw.assignments(userId).g1);
  });

  it("exposes the champion map", () => {
    expect(createGateway().champion()).toEqual({
      G1: "g1-sonnet-v1",
      G2: "g2-haiku-v1",
      G4: "g4-sonnet-v1",
      G5: "g5-opus-v1",
      G7: "g7-haiku-v1",
      G8: "g8-haiku-v1",
      G10: "g10-sonnet-v1",
      GJ: "gj-opus-v1",
    });
  });
});

describe("gateway — replay latency", () => {
  it("sleeps ~120-300ms when LLM_REPLAY_LATENCY_MS is left at its default", async () => {
    delete process.env.LLM_REPLAY_LATENCY_MS;
    const gw = createGateway();
    const res = await gw.g1(g1Input("popstar-era", "en", 6));
    expect(res.meta.latencyMs).toBeGreaterThanOrEqual(140);
    expect(res.meta.ttftMs ?? 0).toBeGreaterThan(0);
    expect(res.meta.ttftMs ?? 0).toBeLessThan(res.meta.latencyMs + 1);
    process.env.LLM_REPLAY_LATENCY_MS = "0";
  });
});
