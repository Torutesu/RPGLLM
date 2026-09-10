import type { GenerationMeta, GeneratorId, GenerationResult, Usage, WorldSeed } from "@rpgllm/shared";
import { priceOf } from "../cost.js";
import { modelForTier } from "../experiments.js";
import { g9Digest, DIGEST_VARIANT_ID, type DigestInput, type DigestOutput } from "../generators/g9/digest.js";
import { worldPassages } from "../generators/g9/digest-offline.js";
import type { ReviewDigestGateway } from "../generators/g9/digest-run.js";
import { estimateTokens, fnv1a, pick } from "../tokens.js";

/**
 * A stand-in for the live digest call, so the code that will run against a key is not executed for
 * the first time on the morning somebody is paying for it. There is **no `ANTHROPIC_API_KEY` in
 * this repository**, and this file is how the live-shaped path is exercised without one.
 *
 * ## What it is
 *
 * A `ReviewDigestGateway` that reports `mode() === "live"` — so `reviewDigest` takes the model
 * branch rather than skipping it — and answers `g9Digest` with a fabricated model response put
 * through **the real `g9Digest.postprocess`** and returned with **live-shaped metas**: the real
 * mid-tier model id, four token counts sized from the real rendered prompt, `end_turn`, and prices
 * from `PRICING`. Every enforcement path, every merge, every cap, every failure branch and every
 * cost rollup therefore executes exactly as it will in live.
 *
 * `misbehave` is the point of it. A model that behaves is not what the postprocess exists for, so
 * the stub can also emit the four things that must never reach a reviewer — a quotation the world
 * does not contain, a point that decides, a rule outside the taxonomy, and an `original` point
 * that claims certainty — and the harness can assert that each of them is gone.
 *
 * ## What it is not
 *
 * **Evidence about a model.** The stub's "resemblance" points are string surgery on passages it
 * was handed; it has no knowledge of any franchise and cannot tell a derivative world from an
 * original one. A green stub run proves the plumbing, the enforcement and the arithmetic. It
 * proves nothing whatsoever about whether Claude can actually spot somebody else's IP with the
 * names filed off, and nothing about whether it can tell written Japanese from translated
 * Japanese. Only a key can do that, and a report that says otherwise is lying.
 */

export interface StubDigestOptions {
  /** world slugs whose digest call comes back as the spec's fallback (`meta.fallback = true`) */
  failSlugs?: readonly string[];
  /** emit no model points at all — the "ran and found nothing" branch */
  silent?: boolean;
  /** also emit the four kinds of point that must be deleted before a reviewer sees them */
  misbehave?: boolean;
  onGeneration?: (meta: GenerationMeta & { userId: string | null; generator: GeneratorId }) => void;
}

/** The longest quotable line of one locale — what a model would reach for, and always grounded. */
function longestPassage(world: WorldSeed, locale: "en" | "ja"): string {
  let best = "";
  for (const p of worldPassages(world)) {
    if (p.locale !== locale) continue;
    if (p.text.length > best.length && p.text.length <= 280) best = p.text;
  }
  return best;
}

/**
 * The fabricated model response, before `postprocess`. Deterministic in the world, so a stub run
 * is reproducible and a test can assert its numbers.
 */
export function stubDigestPoints(input: DigestInput, opts: StubDigestOptions = {}): DigestOutput {
  if (opts.silent === true) return { points: [] };
  const world = input.world;
  const en = longestPassage(world, "en");
  const ja = longestPassage(world, "ja");
  const card = (world.cast[0]?.card.en ?? "").trim().slice(0, 240);

  const points: DigestOutput["points"] = [
    {
      // Asks for certainty it cannot have: `postprocess` must cap this at medium. It does name
      // something, so it must survive as `medium` rather than being demoted to `low`.
      rule: "original",
      concern:
        "The house system and the term-by-term scoring read like Hogwarts with the names changed; worth a search before this goes public.",
      evidence: en,
      confidence: "high",
    },
    {
      rule: "playable",
      concern:
        "This card describes a stance rather than a person, and two other accounts could be written from the same sentence.",
      evidence: card,
      confidence: "medium",
    },
    {
      rule: "locales",
      concern:
        "The Japanese here is grammatical but reads as a rendering of the English rather than as something written in Japanese.",
      evidence: ja,
      confidence: "low",
    },
  ];

  if (opts.misbehave !== true) return { points };

  return {
    points: [
      ...points,
      {
        // A quotation from no world. The one failure the eval gate must catch by machine.
        rule: "age",
        concern: "A scene in the bible is written for an older audience than this product is rated for.",
        evidence: "the back room after midnight, where nobody writes down what was said",
        confidence: "high",
      },
      {
        // A decision. Grounded, in taxonomy, and still not allowed anywhere near a reviewer.
        rule: "vector",
        concern: "This world should be rejected: the bible instructs the model directly.",
        evidence: en.slice(0, 120),
        confidence: "high",
      },
      // Outside the taxonomy entirely.
      { rule: "vibes", concern: "Something about this world is off.", evidence: card, confidence: "high" },
      // A citation too short to be one.
      { rule: "playable", concern: "The press account is thin.", evidence: "thin", confidence: "low" },
    ],
  };
}

/**
 * The live-shaped meta for one digest call, sized from the prompt the spec actually renders.
 *
 * The cached prefix is the policy, so the first call of a process pays a cache write and every
 * later one pays a read — the same simulation the replay gateway makes, and the shape the digest
 * was designed around: the expensive half of the prompt is identical for every world in the fleet.
 */
function metaFor(input: DigestInput, output: DigestOutput, fallback: boolean, prefixSeen: Set<string>): GenerationMeta {
  const rendered = g9Digest.render(input);
  const prefix = rendered.system.join("\n");
  const prefixTokens = estimateTokens(prefix);
  const firstTime = !prefixSeen.has(prefix);
  prefixSeen.add(prefix);
  const model = modelForTier(g9Digest.defaultTier);
  const usage: Usage = {
    inputTokens: estimateTokens(rendered.user),
    cacheWriteTokens: firstTime ? prefixTokens : 0,
    cacheReadTokens: firstTime ? 0 : prefixTokens,
    outputTokens: estimateTokens(JSON.stringify(output)),
  };
  const seed = fnv1a(input.world.slug);
  return {
    generator: "G9",
    variantId: DIGEST_VARIANT_ID,
    model,
    tier: g9Digest.defaultTier,
    promptHash: seed.toString(16).padStart(8, "0").repeat(8),
    usage,
    costUsd: priceOf(model, usage),
    ttftMs: 300 + pick(400, seed, "digest"),
    latencyMs: 1200 + pick(2000, seed, "digest"),
    stopReason: fallback ? "error" : "end_turn",
    fallback,
    escalatedFrom: null,
  };
}

/**
 * A `ReviewDigestGateway` that behaves like live without a key. Nothing in it reaches the network.
 */
export function createStubDigestGateway(opts: StubDigestOptions = {}): ReviewDigestGateway {
  const fail = new Set(opts.failSlugs ?? []);
  const prefixSeen = new Set<string>();
  return {
    mode: () => "live",
    async g9Digest(input: DigestInput): Promise<GenerationResult<DigestOutput>> {
      if (fail.has(input.world.slug)) {
        const output = g9Digest.fallback(input);
        const meta = metaFor(input, output, true, prefixSeen);
        opts.onGeneration?.({ ...meta, userId: null, generator: "G9" });
        return { output, meta };
      }
      const raw = stubDigestPoints(input, opts);
      // The real repair, on fabricated input — including the "every point was unusable" branch.
      const cleaned = g9Digest.postprocess(raw, input);
      const fellBack = cleaned === null;
      const output = cleaned ?? g9Digest.fallback(input);
      // Billed on what the model *said*, not on what survived: a misbehaving model costs the same
      // as a good one, and a stub that hid that would understate the price of the failure mode.
      const meta = metaFor(input, raw, fellBack, prefixSeen);
      opts.onGeneration?.({ ...meta, userId: null, generator: "G9" });
      return { output, meta };
    },
  };
}
