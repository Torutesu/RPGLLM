/**
 * Loads `@rpgllm/llm` defensively.
 *
 * Agent B is implementing that package concurrently; while its `createGateway` / `loadWorldSeeds`
 * are still `declare`d (no runtime implementation) the import resolves to an empty module. We use a
 * namespace dynamic import (never a named import, which would throw at link time) and fall back to
 * the local FakeGateway / stand-in seed so the API can still boot and be tested.
 */
import type { WorldSeed } from "@rpgllm/shared";
import type { Gateway, GatewayOptions } from "@rpgllm/llm";
import { createFakeGateway } from "./fake-gateway";
import { FALLBACK_WORLD_SEEDS } from "./seed-fallback";
import { llmMode } from "./env";
import { deepPremiseScreenFrom, premiseScreenFrom, type DeepPremiseScreen, type PremiseScreen } from "./services/g9";

type LlmModule = Partial<{
  createGateway: (opts?: GatewayOptions) => Gateway;
  loadWorldSeeds: () => WorldSeed[];
  estimateTokens: (text: string) => number;
}>;

async function importLlm(): Promise<LlmModule> {
  try {
    return (await import("@rpgllm/llm")) as LlmModule;
  } catch (err) {
    console.warn(`[api] @rpgllm/llm could not be imported (${(err as Error).message}); using local stand-ins`);
    return {};
  }
}

export async function loadGateway(opts?: GatewayOptions): Promise<{ gateway: Gateway; source: "llm" | "fake" }> {
  const mod = await importLlm();
  if (typeof mod.createGateway === "function") {
    try {
      return { gateway: mod.createGateway(opts), source: "llm" };
    } catch (err) {
      console.warn(`[api] createGateway() threw (${(err as Error).message}); using FakeGateway`);
    }
  } else {
    console.warn("[api] @rpgllm/llm has no runtime createGateway yet — using the built-in FakeGateway");
  }
  const mode = llmMode();
  return { gateway: createFakeGateway(mode === "live" || mode === "fail" ? mode : "replay"), source: "fake" };
}

export async function loadSeedsFromLlm(): Promise<{ seeds: WorldSeed[]; source: "llm" | "fallback" }> {
  const mod = await importLlm();
  if (typeof mod.loadWorldSeeds === "function") {
    try {
      const seeds = mod.loadWorldSeeds();
      if (Array.isArray(seeds) && seeds.length > 0) return { seeds, source: "llm" };
    } catch (err) {
      console.warn(`[api] loadWorldSeeds() threw (${(err as Error).message}); using the stand-in seed`);
    }
  }
  return { seeds: FALLBACK_WORLD_SEEDS, source: "fallback" };
}

export async function loadEstimateTokens(): Promise<(text: string) => number> {
  const mod = await importLlm();
  if (typeof mod.estimateTokens === "function") return mod.estimateTokens;
  return (text: string) => Math.ceil(text.length / 3.5);
}

/**
 * The World Studio premise screen (AIF-003). Same defensive shape as everything else here:
 * `@rpgllm/llm` may not export `screenPremise` yet, and the local floor in `services/g9.ts` runs
 * either way — the two verdicts are ANDed, never swapped.
 */
export async function loadPremiseScreen(): Promise<PremiseScreen> {
  return premiseScreenFrom(await importLlm());
}

/**
 * The two-layer screen used by `POST /v1/worlds`. Layer 2 is a model classifier that only runs in
 * live mode, only when every deterministic layer allows, and can only ever tighten the verdict.
 */
export async function loadDeepPremiseScreen(gateway: Gateway): Promise<DeepPremiseScreen> {
  const mod = await importLlm();
  return deepPremiseScreenFrom(mod, gateway, premiseScreenFrom(mod));
}
