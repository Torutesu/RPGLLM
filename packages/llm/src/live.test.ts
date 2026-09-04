import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { G1OutputZ, G5OutputZ, G8OutputZ } from "@rpgllm/shared";
import { buildRequest, refusalFallbacksEnabled, REFUSAL_FALLBACK_BETA } from "./modes/live.js";
import { g1 } from "./generators/g1.js";
import { g5 } from "./generators/g5.js";
import { g8 } from "./generators/g8.js";
import { modelForTier } from "./experiments.js";
import { estimateTokens } from "./tokens.js";
import { g1Input, g5Input } from "./__testkit.js";

/**
 * Live mode is verified structurally only: there is no API key in this sandbox, so these tests
 * assert on the request object `runLive` would send, never on a network round-trip.
 */

const savedEnv = { ...process.env };
beforeEach(() => {
  delete process.env.LLM_MODEL_HIGH;
  delete process.env.LLM_MODEL_MID;
  delete process.env.LLM_MODEL_LIGHT;
  delete process.env.LLM_REFUSAL_FALLBACKS;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe("live request shape", () => {
  it("sends two cached system blocks: GLOBAL_STYLE then the world bible, verbatim", () => {
    const input = g1Input("popstar-era", "en", 1);
    const rendered = g1.render(input);
    const req = buildRequest({
      model: modelForTier("mid"),
      tier: "mid",
      maxTokens: g1.maxTokens,
      rendered,
      schema: G1OutputZ,
    });

    expect(req.system).toHaveLength(2);
    for (const block of req.system) {
      expect(block.type).toBe("text");
      expect(block.cache_control).toEqual({ type: "ephemeral" });
    }
    // system[1] is the bible byte-for-byte — reformatting it would break the shared cache
    expect(req.system[1]?.text).toBe(input.worldBible);
    expect(estimateTokens(req.system[1]?.text ?? "")).toBeGreaterThanOrEqual(4096);
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0]?.role).toBe("user");
    // never prefill an assistant turn
    expect(req.messages.some((m) => (m as { role: string }).role === "assistant")).toBe(false);
  });

  it("keeps the dynamic user block small (<= ~800 tokens)", () => {
    for (const locale of ["en", "ja"] as const) {
      const rendered = g1.render(g1Input("popstar-era", locale, 1));
      expect(estimateTokens(rendered.user)).toBeLessThanOrEqual(800);
    }
  });

  it("renders deterministically — no clock, no ids, no shuffled keys", () => {
    const a = g1.render(g1Input("magic-academy", "ja", 5));
    const b = g1.render(g1Input("magic-academy", "ja", 5));
    expect(a).toEqual(b);
  });

  it("mid tier disables thinking and sets no effort", () => {
    const req = buildRequest({
      model: modelForTier("mid"),
      tier: "mid",
      maxTokens: 1200,
      rendered: g1.render(g1Input("popstar-era", "en", 1)),
      schema: G1OutputZ,
    });
    expect(req.model).toBe("claude-sonnet-5");
    expect(req.thinking).toEqual({ type: "disabled" });
    expect(req.output_config.effort).toBeUndefined();
    expect(req.output_config.format).toBeDefined();
    expect(req.max_tokens).toBe(1200);
  });

  it("high tier omits thinking (adaptive) and asks for effort medium", () => {
    const req = buildRequest({
      model: modelForTier("high"),
      tier: "high",
      maxTokens: g5.maxTokens,
      rendered: g5.render(g5Input("popstar-era", "en", 1)),
      schema: G5OutputZ,
    });
    expect(req.model).toBe("claude-opus-5");
    expect(req.thinking).toBeUndefined();
    expect(req.output_config.effort).toBe("medium");
    expect(req.max_tokens).toBe(2000);
  });

  it("light tier sends neither thinking nor effort", () => {
    const req = buildRequest({
      model: modelForTier("light"),
      tier: "light",
      maxTokens: g8.maxTokens,
      rendered: g8.render({ locale: "en", isMinor: false, text: "hi", surface: "post" }),
      schema: G8OutputZ,
    });
    expect(req.model).toBe("claude-haiku-4-5");
    expect(req.thinking).toBeUndefined();
    expect(req.output_config.effort).toBeUndefined();
  });

  it("takes model ids from LLM_MODEL_* and never hardcodes them at the call site", () => {
    process.env.LLM_MODEL_HIGH = "claude-opus-5-preview";
    process.env.LLM_MODEL_MID = "sonnet-under-test";
    process.env.LLM_MODEL_LIGHT = "haiku-under-test";
    expect(modelForTier("high")).toBe("claude-opus-5-preview");
    expect(modelForTier("mid")).toBe("sonnet-under-test");
    expect(modelForTier("light")).toBe("haiku-under-test");
    const req = buildRequest({
      model: modelForTier("high"),
      tier: "high",
      maxTokens: 2000,
      rendered: g5.render(g5Input("popstar-era", "en", 1)),
      schema: G5OutputZ,
    });
    expect(req.model).toBe("claude-opus-5-preview");
  });

  it("enables server-side refusal fallbacks on the high tier only, behind LLM_REFUSAL_FALLBACKS", () => {
    expect(REFUSAL_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
    expect(refusalFallbacksEnabled("high")).toBe(true);
    expect(refusalFallbacksEnabled("mid")).toBe(false);
    expect(refusalFallbacksEnabled("light")).toBe(false);
    process.env.LLM_REFUSAL_FALLBACKS = "0";
    expect(refusalFallbacksEnabled("high")).toBe(false);
  });

  it("puts the whole cached prefix over the Haiku 4.5 4,096-token minimum", () => {
    for (const slug of ["popstar-era", "magic-academy", "idol-survival"]) {
      for (const locale of ["en", "ja"] as const) {
        const rendered = g1.render(g1Input(slug, locale, 1));
        expect(estimateTokens(rendered.system.join(""))).toBeGreaterThanOrEqual(4096);
      }
    }
  });
});
