import { createHash } from "node:crypto";
import type {
  G1Input,
  G1Output,
  G4Input,
  G4Output,
  G5Input,
  G5Output,
  G7Input,
  G7Output,
  G8Input,
  G8Output,
  GenerationMeta,
  GenerationResult,
  GeneratorId,
  ModelTier,
  Usage,
  WorldSeed,
} from "@rpgllm/shared";
import { BATCHABLE_GENERATORS } from "@rpgllm/shared";
import { batchStopReason, EMPTY_USAGE, priceOf } from "./cost.js";
import { failureKindOf } from "./errors.js";
import { modelForTier, variantFor, type GeneratorVariant } from "./experiments.js";
import { assignmentsFor, championVariants } from "./experiments.js";
import { g1 } from "./generators/g1.js";
import { g2, type G2Input, type G2Output } from "./generators/g2.js";
import { g4 } from "./generators/g4.js";
import { g5 } from "./generators/g5.js";
import { g7 } from "./generators/g7.js";
import { g8 } from "./generators/g8.js";
import { g10, type G10Input, type G10Output } from "./generators/g10.js";
import { runG9, type G9Input } from "./generators/g9/index.js";
import {
  g9Screen,
  replayG9Screen,
  G9_SCREEN_VARIANT_ID,
  type G9ScreenInput,
  type G9ScreenOutput,
} from "./generators/g9/screen-model.js";
import { gj, type GJInput, type GJOutput } from "./generators/gj.js";
import { batchMaxRequests, chunkRequests, runLiveBatch, type BatchEntryStatus } from "./modes/batch.js";
import { runFail } from "./modes/fail.js";
import { runLive } from "./modes/live.js";
import {
  replayG1,
  replayG2,
  replayG4,
  replayG5,
  replayG7,
  replayG8,
  replayG10,
  replayGJ,
} from "./modes/replay.js";
import type { RenderedPrompt } from "./prompts/render.js";
import { estimateTokens, pick } from "./tokens.js";
import type { GeneratorSpec } from "./types.js";

export type LlmMode = "replay" | "live" | "fail";

export interface GatewayOptions {
  mode?: LlmMode;
  onGeneration?: (
    meta: GenerationMeta & { userId: string | null; generator: GeneratorId },
  ) => Promise<void> | void;
  /**
   * Thompson-sampling allocator (cost-architecture §6.3). apps/api passes a function that reads the
   * cached `BanditArm` posteriors; it returns the variant id to use for this (generator, user), or
   * `null` when the bandit has no data — in which case the deterministic 50/50 assignment of
   * `experiments.ts` stands in. Never throws through: a throwing allocator falls back too.
   */
  allocate?: (generator: GeneratorId, userId: string | null) => string | null;
}

export interface RunOptions {
  /** overrides the variant's tier — used by the thumbs-down escalation path */
  tier?: ModelTier;
  variantId?: string;
  escalatedFrom?: string | null;
}

/* ----------------------------------------------------------------- batch ---- */

export interface BatchItem<TIn> {
  /** the caller's own key; results come back under exactly this string */
  customId: string;
  input: TIn;
  opts?: RunOptions;
}

export interface BatchOutcome<TOut> extends GenerationResult<TOut> {
  customId: string;
  /** per-entry API status; `succeeded` in replay mode, `errored` in fail mode */
  status: BatchEntryStatus;
}

export type BatchResults<TOut> = Map<string, BatchOutcome<TOut>>;

/** A mixed-generator batch. Grouped by generator, one API batch per group. */
export type AnyBatchItem =
  | ({ generator: "G1" } & BatchItem<G1Input>)
  | ({ generator: "G2" } & BatchItem<G2Input>)
  | ({ generator: "G4" } & BatchItem<G4Input>)
  | ({ generator: "G5" } & BatchItem<G5Input>)
  | ({ generator: "G7" } & BatchItem<G7Input>)
  | ({ generator: "G8" } & BatchItem<G8Input>)
  | ({ generator: "G10" } & BatchItem<G10Input>)
  | ({ generator: "GJ" } & BatchItem<GJInput>);

export type AnyBatchOutcome =
  | ({ generator: "G1" } & BatchOutcome<G1Output>)
  | ({ generator: "G2" } & BatchOutcome<G2Output>)
  | ({ generator: "G4" } & BatchOutcome<G4Output>)
  | ({ generator: "G5" } & BatchOutcome<G5Output>)
  | ({ generator: "G7" } & BatchOutcome<G7Output>)
  | ({ generator: "G8" } & BatchOutcome<G8Output>)
  | ({ generator: "G10" } & BatchOutcome<G10Output>)
  | ({ generator: "GJ" } & BatchOutcome<GJOutput>);

/** The generators cost-architecture §5.4 puts on the Batch tier. */
export function isBatchable(generator: GeneratorId): boolean {
  return (BATCHABLE_GENERATORS as readonly string[]).includes(generator);
}

export interface Gateway {
  mode(): LlmMode;
  setMode(mode: LlmMode): void;
  g1(input: G1Input, opts?: RunOptions): Promise<GenerationResult<G1Output>>;
  g2(input: G2Input, opts?: RunOptions): Promise<GenerationResult<G2Output>>;
  g4(input: G4Input, opts?: RunOptions): Promise<GenerationResult<G4Output>>;
  g5(input: G5Input, opts?: RunOptions): Promise<GenerationResult<G5Output>>;
  g7(input: G7Input, opts?: RunOptions): Promise<GenerationResult<G7Output>>;
  g8(input: G8Input, opts?: RunOptions): Promise<GenerationResult<G8Output>>;
  /**
   * AIF-003 World Studio. Five staged generators behind one call; each stage logs its own
   * `GenerationLog` row and the returned `meta` is their aggregate (summed usage and cost,
   * wall-clock latency, `fallback` if any stage fell back). Never throws: a failed run returns
   * the deterministic world for `(slug, premise, genre, seed)` with `meta.fallback = true`.
   */
  g9(input: G9Input, opts?: RunOptions): Promise<GenerationResult<WorldSeed>>;
  /**
   * AIF-003 premise screen, layer 2. A ~250-token classifier on the light tier that runs only
   * after the deterministic `screenPremise` has allowed. Callers should use `screenPremiseDeep`,
   * which owns the AND, the timeout and the failure policy; this is the raw call it makes.
   */
  g9Screen(input: G9ScreenInput, opts?: RunOptions): Promise<GenerationResult<G9ScreenOutput>>;
  g10(input: G10Input, opts?: RunOptions): Promise<GenerationResult<G10Output>>;
  gj(input: GJInput, opts?: RunOptions): Promise<GenerationResult<GJOutput>>;
  /** Batch tier (§5.4): 50% off, keyed by `customId`, never by position. */
  batch(items: readonly AnyBatchItem[]): Promise<Map<string, AnyBatchOutcome>>;
  batchG1(items: ReadonlyArray<BatchItem<G1Input>>): Promise<BatchResults<G1Output>>;
  batchG2(items: ReadonlyArray<BatchItem<G2Input>>): Promise<BatchResults<G2Output>>;
  batchG4(items: ReadonlyArray<BatchItem<G4Input>>): Promise<BatchResults<G4Output>>;
  batchG5(items: ReadonlyArray<BatchItem<G5Input>>): Promise<BatchResults<G5Output>>;
  batchG7(items: ReadonlyArray<BatchItem<G7Input>>): Promise<BatchResults<G7Output>>;
  batchG10(items: ReadonlyArray<BatchItem<G10Input>>): Promise<BatchResults<G10Output>>;
  batchGJ(items: ReadonlyArray<BatchItem<GJInput>>): Promise<BatchResults<GJOutput>>;
  assignments(userId: string): Record<string, string>;
  champion(): Record<string, string>;
}

function isMode(v: string | undefined): v is LlmMode {
  return v === "replay" || v === "live" || v === "fail";
}

function promptHashOf(rendered: RenderedPrompt): string {
  const canonical = [...rendered.system, "---", rendered.user].join("\n\n \n\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function prefixKeyOf(rendered: RenderedPrompt): string {
  return createHash("sha256").update(rendered.system.join("\n \n"), "utf8").digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function replayLatencyBase(): number {
  const raw = process.env.LLM_REPLAY_LATENCY_MS;
  if (raw === undefined || raw.trim() === "") return 150;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 150;
}

/**
 * The only module apps/api talks to. Generator methods NEVER throw: any failure (fail mode,
 * transport error, refusal, invalid JSON after one retry in live mode) resolves to the
 * generator's deterministic fallback with `meta.fallback = true`.
 */
export function createGateway(opts: GatewayOptions = {}): Gateway {
  let mode: LlmMode = opts.mode ?? (isMode(process.env.LLM_MODE) ? process.env.LLM_MODE : "replay");

  /**
   * Replay cache simulation: the first call in this process that sends a given cached prefix
   * bills it as a cache write, every later one as a cache read. The key is a hash of the two
   * system blocks, i.e. (GLOBAL_STYLE[locale] + world bible) — exactly the real cache key
   * granularity of worldSlug x locale.
   */
  const prefixSeen = new Set<string>();

  function replayUsage(rendered: RenderedPrompt, output: unknown): Usage {
    const prefixKey = prefixKeyOf(rendered);
    const prefixTokens = estimateTokens(rendered.system.join("\n"));
    const firstTime = !prefixSeen.has(prefixKey);
    prefixSeen.add(prefixKey);
    return {
      inputTokens: estimateTokens(rendered.user),
      cacheWriteTokens: firstTime ? prefixTokens : 0,
      cacheReadTokens: firstTime ? 0 : prefixTokens,
      outputTokens: estimateTokens(JSON.stringify(output)),
    };
  }

  /** Variant for this call: forced id > bandit allocation > deterministic sticky assignment. */
  function variantOf(generator: GeneratorId, userId: string | null, forced: string | undefined) {
    if (forced === undefined && opts.allocate !== undefined) {
      let allocated: string | null = null;
      try {
        allocated = opts.allocate(generator, userId);
      } catch {
        allocated = null;
      }
      if (allocated !== null) return variantFor(generator, userId, allocated);
    }
    return variantFor(generator, userId, forced);
  }

  function renderSafely<TIn, TOut>(spec: GeneratorSpec<TIn, TOut>, input: TIn): RenderedPrompt {
    try {
      return spec.render(input);
    } catch {
      return { system: ["", ""], user: "" };
    }
  }

  async function emit(meta: GenerationMeta, userId: string | null, generator: GeneratorId): Promise<void> {
    if (opts.onGeneration === undefined) return;
    try {
      await opts.onGeneration({ ...meta, userId, generator });
    } catch {
      // logging must never break a generation
    }
  }

  // No constraint on TIn: G9's stage inputs are nested records, not the flat `BaseCtx` shape.
  async function run<TIn, TOut>(
    spec: GeneratorSpec<TIn, TOut>,
    input: TIn,
    runOpts: RunOptions | undefined,
    userId: string | null,
    replayFn: (input: TIn) => TOut,
    seedFor: (input: TIn) => number,
    /**
     * G9 is five specs behind one `GeneratorId`, so its stages name their own variant instead of
     * drawing one from the experiment registry (which allocates per generator, not per stage).
     */
    fixedVariant?: GeneratorVariant,
  ): Promise<GenerationResult<TOut>> {
    const variant = fixedVariant ?? variantOf(spec.id, userId, runOpts?.variantId);
    const tier = runOpts?.tier ?? variant.tier;
    const model = modelForTier(tier);
    const escalatedFrom = runOpts?.escalatedFrom ?? null;

    const rendered = renderSafely(spec, input);
    const promptHash = promptHashOf(rendered);

    const started = Date.now();
    let output: TOut | null = null;
    let usage: Usage = EMPTY_USAGE;
    let stopReason = "end_turn";
    let fallback = false;
    let ttftMs: number | null = null;
    let billedModel = model;

    if (mode === "fail") {
      try {
        runFail();
      } catch (err) {
        stopReason = failureKindOf(err);
        fallback = true;
      }
    } else if (mode === "replay") {
      let replayed: TOut | null = null;
      try {
        const raw = replayFn(input);
        replayed = spec.postprocess(raw, input);
      } catch {
        replayed = null;
      }
      if (replayed === null) {
        output = spec.fallback(input);
        fallback = true;
        stopReason = "error";
      } else {
        output = replayed;
        stopReason = "replay";
      }

      usage = replayUsage(rendered, output);

      const base = replayLatencyBase();
      if (base > 0) {
        const jitter = pick(150, seedFor(input), promptHash);
        const total = Math.round(base + jitter);
        ttftMs = Math.round(total * 0.45);
        await sleep(total);
      } else {
        ttftMs = 0;
      }
    } else {
      // live: one retry, then the deterministic fallback.
      for (let attempt = 0; attempt < 2 && output === null; attempt += 1) {
        try {
          const res = await runLive({
            model,
            tier,
            maxTokens: variant.maxTokens || spec.maxTokens,
            rendered,
            schema: spec.schema,
          });
          const cleaned = spec.postprocess(res.output, input);
          usage = res.usage;
          billedModel = res.model;
          ttftMs = res.ttftMs;
          if (cleaned === null) {
            stopReason = "invalid_json";
            continue;
          }
          output = cleaned;
          stopReason = res.stopReason;
        } catch (err) {
          stopReason = failureKindOf(err);
        }
      }
      if (output === null) {
        output = spec.fallback(input);
        fallback = true;
      }
    }

    if (output === null) {
      output = spec.fallback(input);
      fallback = true;
    }

    const meta: GenerationMeta = {
      generator: spec.id,
      variantId: variant.id,
      model: billedModel,
      tier,
      promptHash,
      usage,
      costUsd: priceOf(billedModel, usage),
      ttftMs,
      latencyMs: Date.now() - started,
      stopReason,
      fallback,
      escalatedFrom,
    };

    await emit(meta, userId, spec.id);
    return { output, meta };
  }

  /**
   * One batch of one generator (cost-architecture §5.4). Every entry resolves — a per-entry
   * failure yields that generator's deterministic fallback, exactly like the interactive path —
   * and every entry is priced at `BATCH_DISCOUNT` and marked `batch:` in its stop reason.
   */
  async function runBatch<TIn extends { locale?: string }, TOut>(
    spec: GeneratorSpec<TIn, TOut>,
    items: ReadonlyArray<BatchItem<TIn>>,
    replayFn: (input: TIn) => TOut,
    userIdOf: (input: TIn) => string | null,
  ): Promise<BatchResults<TOut>> {
    const out: BatchResults<TOut> = new Map();
    if (items.length === 0) return out;

    interface Prepared {
      item: BatchItem<TIn>;
      userId: string | null;
      variantId: string;
      tier: ModelTier;
      model: string;
      maxTokens: number;
      rendered: RenderedPrompt;
      promptHash: string;
      started: number;
    }

    const prepared: Prepared[] = items.map((item) => {
      const userId = userIdOf(item.input);
      const variant = variantOf(spec.id, userId, item.opts?.variantId);
      const tier = item.opts?.tier ?? variant.tier;
      const rendered = renderSafely(spec, item.input);
      return {
        item,
        userId,
        variantId: variant.id,
        tier,
        model: modelForTier(tier),
        maxTokens: variant.maxTokens || spec.maxTokens,
        rendered,
        promptHash: promptHashOf(rendered),
        started: Date.now(),
      };
    });

    const finish = async (
      p: Prepared,
      status: BatchEntryStatus,
      output: TOut | null,
      usage: Usage,
      rawStopReason: string,
      billedModel: string,
    ): Promise<void> => {
      const fallback = output === null;
      const resolved = output ?? spec.fallback(p.item.input);
      const meta: GenerationMeta = {
        generator: spec.id,
        variantId: p.variantId,
        model: billedModel,
        tier: p.tier,
        promptHash: p.promptHash,
        usage,
        costUsd: priceOf(billedModel, usage, { batch: true }),
        ttftMs: null, // a batch has no time-to-first-token
        latencyMs: Date.now() - p.started,
        stopReason: batchStopReason(rawStopReason),
        fallback,
        escalatedFrom: p.item.opts?.escalatedFrom ?? null,
      };
      await emit(meta, p.userId, spec.id);
      out.set(p.item.customId, { customId: p.item.customId, status, output: resolved, meta });
    };

    if (mode === "fail") {
      for (const p of prepared) await finish(p, "errored", null, EMPTY_USAGE, "error", p.model);
      return out;
    }

    if (mode === "replay") {
      for (const p of prepared) {
        let replayed: TOut | null = null;
        try {
          const raw = replayFn(p.item.input);
          replayed = spec.postprocess(raw, p.item.input);
        } catch {
          replayed = null;
        }
        const usage = replayUsage(p.rendered, replayed ?? spec.fallback(p.item.input));
        await finish(p, "succeeded", replayed, usage, replayed === null ? "error" : "replay", p.model);
      }
      return out;
    }

    // live: chunk, submit, poll, then resolve every entry by custom_id.
    for (const chunk of chunkRequests(prepared, batchMaxRequests())) {
      const outcomes = await runLiveBatch<TOut>({
        items: chunk.map((p) => ({
          customId: p.item.customId,
          args: {
            model: p.model,
            tier: p.tier,
            maxTokens: p.maxTokens,
            rendered: p.rendered,
            schema: spec.schema,
          },
        })),
      });
      for (const p of chunk) {
        const outcome = outcomes.get(p.item.customId);
        if (outcome === undefined) {
          await finish(p, "expired", null, EMPTY_USAGE, "error", p.model);
          continue;
        }
        const cleaned =
          outcome.output === null ? null : spec.postprocess(outcome.output, p.item.input);
        const reason = cleaned === null && outcome.stopReason === "end_turn" ? "invalid_json" : outcome.stopReason;
        await finish(
          p,
          outcome.status,
          cleaned,
          outcome.usage,
          reason,
          outcome.model === "" ? p.model : outcome.model,
        );
      }
    }
    return out;
  }

  /**
   * AIF-003. The studio's stages are ordinary generator calls — same logging, same pricing, same
   * replay clock — with their variant and tier named by the stage rather than allocated. G9 runs
   * before a world (and often before a persona) exists, so its rows carry a null userId; apps/api
   * attaches the world and the wallet on its side.
   */
  async function g9(input: G9Input, runOpts?: RunOptions): Promise<GenerationResult<WorldSeed>> {
    return runG9(
      input,
      async ({ spec, variantId, tier, maxTokens, input: stageInput, replay, seed }) =>
        run(
          spec,
          stageInput,
          runOpts,
          null,
          replay,
          () => seed,
          { id: variantId, generator: "G9", tier: runOpts?.tier ?? tier, maxTokens },
        ),
      runOpts?.escalatedFrom ?? null,
    );
  }

  const nullUser = (): string | null => null;

  const batchG1 = (items: ReadonlyArray<BatchItem<G1Input>>) =>
    runBatch(g1, items, replayG1, (i) => i.userId);
  const batchG2 = (items: ReadonlyArray<BatchItem<G2Input>>) =>
    runBatch(g2, items, replayG2, (i) => i.userId);
  const batchG4 = (items: ReadonlyArray<BatchItem<G4Input>>) =>
    runBatch(g4, items, replayG4, (i) => i.userId);
  const batchG5 = (items: ReadonlyArray<BatchItem<G5Input>>) =>
    runBatch(g5, items, replayG5, (i) => i.userId);
  const batchG7 = (items: ReadonlyArray<BatchItem<G7Input>>) =>
    runBatch(g7, items, replayG7, (i) => i.userId);
  const batchG8 = (items: ReadonlyArray<BatchItem<G8Input>>) =>
    runBatch(g8, items, replayG8, nullUser);
  const batchG10 = (items: ReadonlyArray<BatchItem<G10Input>>) =>
    runBatch(g10, items, replayG10, (i) => i.userId);
  const batchGJ = (items: ReadonlyArray<BatchItem<GJInput>>) =>
    runBatch(gj, items, replayGJ, nullUser);

  async function batch(items: readonly AnyBatchItem[]): Promise<Map<string, AnyBatchOutcome>> {
    const merged = new Map<string, AnyBatchOutcome>();
    const take = <T>(list: readonly AnyBatchItem[], generator: AnyBatchItem["generator"]): Array<BatchItem<T>> =>
      list
        .filter((i) => i.generator === generator)
        .map((i) => ({ customId: i.customId, input: i.input as T, ...(i.opts ? { opts: i.opts } : {}) }));

    const groups: Array<[AnyBatchItem["generator"], Promise<BatchResults<unknown>>]> = [];
    if (items.some((i) => i.generator === "G1")) groups.push(["G1", batchG1(take<G1Input>(items, "G1"))]);
    if (items.some((i) => i.generator === "G2")) groups.push(["G2", batchG2(take<G2Input>(items, "G2"))]);
    if (items.some((i) => i.generator === "G4")) groups.push(["G4", batchG4(take<G4Input>(items, "G4"))]);
    if (items.some((i) => i.generator === "G5")) groups.push(["G5", batchG5(take<G5Input>(items, "G5"))]);
    if (items.some((i) => i.generator === "G7")) groups.push(["G7", batchG7(take<G7Input>(items, "G7"))]);
    if (items.some((i) => i.generator === "G8")) groups.push(["G8", batchG8(take<G8Input>(items, "G8"))]);
    if (items.some((i) => i.generator === "G10")) groups.push(["G10", batchG10(take<G10Input>(items, "G10"))]);
    if (items.some((i) => i.generator === "GJ")) groups.push(["GJ", batchGJ(take<GJInput>(items, "GJ"))]);

    for (const [generator, promise] of groups) {
      const results = await promise;
      for (const [customId, outcome] of results) {
        merged.set(customId, { generator, ...outcome } as AnyBatchOutcome);
      }
    }
    return merged;
  }

  return {
    mode: () => mode,
    setMode: (next: LlmMode) => {
      mode = next;
    },

    g1: (input, runOpts) => run(g1, input, runOpts, input.userId, replayG1, (i) => i.seed),
    g2: (input, runOpts) => run(g2, input, runOpts, input.userId, replayG2, (i) => i.seed),
    g4: (input, runOpts) => run(g4, input, runOpts, input.userId, replayG4, (i) => i.seed),
    g5: (input, runOpts) => run(g5, input, runOpts, input.userId, replayG5, (i) => i.seed),
    g7: (input, runOpts) => run(g7, input, runOpts, input.userId, replayG7, () => 0),
    // G8's context carries no userId (it runs before a post exists) -> champion variant.
    g8: (input, runOpts) => run(g8, input, runOpts, null, replayG8, () => 0),
    g9,
    // The premise screen runs before a world, a persona or a wallet exists -> null userId, and its
    // own variant id so `GenerationLog` splits it out from the five studio stages.
    g9Screen: (input, runOpts) =>
      run(g9Screen, input, runOpts, null, replayG9Screen, () => 0, {
        id: G9_SCREEN_VARIANT_ID,
        generator: "G9",
        tier: runOpts?.tier ?? g9Screen.defaultTier,
        maxTokens: g9Screen.maxTokens,
      }),
    g10: (input, runOpts) => run(g10, input, runOpts, input.userId, replayG10, (i) => i.seed),
    gj: (input, runOpts) => run(gj, input, runOpts, null, replayGJ, () => 0),

    batch,
    batchG1,
    batchG2,
    batchG4,
    batchG5,
    batchG7,
    batchG10,
    batchGJ,

    assignments: (userId: string) => assignmentsFor(userId),
    champion: () => championVariants(),
  };
}
