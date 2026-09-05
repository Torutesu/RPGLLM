/**
 * Stand-in gateway, used only when `@rpgllm/llm` fails to load. Its variant ids are prefixed
 * `fake:` on purpose: they flow into `GenerationLog`, and from there into the bandit arms and
 * the cost dashboard, so they must never be mistaken for a real arm.
 */
/**
 * Deterministic in-process Gateway.
 *
 * Two jobs:
 *  1. vitest injects it into `createApp()` so API tests never depend on `@rpgllm/llm`.
 *  2. `index.ts` falls back to it when `@rpgllm/llm` has not shipped `createGateway` yet, so the API
 *     still boots for Agents C/D.
 *
 * Outputs conform to the zod schemas in `@rpgllm/shared`. In `fail` mode every generator returns a
 * fallback output with `meta.fallback = true` (the gateway contract: generators never throw).
 */
import {
  PRICING, SAFETY_BLOCK_TEST_PHRASES,
  type G1Input, type G1Output, type G4Input, type G4Output, type G5Input, type G5Output,
  type G7Input, type G7Output, type G8Input, type G8Output,
  type GenerationMeta, type GenerationResult, type GeneratorId, type ModelTier, type WorldSeed,
} from "@rpgllm/shared";
import type {
  AnyBatchItem, AnyBatchOutcome, BatchItem, BatchResults, Gateway, LlmMode, RunOptions,
  G2Input, G2Output, G9ScreenInput, G9ScreenOutput, G10Input, G10Output, GJInput, GJOutput,
} from "@rpgllm/llm";
import { batchStopReason, scoreCandidateOffline } from "@rpgllm/llm";
import { BATCH_DISCOUNT } from "@rpgllm/shared";
import { hashString, seededRandom } from "./services/rng";
import { modelForTier } from "./env";
import { buildStandInWorldSeed } from "./fake-world-seed";
import type { G9Fn, G9Input } from "./services/g9";

export interface FakeCall { generator: GeneratorId; tier: ModelTier; escalatedFrom: string | null; input: unknown }

const CHAMPION_TIER: Record<GeneratorId, ModelTier> = {
  G1: "mid", G2: "light", G3: "light", G4: "mid", G5: "high", G7: "light", G8: "light", G9: "high", G10: "mid", GJ: "high",
};

const price = (model: string) => PRICING[model] ?? { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

export interface FakeGateway extends Gateway {
  /** G9 lives here until `@rpgllm/llm` exports it; `services/g9.ts` feature-detects either way. */
  g9: G9Fn;
  calls: FakeCall[];
  /** force the next N generator calls to behave as if the model failed */
  failNext(n: number): void;
}

export function createFakeGateway(initialMode: LlmMode = "replay"): FakeGateway {
  let mode: LlmMode = initialMode;
  let forcedFailures = 0;
  const calls: FakeCall[] = [];

  const meta = (
    generator: GeneratorId,
    tier: ModelTier,
    promptSeed: string,
    fallback: boolean,
    opts: RunOptions | undefined,
    outSize: number,
  ): GenerationMeta => {
    const model = modelForTier(tier);
    const p = price(model);
    const inputTokens = 400 + (hashString(promptSeed) % 200);
    const cacheReadTokens = 4096;
    const cacheWriteTokens = 0;
    const outputTokens = Math.max(20, outSize);
    const costUsd =
      (inputTokens * p.input + outputTokens * p.output + cacheReadTokens * p.cacheRead + cacheWriteTokens * p.cacheWrite) / 1_000_000;
    return {
      generator,
      variantId: opts?.variantId ?? `${generator.toLowerCase()}_${tier}_v1`,
      model,
      tier,
      promptHash: `h${hashString(promptSeed).toString(16)}`,
      usage: { inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens },
      costUsd: Math.max(costUsd, 0.000001),
      ttftMs: fallback ? null : 120,
      latencyMs: fallback ? 5 : 400,
      stopReason: fallback ? "error" : "replay",
      fallback,
      escalatedFrom: opts?.escalatedFrom ?? null,
    };
  };

  const shouldFail = (): boolean => {
    if (mode === "fail") return true;
    if (forcedFailures > 0) { forcedFailures -= 1; return true; }
    return false;
  };

  const tierFor = (g: GeneratorId, opts?: RunOptions): ModelTier => opts?.tier ?? CHAMPION_TIER[g];

  const record = (generator: GeneratorId, tier: ModelTier, opts: RunOptions | undefined, input: unknown) => {
    calls.push({ generator, tier, escalatedFrom: opts?.escalatedFrom ?? null, input });
  };

  const g1 = async (input: G1Input, opts?: RunOptions): Promise<GenerationResult<G1Output>> => {
    // Keep variantId consistent with GET /experiments/assignments (E2E-013 compares the two).
    const assignedVariant = opts?.variantId ?? assignments(input.userId ?? "").g1_model ?? "fake:g1-mid";
    const tier = opts?.tier ?? (assignedVariant.includes("light") ? "light" : "mid");
    const runOpts: RunOptions = { ...opts, tier, variantId: assignedVariant };
    record("G1", tier, opts, input);
    const pool = (input.involved.length > 0 ? input.involved.map((r) => r.handle) : input.cast.map((c) => c.handle));
    const handles = pool.length > 0 ? pool : ["@unknown"];
    const failed = shouldFail();
    const seedKey = `${input.worldSlug}:${input.locale}:${input.seed}:${input.k}`;
    const rnd = seededRandom(input.seed || hashString(seedKey));
    const ja = input.locale === "ja";

    if (failed) {
      const line = ja ? "👀" : "👀";
      const replies = Array.from({ length: Math.max(1, Math.min(input.k, handles.length)) }, (_v, i) => ({
        characterHandle: handles[i % handles.length] ?? "@unknown",
        text: line,
      }));
      const output: G1Output = {
        replies,
        stat_deltas: { followers: 0, aura: 0, humor: 0 },
        narrative: ja ? "世界はまだ反応を決めかねている。" : "The world hasn't made up its mind yet.",
        relationship_deltas: {},
        memory_notes: [],
        news: null,
        safety_flag: false,
      };
      return { output, meta: meta("G1", tier, seedKey, true, runOpts, 24) };
    }

    const bodyEn = [
      "iconic timing 👑", "hm. bold.", "SOURCES SAY: this changes the week.",
      "screaming, respectfully", "we'll see friday", "noted. loudly.",
    ];
    const bodyJa = [
      "神タイミング 👑", "ふーん、強気だな。", "関係者:これで今週の流れが変わる。",
      "叫んでる、敬意を込めて", "金曜に見せてもらう", "記録した。大声で。",
    ];
    const body = ja ? bodyJa : bodyEn;
    const k = Math.max(1, Math.min(4, input.k));
    const replies = Array.from({ length: k }, (_v, i) => ({
      characterHandle: handles[i % handles.length] ?? "@unknown",
      // A 👎 regeneration must read differently from the line it replaces, whatever tier it lands
      // on: without the escalatedFrom arm a light→mid escalation could redraw the same line.
      text: `${body[(Math.floor(rnd() * body.length) + i) % body.length] ?? "ok"}${
        tier === "high" || opts?.escalatedFrom ? (ja ? "(再考)" : " (reconsidered)") : ""
      }`,
    }));
    const relationship_deltas: Record<string, -1 | 0 | 1> = {};
    for (const h of handles.slice(0, 3)) relationship_deltas[h] = 1;
    const output: G1Output = {
      replies,
      stat_deltas: { followers: 3 + Math.floor(rnd() * 5), aura: 2, humor: 1 },
      narrative: ja
        ? "投稿はタイムラインに小さな波紋を残し、朝には誰もが引用していた。"
        : "The post left a ripple across the timeline; by morning everyone was quoting it.",
      relationship_deltas,
      memory_notes: [{ handle: handles[0] ?? "@unknown", note: input.post.text.slice(0, 60) }],
      news: input.includeNews ? { text: ja ? "速報:タイムラインが一斉に振り向いた。" : "BREAKING: the timeline turned its head all at once." } : null,
      safety_flag: input.softened,
    };
    return { output, meta: meta("G1", tier, seedKey, false, runOpts, 60 + k * 20) };
  };

  const g4 = async (input: G4Input, opts?: RunOptions): Promise<GenerationResult<G4Output>> => {
    const tier = tierFor("G4", opts);
    record("G4", tier, opts, input);
    const failed = shouldFail();
    const seedKey = `${input.worldSlug}:${input.locale}:${input.seed}:dm`;
    const ja = input.locale === "ja";
    if (failed) {
      const output: G4Output = { bubbles: [ja ? "既読 ✓✓" : "seen ✓✓"], affinity_delta: 0, memory_note: null, safety_flag: false };
      return { output, meta: meta("G4", tier, seedKey, true, opts, 12) };
    }
    const bubbles = ja
      ? ["見た。", "というか全部見た。", "落ち着いて、こっちで対応する。"]
      : ["saw it.", "saw all of it actually.", "breathe — i'm handling it."];
    const n = 1 + (hashString(seedKey) % 3);
    const output: G4Output = {
      bubbles: bubbles.slice(0, n),
      affinity_delta: 1,
      memory_note: input.message.slice(0, 60),
      safety_flag: input.softened,
    };
    return { output, meta: meta("G4", tier, seedKey, false, opts, 40) };
  };

  const g5 = async (input: G5Input, opts?: RunOptions): Promise<GenerationResult<G5Output>> => {
    const tier = tierFor("G5", opts);
    record("G5", tier, opts, input);
    const failed = shouldFail();
    const seedKey = `${input.worldSlug}:${input.locale}:${input.seed}:event`;
    const ja = input.locale === "ja";
    if (failed) {
      // gateway contract: still return a valid shape, marked as fallback
      const output: G5Output = {
        title: ja ? "静かな一日" : "A quiet day",
        prompt: ja ? "何も起きていない。何をする?" : "Nothing is happening. What do you do?",
        choices: [0, 1, 2].map((i) => ({
          id: `c${i + 1}`,
          label: ja ? `選択肢 ${i + 1}` : `Option ${i + 1}`,
          outcomeText: ja ? "特に何も変わらなかった。" : "Nothing much changed.",
          statDeltas: { followers: 0, aura: 0, humor: 0 },
          relationshipDeltas: {},
          newsText: null,
        })) as G5Output["choices"],
      };
      return { output, meta: meta("G5", tier, seedKey, true, opts, 40) };
    }
    const handles = input.relationships.map((r) => r.handle);
    const output: G5Output = {
      title: ja ? "捏造スクショ" : "Fabricated screenshots",
      prompt: ja
        ? "匿名の「関係者」が捏造スクショを流している。どう応じる?"
        : "Anonymous 'sources' are flooding the timeline with fabricated screenshots. How do you respond?",
      choices: [
        {
          id: "burn", label: ja ? "焼き払う" : "Burn it down",
          outcomeText: ja ? "朝にはタイムラインはクレーターだった。" : "By morning the timeline is a crater.",
          statDeltas: { followers: 8, aura: 4, humor: -1 },
          relationshipDeltas: handles[0] ? { [handles[0]]: 1 } : {},
          newsText: ja ? "速報:深夜の一撃でタイムラインが停止。" : "BREAKING: a midnight strike stops the timeline cold.",
        },
        {
          id: "receipts", label: ja ? "証拠を出す" : "Drop receipts",
          outcomeText: ja ? "証拠は地味で、日付入りで、致命的だった。" : "The receipts are boring, dated and devastating.",
          statDeltas: { followers: 5, aura: 6, humor: 0 },
          relationshipDeltas: handles[1] ? { [handles[1]]: 1 } : {},
          newsText: ja ? "独占:日付入りのメモが全てを覆した。" : "EXCLUSIVE: dated studio memos flip the story.",
        },
        {
          id: "silence", label: ja ? "沈黙する" : "Stay silent",
          outcomeText: ja ? "十一時間の沈黙が仕事をした。" : "Eleven hours of silence does the work.",
          statDeltas: { followers: 2, aura: 3, humor: 1 },
          relationshipDeltas: {},
          newsText: null,
        },
      ],
    };
    return { output, meta: meta("G5", tier, seedKey, false, opts, 120) };
  };

  const g7 = async (input: G7Input, opts?: RunOptions): Promise<GenerationResult<G7Output>> => {
    const tier = tierFor("G7", opts);
    record("G7", tier, opts, input);
    const failed = shouldFail();
    const seedKey = `${input.worldSlug}:${input.locale}:memory`;
    const output: G7Output = {
      relationships: input.relationships.map((r) => ({
        handle: r.handle,
        summary: failed ? r.oldSummary : [r.oldSummary, ...r.notes].filter(Boolean).join(" ").slice(0, 600),
      })),
      worldSummary: failed ? input.persona.worldSummary : `${input.persona.handle}: ${input.persona.worldSummary}`.slice(0, 1600),
    };
    return { output, meta: meta("G7", tier, seedKey, failed, opts, 60) };
  };

  const g8 = async (input: G8Input, opts?: RunOptions): Promise<GenerationResult<G8Output>> => {
    const tier = tierFor("G8", opts);
    record("G8", tier, opts, input);
    const lowered = input.text.toLowerCase();
    const blocked = SAFETY_BLOCK_TEST_PHRASES.some((p) => lowered.includes(p.toLowerCase()));
    const soften = !blocked && (lowered.includes("[soften]") || lowered.includes("soften-me"));
    const output: G8Output = blocked
      ? { verdict: "block", category: "policy" }
      : soften
        ? { verdict: "soften", category: "edgy" }
        : { verdict: "allow", category: null };
    return { output, meta: meta("G8", tier, `safety:${input.text}`, false, opts, 8) };
  };


  /**
   * G9 — World Studio (AIF-003). The one generator a *user* can trigger by hand, so the stand-in
   * has to be as real as the others: a full `WorldSeed` that parses and whose bibles clear the
   * 4,096-token floor in both locales (`fake-world-seed.ts`). In `fail` mode — and under
   * `failNext()` — it comes back as a fallback with an empty bible, which is exactly the shape the
   * build job must refuse and refund.
   */
  const g9 = async (input: G9Input, opts?: RunOptions): Promise<GenerationResult<WorldSeed>> => {
    const tier = tierFor("G9", opts);
    record("G9", tier, opts, input);
    const failed = shouldFail();
    const seedKey = `${input.slug}:${input.genre}:${input.seed}`;
    const output = buildStandInWorldSeed(input);
    if (failed) {
      return {
        output: { ...output, bible: { en: "", ja: "" } },
        meta: meta("G9", tier, seedKey, true, opts, 40),
      };
    }
    return { output, meta: meta("G9", tier, seedKey, false, opts, 4000) };
  };

  /* ---------------------------------------------------------------- batch tier ---- */

  const g2 = async (input: G2Input, opts?: RunOptions): Promise<GenerationResult<G2Output>> => {
    const tier = tierFor("G2", opts);
    record("G2", tier, opts, input);
    const failed = shouldFail();
    const ja = input.locale === "ja";
    const handles = input.cast.map((c) => c.handle);
    const lines = ja
      ? ["リハ延びた。", "スタジオの自販機が壊れてる。", "誰か傘持ってない?", "今日の空、無料。"]
      : ["rehearsal ran long.", "the studio vending machine is broken again.", "does anyone own an umbrella", "sky's free today."];
    const n = Math.max(1, Math.min(input.n, 12));
    const posts = Array.from({ length: failed ? 1 : n }, (_v, i) => ({
      characterHandle: handles[i % Math.max(1, handles.length)] ?? "unknown",
      text: `${lines[i % lines.length] ?? "..."}${failed ? "" : ` #${i + 1}`}`,
    }));
    return { output: { posts }, meta: meta("G2", tier, `${input.worldSlug}:${input.locale}:g2:${input.seed}`, failed, opts, 20 * posts.length) };
  };

  const g10 = async (input: G10Input, opts?: RunOptions): Promise<GenerationResult<G10Output>> => {
    const tier = tierFor("G10", opts);
    record("G10", tier, opts, input);
    const failed = shouldFail();
    const ja = input.locale === "ja";
    const handles = input.cast.map((c) => c.handle);
    const posts = Array.from({ length: failed ? 1 : 3 }, (_v, i) => ({
      characterHandle: handles[i % Math.max(1, handles.length)] ?? "unknown",
      text: ja ? `不在中の出来事 ${i + 1}` : `something happened while you were out (${i + 1})`,
    }));
    const closest = input.relationships[0];
    const output: G10Output = {
      posts,
      dm: failed || closest === undefined ? null : { characterHandle: closest.handle, bubbles: [ja ? "戻ってきた?" : "you back?"] },
      digest: ja ? "世界は静かに動いた。" : "The world moved while you were away.",
    };
    return { output, meta: meta("G10", tier, `${input.worldSlug}:${input.locale}:g10:${input.seed}`, failed, opts, 80) };
  };

  const gj = async (input: GJInput, opts?: RunOptions): Promise<GenerationResult<GJOutput>> => {
    const tier = tierFor("GJ", opts);
    record("GJ", tier, opts, input);
    const failed = shouldFail();
    const output: GJOutput = failed
      ? { scores: { inCharacter: 0, diversity: 0, humour: 0, emoji: 0, safety: 0, jpNaturalness: 0 }, verdict: "fail", notes: "judge unavailable" }
      : scoreCandidateOffline(input);
    return { output, meta: meta("GJ", tier, `gj:${input.caseLabel}:${input.candidate.length}`, failed, opts, 40) };
  };

  /**
   * The batch tier, faked: run each entry through the single-call fake, then apply the two things
   * that make a batched call a batched call — half price and the `batch:` stop-reason marker
   * (packages/llm/src/cost.ts). Results are keyed by `customId`, never by position.
   */
  async function fakeBatch<TIn, TOut>(
    items: ReadonlyArray<BatchItem<TIn>>,
    one: (input: TIn, opts?: RunOptions) => Promise<GenerationResult<TOut>>,
  ): Promise<BatchResults<TOut>> {
    const out: BatchResults<TOut> = new Map();
    for (const item of items) {
      const res = await one(item.input, item.opts);
      const batched: GenerationMeta = {
        ...res.meta,
        costUsd: res.meta.costUsd * BATCH_DISCOUNT,
        ttftMs: null,
        stopReason: batchStopReason(res.meta.stopReason),
      };
      out.set(item.customId, {
        customId: item.customId,
        status: res.meta.fallback ? "errored" : "succeeded",
        output: res.output,
        meta: batched,
      });
    }
    return out;
  }

  /**
   * AIF-003 premise screen, layer 2. The real one is a light-tier classifier that only runs in live
   * mode, behind `screenPremiseDeep`; in replay this stands in for it and agrees with layer 1 on the
   * phrases the suite plants, so a test that reaches it deliberately sees the same verdict.
   */
  const g9Screen = async (input: G9ScreenInput, opts?: RunOptions): Promise<GenerationResult<G9ScreenOutput>> => {
    const tier = tierFor("G9", opts);
    record("G9", tier, opts, input);
    const lowered = input.premise.toLowerCase();
    const blocked = SAFETY_BLOCK_TEST_PHRASES.some((p) => lowered.includes(p.toLowerCase()));
    const output: G9ScreenOutput = blocked ? { verdict: "block", category: "policy" } : { verdict: "allow", category: null };
    return { output, meta: meta("G9", tier, `screen:${input.premise}`, false, opts, 8) };
  };

  const batchG1 = (items: ReadonlyArray<BatchItem<G1Input>>) => fakeBatch(items, g1);
  const batchG2 = (items: ReadonlyArray<BatchItem<G2Input>>) => fakeBatch(items, g2);
  const batchG4 = (items: ReadonlyArray<BatchItem<G4Input>>) => fakeBatch(items, g4);
  const batchG5 = (items: ReadonlyArray<BatchItem<G5Input>>) => fakeBatch(items, g5);
  const batchG7 = (items: ReadonlyArray<BatchItem<G7Input>>) => fakeBatch(items, g7);
  const batchG10 = (items: ReadonlyArray<BatchItem<G10Input>>) => fakeBatch(items, g10);
  const batchGJ = (items: ReadonlyArray<BatchItem<GJInput>>) => fakeBatch(items, gj);

  const batch = async (items: readonly AnyBatchItem[]): Promise<Map<string, AnyBatchOutcome>> => {
    const merged = new Map<string, AnyBatchOutcome>();
    for (const item of items) {
      switch (item.generator) {
        case "G1": for (const [id, o] of await batchG1([item])) merged.set(id, { generator: "G1", ...o }); break;
        case "G2": for (const [id, o] of await batchG2([item])) merged.set(id, { generator: "G2", ...o }); break;
        case "G4": for (const [id, o] of await batchG4([item])) merged.set(id, { generator: "G4", ...o }); break;
        case "G5": for (const [id, o] of await batchG5([item])) merged.set(id, { generator: "G5", ...o }); break;
        case "G7": for (const [id, o] of await batchG7([item])) merged.set(id, { generator: "G7", ...o }); break;
        case "G8": { const r = await g8(item.input, item.opts); merged.set(item.customId, { generator: "G8", customId: item.customId, status: r.meta.fallback ? "errored" : "succeeded", output: r.output, meta: { ...r.meta, costUsd: r.meta.costUsd * BATCH_DISCOUNT, ttftMs: null, stopReason: batchStopReason(r.meta.stopReason) } }); break; }
        case "G10": for (const [id, o] of await batchG10([item])) merged.set(id, { generator: "G10", ...o }); break;
        case "GJ": for (const [id, o] of await batchGJ([item])) merged.set(id, { generator: "GJ", ...o }); break;
      }
    }
    return merged;
  };

  const assignments = (userId: string): Record<string, string> => {
    const h = hashString(userId || "anon");
    return {
      g1_model: h % 2 === 0 ? "fake:g1-mid" : "fake:g1-light",
      paywall_trial: h % 2 === 0 ? "trial_7" : "trial_0",
      paywall_adfree: h % 2 === 0 ? "adfree_on" : "adfree_off",
    };
  };

  return {
    mode: () => mode,
    setMode: (m: LlmMode) => { mode = m; },
    g1, g2, g4, g5, g7, g8, g9, g9Screen, g10, gj,
    batch, batchG1, batchG2, batchG4, batchG5, batchG7, batchG10, batchGJ,
    assignments,
    champion: () => ({ G1: "fake:g1-mid", G4: "fake:g4-mid", G5: "fake:g5-high", G8: "fake:g8-light" }),
    calls,
    failNext: (n: number) => { forcedFailures = n; },
  };
}
