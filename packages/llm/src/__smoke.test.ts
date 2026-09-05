import { describe, expect, it } from "vitest";
import { LOCALES, WORLD_GENRES, WorldSeedZ } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { deterministicWorld } from "./generators/g9/index.js";
import { estimateTokens } from "./tokens.js";

describe("g9 smoke", () => {
  it("builds a world per genre", () => {
    for (const genre of WORLD_GENRES) {
      const seed = deterministicWorld({ slug: `test-${genre}`, premise: "a small bakery that becomes famous overnight", genre, locale: "en", seed: 7 });
      const p = WorldSeedZ.safeParse(seed);
      if (!p.success) console.log(genre, JSON.stringify(p.error.issues.slice(0,4), null, 1));
      expect(p.success).toBe(true);
      const toks = LOCALES.map((l) => `${l}=${estimateTokens(seed.bible[l])}`).join(" ");
      console.log(genre.padEnd(14), toks, "| cast", seed.cast.length, "| amb", seed.ambientPool.en.length, "| ev", seed.presetEvents.length, "| pers", seed.presetPersonas.length);
    }
  });

  it("gateway g9 in replay", async () => {
    process.env.LLM_REPLAY_LATENCY_MS = "0";
    const gw = createGateway({ mode: "replay" });
    const rows: string[] = [];
    const gw2 = createGateway({ mode: "replay", onGeneration: (m) => { rows.push(`${m.variantId} ${m.tier} in=${m.usage.inputTokens} cw=${m.usage.cacheWriteTokens} cr=${m.usage.cacheReadTokens} out=${m.usage.outputTokens}`); } });
    const res = await gw2.g9({ slug: "night-market", premise: "a night market where every stall owner has a secret", genre: "slice_of_life", locale: "ja", seed: 3 });
    console.log(rows.join("\n"));
    console.log("agg", JSON.stringify(res.meta.usage), res.meta.costUsd, res.meta.fallback, res.meta.stopReason);
    console.log("title", res.output.title, "| bible tok", estimateTokens(res.output.bible.en), estimateTokens(res.output.bible.ja));
    expect(WorldSeedZ.safeParse(res.output).success).toBe(true);
    expect(gw.mode()).toBe("replay");
  });
});
