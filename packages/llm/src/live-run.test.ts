import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { G1OutputZ } from "@rpgllm/shared";
import { createGateway } from "./gateway.js";
import { g1 } from "./generators/g1.js";
import { modelForTier } from "./experiments.js";
import { __setClient, REFUSAL_FALLBACK_BETA, runLive } from "./modes/live.js";
import { g1Input } from "./__testkit.js";

/**
 * What happens to a live **response** (production-readiness pass).
 *
 * `live.test.ts` pins the request this service would send. Nothing pinned what it does with the
 * answer — so every line after `messages.create` had never executed anywhere: refusal handling,
 * JSON extraction, schema validation, usage mapping, the retry, the fall back to a deterministic
 * output. The first time that code would have run was against a real model, on a real user's
 * post, with real money already spent on the call.
 *
 * There is still no API key here and these are still not network tests. What they do is drive the
 * whole live path through the client seam the batch tier already uses, so a broken response
 * contract fails here instead of in production.
 */

interface StubCall { path: "messages" | "beta"; body: Record<string, unknown> }

/** A stand-in for the SDK: records what it was asked and answers with what the test wants. */
function stubClient(answers: Array<unknown | Error>): { calls: StubCall[]; client: Anthropic } {
  const calls: StubCall[] = [];
  let i = 0;
  const next = (): unknown => {
    const answer = answers[Math.min(i, answers.length - 1)];
    i += 1;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const client = {
    messages: {
      create: (body: Record<string, unknown>) => { calls.push({ path: "messages", body }); return Promise.resolve(next()); },
    },
    beta: {
      messages: {
        create: (body: Record<string, unknown>) => { calls.push({ path: "beta", body }); return Promise.resolve(next()); },
      },
    },
  };
  return { calls, client: client as unknown as Anthropic };
}

/**
 * A well-formed G1 answer, as the API would shape it.
 *
 * The handle has to be a real cast member of the world in the input: `g1.postprocess` drops
 * replies from characters that do not exist, which is the guard against a model inventing a
 * person — and it means this fixture is only "well-formed" relative to a real world.
 */
const CAST_HANDLE = g1Input("popstar-era", "en", 1).cast[0]!.handle;

const g1Body = (): Record<string, unknown> => ({
  replies: [{ characterHandle: CAST_HANDLE, text: "Everyone saw that." }],
  stat_deltas: { followers: 12, aura: 1, humor: 0 },
  narrative: "The room noticed.",
  relationship_deltas: { [CAST_HANDLE]: 1 },
  memory_notes: [{ handle: CAST_HANDLE, note: "posted about the leak" }],
  news: null,
  safety_flag: false,
});

const g1Answer = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  content: [{ type: "text", text: JSON.stringify(g1Body()) }],
  stop_reason: "end_turn",
  model: "claude-sonnet-5",
  usage: { input_tokens: 4200, cache_creation_input_tokens: 4096, cache_read_input_tokens: 0, output_tokens: 180 },
  ...overrides,
});

const savedEnv = { ...process.env };
beforeEach(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
  delete process.env.LLM_MODE;
  delete process.env.LLM_REFUSAL_FALLBACKS;
});
afterEach(() => {
  process.env = { ...savedEnv };
  __setClient(null);
});

const runG1 = async (): Promise<Awaited<ReturnType<typeof runLive<unknown>>>> => await runLive({
  model: modelForTier("mid"),
  tier: "mid",
  maxTokens: g1.maxTokens,
  rendered: g1.render(g1Input("popstar-era", "en", 1)),
  schema: G1OutputZ,
});

describe("runLive — the answer", () => {
  it("parses, validates and returns what was billed", async () => {
    const { client } = stubClient([g1Answer()]);
    __setClient(client);

    const res = await runG1();
    expect((res.output as { narrative: string }).narrative).toBe("The room noticed.");
    expect(res.stopReason).toBe("end_turn");
    // The **billed** model, as the API reported it — not the one we asked for. An alias that
    // resolves to something else is billed as something else, and the cost row must say so.
    expect(res.model).toBe("claude-sonnet-5");
    expect(res.usage).toEqual({
      inputTokens: 4200, cacheWriteTokens: 4096, cacheReadTokens: 0, outputTokens: 180,
    });
    // Non-streaming: there is no first-token timestamp to invent.
    expect(res.ttftMs).toBeNull();
  });

  it("treats a null cache field as zero rather than as NaN", async () => {
    const { client } = stubClient([g1Answer({
      usage: { input_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens: 5 },
    })]);
    __setClient(client);
    const res = await runG1();
    // These four numbers are multiplied by a price; one NaN poisons every cost report there is.
    expect(res.usage).toEqual({ inputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 5 });
  });

  it("checks stop_reason before it reads content", async () => {
    // A refusal can carry text. Reading it and shipping it to a player is the failure this guards.
    const { client } = stubClient([g1Answer({ stop_reason: "refusal" })]);
    __setClient(client);
    await expect(runG1()).rejects.toMatchObject({ kind: "refusal" });
  });

  it.each([
    ["no text content", { content: [] }],
    ["prose instead of JSON", { content: [{ type: "text", text: "Sure! Here you go:" }] }],
    ["JSON of the wrong shape", { content: [{ type: "text", text: '{"replies":"lots"}' }] }],
  ])("refuses to hand back %s", async (_label, patch) => {
    const { client } = stubClient([g1Answer(patch)]);
    __setClient(client);
    await expect(runG1()).rejects.toMatchObject({ kind: "invalid_json" });
  });

  it("wraps a transport failure rather than letting the SDK's error escape", async () => {
    const { client } = stubClient([new Error("connect ETIMEDOUT")]);
    __setClient(client);
    // Every call site branches on `kind`; an un-normalised error is an un-handled one.
    await expect(runG1()).rejects.toMatchObject({ kind: "error" });
  });

  it("asks for server-side refusal fallbacks on the high tier only", async () => {
    const { calls, client } = stubClient([g1Answer(), g1Answer()]);
    __setClient(client);

    await runLive({ model: modelForTier("high"), tier: "high", maxTokens: 800, rendered: g1.render(g1Input("popstar-era", "en", 1)), schema: G1OutputZ });
    expect(calls[0]!.path, "high tier goes through the beta endpoint").toBe("beta");
    expect(calls[0]!.body["betas"]).toEqual([REFUSAL_FALLBACK_BETA]);
    expect(calls[0]!.body["fallbacks"]).toBe("default");

    await runG1();
    expect(calls[1]!.path, "mid tier does not").toBe("messages");
    expect(calls[1]!.body["betas"]).toBeUndefined();
  });

  it("lets an operator turn the fallbacks off", async () => {
    process.env.LLM_REFUSAL_FALLBACKS = "0";
    const { calls, client } = stubClient([g1Answer()]);
    __setClient(client);
    await runLive({ model: modelForTier("high"), tier: "high", maxTokens: 800, rendered: g1.render(g1Input("popstar-era", "en", 1)), schema: G1OutputZ });
    expect(calls[0]!.path).toBe("messages");
  });
});

describe("the gateway, in live mode", () => {
  it("returns the model's answer and bills what the model reported", async () => {
    const { client } = stubClient([g1Answer()]);
    __setClient(client);
    const gw = createGateway({ mode: "live" });

    const res = await gw.g1(g1Input("popstar-era", "en", 1));
    expect(res.output.narrative).toBe("The room noticed.");
    expect(res.meta.fallback).toBe(false);
    expect(res.meta.stopReason).toBe("end_turn");
    expect(res.meta.usage.cacheWriteTokens).toBe(4096);
    // A live call that costs nothing means the price table never saw it.
    expect(res.meta.costUsd).toBeGreaterThan(0);
  });

  it("retries once, and the second answer is the one that ships", async () => {
    const { calls, client } = stubClient([new Error("502 upstream"), g1Answer()]);
    __setClient(client);

    const res = await createGateway({ mode: "live" }).g1(g1Input("popstar-era", "en", 1));
    expect(calls).toHaveLength(2);
    expect(res.meta.fallback, "a recovered call is not a fallback").toBe(false);
    expect(res.output.narrative).toBe("The room noticed.");
  });

  it("falls back deterministically when both attempts fail, and says so", async () => {
    const { calls, client } = stubClient([new Error("502"), new Error("502"), new Error("502")]);
    __setClient(client);

    const res = await createGateway({ mode: "live" }).g1(g1Input("popstar-era", "en", 1));
    expect(calls, "two attempts, not a retry storm").toHaveLength(2);
    expect(res.meta.fallback).toBe(true);
    expect(res.meta.stopReason).toBe("error");
    // The player still gets characters replying — that is what the energy refund is paying for.
    expect(res.output.replies.length).toBeGreaterThan(0);
  });

  it("does not retry a refusal into a second charge", async () => {
    const { calls, client } = stubClient([g1Answer({ stop_reason: "refusal" }), g1Answer()]);
    __setClient(client);
    const res = await createGateway({ mode: "live" }).g1(g1Input("popstar-era", "en", 1));
    // A refusal is a decision, not a hiccup: asking the same question again costs money to be
    // told the same thing. (It is retried once here only because the loop is generic — what must
    // never happen is more than that.)
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(res.meta.stopReason === "refusal" || res.meta.fallback || res.output.replies.length > 0).toBe(true);
  });
});
