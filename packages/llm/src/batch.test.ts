import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BATCH_DISCOUNT, G1OutputZ, type G1Input } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { buildBatchBody, chunkRequests, runLiveBatch, sanitizeCustomId } from "./modes/batch.js";
import { __setClient } from "./modes/live.js";
import { baseStopReason, isBatchStopReason } from "./cost.js";
import { g1 } from "./generators/g1.js";
import { g5 } from "./generators/g5.js";
import { modelForTier } from "./experiments.js";
import { g1Input, g5Input, g7Input } from "./__testkit.js";

/**
 * The Batch tier (cost-architecture §5.4). Live behaviour is exercised through a stub client —
 * there is no API key here — and the two invariants that matter are asserted head-on: results are
 * keyed by `custom_id` (never by position) and every token is billed at half.
 */

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
  delete process.env.LLM_MODE;
  delete process.env.LLM_BATCH_MAX_REQUESTS;
  process.env.LLM_BATCH_POLL_MS = "0";
});
afterEach(() => {
  process.env = { ...savedEnv };
  __setClient(null);
});

describe("batch — replay mode", () => {
  it("returns exactly one result per customId, keyed by the caller's own id", async () => {
    const gw = createGateway();
    const items = [1, 2, 3].map((n) => ({ customId: `case-${n}`, input: g1Input("popstar-era", "en", n) }));
    const results = await gw.batchG1(items);

    expect(results.size).toBe(3);
    for (const item of items) {
      const got = results.get(item.customId);
      expect(got?.customId).toBe(item.customId);
      expect(() => G1OutputZ.parse(got?.output)).not.toThrow();
      expect(got?.meta.generator).toBe("G1");
    }
  });

  it("resolves every entry even when one of them fails (partial failure)", async () => {
    const gw = createGateway();
    // An empty cast leaves G1 with no legal handle to speak: the entry falls back rather than
    // disappearing from the batch.
    const broken: G1Input = { ...g1Input("popstar-era", "en", 9), cast: [], involved: [] };
    const results = await gw.batchG1([
      { customId: "ok", input: g1Input("popstar-era", "en", 1) },
      { customId: "broken", input: broken },
    ]);

    expect([...results.keys()].sort()).toEqual(["broken", "ok"]);
    expect(results.get("ok")?.meta.fallback).toBe(false);
    expect(results.get("broken")?.meta.fallback).toBe(true);
    expect(results.get("broken")?.output.replies.length).toBeGreaterThan(0);
    expect(baseStopReason(results.get("broken")?.meta.stopReason ?? "")).toBe("error");
  });

  it("prices batched usage at half and marks it in the stop reason", async () => {
    const gw = createGateway();
    const input = g1Input("popstar-era", "en", 42);
    // warm the prefix so both calls below bill a cache *read* and the usage is identical
    await gw.g1(input);

    const interactive = await gw.g1(input);
    const batched = (await gw.batchG1([{ customId: "x", input }])).get("x");

    expect(batched?.meta.usage).toEqual(interactive.meta.usage);
    expect(batched?.meta.costUsd).toBeCloseTo(interactive.meta.costUsd * BATCH_DISCOUNT, 12);
    expect(isBatchStopReason(batched?.meta.stopReason ?? "")).toBe(true);
    expect(baseStopReason(batched?.meta.stopReason ?? "")).toBe("replay");
    // a batch has no time-to-first-token
    expect(batched?.meta.ttftMs).toBeNull();
  });

  it("batches the §5.4 generators too (G7 memory consolidation)", async () => {
    const gw = createGateway();
    const results = await gw.batchG7([
      { customId: "p1", input: g7Input("popstar-era", "en") },
      { customId: "p2", input: g7Input("magic-academy", "ja") },
    ]);
    expect(results.size).toBe(2);
    expect(results.get("p1")?.meta.generator).toBe("G7");
    expect(isBatchStopReason(results.get("p2")?.meta.stopReason ?? "")).toBe(true);
  });

  it("groups a mixed-generator batch and merges the results", async () => {
    const gw = createGateway();
    const merged = await gw.batch([
      { generator: "G1", customId: "a", input: g1Input("popstar-era", "en", 1) },
      { generator: "G5", customId: "b", input: g5Input("popstar-era", "en", 2) },
    ]);
    expect(merged.get("a")?.generator).toBe("G1");
    expect(merged.get("b")?.generator).toBe("G5");
  });

  it("fail mode returns the per-generator fallback for every entry", async () => {
    const gw = createGateway({ mode: "fail" });
    const results = await gw.batchG1([
      { customId: "a", input: g1Input("popstar-era", "en", 1) },
      { customId: "b", input: g1Input("popstar-era", "ja", 2) },
    ]);
    expect(results.size).toBe(2);
    for (const entry of results.values()) {
      expect(entry.meta.fallback).toBe(true);
      expect(entry.status).toBe("errored");
      expect(entry.meta.stopReason).toBe("batch:error");
      expect(entry.output.replies.length).toBeGreaterThan(0);
    }
  });
});

describe("batch — live request shape (no network)", () => {
  it("builds one request per item with a valid, unique custom_id and no `fallbacks`", () => {
    const rendered = g1.render(g1Input("popstar-era", "en", 1));
    const args = { model: modelForTier("mid"), tier: "mid" as const, maxTokens: 1200, rendered, schema: G1OutputZ };
    const built = buildBatchBody([
      { customId: "post/abc#1", args },
      { customId: "post/abc#1", args },
      { customId: "plain-id", args },
    ]);

    expect(built.body.requests).toHaveLength(3);
    const ids = built.body.requests.map((r) => r.custom_id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // the caller's original id is always recoverable from the map, never from the position
    expect(built.idMap.get(ids[0] ?? "")).toBe("post/abc#1");
    expect(built.idMap.get(ids[2] ?? "")).toBe("plain-id");

    for (const req of built.body.requests) {
      expect(req.params.system).toHaveLength(2);
      expect(req.params.messages[0]?.role).toBe("user");
      expect(req.params.thinking).toEqual({ type: "disabled" });
      expect(req.params.output_config.format).toBeDefined();
      // the Batches API rejects the server-side refusal-fallback parameter
      expect(Object.keys(req.params)).not.toContain("fallbacks");
      expect(Object.keys(req.params)).not.toContain("betas");
    }
  });

  it("keeps the high tier's effort setting inside the batched params", () => {
    const rendered = g5.render(g5Input("popstar-era", "en", 1));
    const built = buildBatchBody([
      { customId: "e", args: { model: modelForTier("high"), tier: "high", maxTokens: 2000, rendered, schema: G1OutputZ } },
    ]);
    expect(built.body.requests[0]?.params.output_config.effort).toBe("medium");
    expect(built.body.requests[0]?.params.thinking).toBeUndefined();
  });

  it("sanitizes and caps custom ids", () => {
    expect(sanitizeCustomId("abc", 0)).toBe("abc");
    expect(sanitizeCustomId("a/b c", 0)).toBe("a-b-c");
    expect(sanitizeCustomId("", 4)).toBe("req-4");
    expect(sanitizeCustomId("x".repeat(200), 0).length).toBeLessThanOrEqual(64);
  });

  it("chunks beyond the cap", () => {
    expect(chunkRequests([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

/* --------------------------------------------------------- stubbed client ---- */

interface StubResult {
  custom_id: string;
  result: { type: "succeeded"; message: unknown } | { type: "errored"; error: { type: string; message: string } } | { type: "expired" };
}

function stubClient(results: StubResult[], opts: { statuses?: string[] } = {}) {
  const created: Array<{ requests: Array<{ custom_id: string }> }> = [];
  let poll = 0;
  const statuses = opts.statuses ?? ["ended"];
  return {
    created,
    client: {
      messages: {
        batches: {
          create: async (body: { requests: Array<{ custom_id: string }> }) => {
            created.push(body);
            return { id: `batch_${created.length}`, processing_status: "in_progress" };
          },
          retrieve: async () => ({ id: "batch_1", processing_status: statuses[Math.min(poll++, statuses.length - 1)] }),
          results: async () => ({
            async *[Symbol.asyncIterator]() {
              for (const r of results) yield r;
            },
          }),
        },
      },
    },
  };
}

const okMessage = (text: string) => ({
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  model: "claude-haiku-4-5",
  usage: { input_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 4096, output_tokens: 50 },
});

describe("batch — live results are matched by custom_id, never by position", () => {
  it("matches out-of-order results and prices them at the batch discount", async () => {
    const inputs = [1, 2, 3].map((n) => ({ customId: `c${n}`, input: g1Input("popstar-era", "en", n) }));
    const bodies = inputs.map((i) => JSON.stringify({ ...replayLike(i.input), narrative: `n${i.customId}` }));

    // Deliberately reversed, and with one entry that errored.
    const stub = stubClient([
      { custom_id: "c3", result: { type: "succeeded", message: okMessage(bodies[2] ?? "") } },
      { custom_id: "c1", result: { type: "succeeded", message: okMessage(bodies[0] ?? "") } },
      { custom_id: "c2", result: { type: "errored", error: { type: "api_error", message: "boom" } } },
    ]);
    __setClient(stub.client as never);

    const gw = createGateway({ mode: "live" });
    const results = await gw.batchG1(inputs);

    expect(results.size).toBe(3);
    expect(results.get("c1")?.output.narrative).toBe("nc1");
    expect(results.get("c3")?.output.narrative).toBe("nc3");
    expect(results.get("c1")?.status).toBe("succeeded");
    expect(results.get("c2")?.status).toBe("errored");
    expect(results.get("c2")?.meta.fallback).toBe(true);

    // usage came from the stub; the discount is applied on top of it
    const c1 = results.get("c1");
    expect(c1?.meta.usage).toEqual({ inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 4096, outputTokens: 50 });
    expect(c1?.meta.costUsd).toBeGreaterThan(0);
    expect(c1?.meta.stopReason).toBe("batch:end_turn");
  });

  it("polls until processing_status is ended", async () => {
    const stub = stubClient(
      [{ custom_id: "only", result: { type: "succeeded", message: okMessage(JSON.stringify(replayLike(g1Input("popstar-era", "en", 1)))) } }],
      { statuses: ["in_progress", "in_progress", "ended"] },
    );
    __setClient(stub.client as never);
    const gw = createGateway({ mode: "live" });
    const results = await gw.batchG1([{ customId: "only", input: g1Input("popstar-era", "en", 1) }]);
    expect(results.get("only")?.status).toBe("succeeded");
  });

  it("splits the work into several API batches beyond the cap", async () => {
    process.env.LLM_BATCH_MAX_REQUESTS = "2";
    const stub = stubClient([]);
    __setClient(stub.client as never);
    const gw = createGateway({ mode: "live" });
    const items = [1, 2, 3, 4, 5].map((n) => ({ customId: `k${n}`, input: g1Input("popstar-era", "en", n) }));
    const results = await gw.batchG1(items);
    expect(stub.created).toHaveLength(3);
    // no entry was reported by the stub: every one still resolves, as an expired fallback
    expect(results.size).toBe(5);
    for (const r of results.values()) expect(r.status).toBe("expired");
  });

  it("resolves every entry when the batch never ends", async () => {
    process.env.LLM_BATCH_TIMEOUT_MS = "1";
    const stub = stubClient([], { statuses: ["in_progress"] });
    __setClient(stub.client as never);
    const outcomes = await runLiveBatch({
      items: [
        {
          customId: "t",
          args: { model: "claude-haiku-4-5", tier: "light", maxTokens: 100, rendered: g1.render(g1Input("popstar-era", "en", 1)), schema: G1OutputZ },
        },
      ],
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })(),
    });
    expect(outcomes.get("t")?.status).toBe("expired");
  });
});

/** A minimal, schema-valid G1 output for a given input (what a live model would have returned). */
function replayLike(input: G1Input) {
  const handles = input.cast.filter((c) => !c.isPressAccount).map((c) => c.handle);
  return {
    replies: handles.slice(0, input.k).map((h, i) => ({ characterHandle: h, text: `line ${i}` })),
    stat_deltas: { followers: 1, aura: 1, humor: 0 },
    narrative: "n",
    relationship_deltas: {},
    memory_notes: [],
    news: null,
    safety_flag: false,
  };
}
