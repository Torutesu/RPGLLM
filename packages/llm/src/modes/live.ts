import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { ModelTier, Usage } from "@rpgllm/shared";
import { GeneratorFailure } from "../errors.js";
import type { RenderedPrompt } from "../prompts/render.js";

/**
 * Live mode (LLM_MODE=live). There is no API key in this sandbox, so `buildRequest` is a pure
 * function and is what the unit tests assert on; `runLive` is the only part that touches the
 * network.
 *
 * Model/thinking policy (claude-api skill, cost-architecture 3.2):
 *   - high  = claude-opus-5   -> omit `thinking` (adaptive is the default on Opus 5),
 *                               `output_config.effort: "medium"`, refusal fallbacks on.
 *   - mid   = claude-sonnet-5 -> `thinking: {type:"disabled"}` (these are short generation
 *                               tasks, no reasoning needed), no effort parameter.
 *   - light = claude-haiku-4-5 -> no thinking, no effort. Its cache prefix minimum is 4,096
 *                               tokens, which is why the world bibles are sized the way they are.
 * We never prefill an assistant turn, and we always check `stop_reason` before reading content.
 */

export interface SystemBlock {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
}

export interface LiveRequest {
  model: string;
  max_tokens: number;
  /** system[0] = GLOBAL_STYLE (fleet-wide prefix), system[1] = world bible (per-world prefix) */
  system: SystemBlock[];
  messages: Array<{ role: "user"; content: string }>;
  thinking?: { type: "disabled" };
  output_config: { format: unknown; effort?: "medium" };
}

export interface BuildRequestArgs {
  model: string;
  tier: ModelTier;
  maxTokens: number;
  rendered: RenderedPrompt;
  schema: z.ZodType<unknown>;
}

export function buildRequest(args: BuildRequestArgs): LiveRequest {
  const { model, tier, maxTokens, rendered, schema } = args;
  const req: LiveRequest = {
    model,
    max_tokens: maxTokens,
    system: rendered.system.map((text) => ({
      type: "text" as const,
      text,
      cache_control: { type: "ephemeral" as const },
    })),
    messages: [{ role: "user", content: rendered.user }],
    output_config: { format: zodOutputFormat(schema as z.ZodType) },
  };
  if (tier === "mid") req.thinking = { type: "disabled" };
  if (tier === "high") req.output_config.effort = "medium";
  return req;
}

/** Server-side refusal fallbacks are on for the high tier unless LLM_REFUSAL_FALLBACKS=0. */
export function refusalFallbacksEnabled(tier: ModelTier): boolean {
  if (tier !== "high") return false;
  return (process.env.LLM_REFUSAL_FALLBACKS ?? "1") !== "0";
}

export const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface LiveResult<T> {
  output: T;
  usage: Usage;
  stopReason: string;
  model: string;
  ttftMs: number | null;
}

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (cachedClient === null) cachedClient = new Anthropic();
  return cachedClient;
}

/** The same (injectable) client the batch path uses — one place constructs `new Anthropic()`. */
export function anthropicClient(): Anthropic {
  return client();
}

/** Test seam: inject a stub client (the real one throws without ANTHROPIC_API_KEY). */
export function __setClient(c: Anthropic | null): void {
  cachedClient = c;
}

interface RawUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number;
}

export function mapUsage(usage: RawUsage | undefined): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
}

interface RawResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  model?: string;
  usage?: RawUsage;
}

export function extractJson(res: RawResponse): string {
  const text = (res.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text ?? "")
    .join("");
  if (text.trim().length === 0) {
    throw new GeneratorFailure("invalid_json", "model returned no text content");
  }
  return text;
}

export async function runLive<T>(
  args: BuildRequestArgs & { schema: z.ZodType<T> },
): Promise<LiveResult<T>> {
  const req = buildRequest(args);

  let res: RawResponse;
  try {
    if (refusalFallbacksEnabled(args.tier)) {
      res = (await client().beta.messages.create({
        ...(req as unknown as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming),
        betas: [REFUSAL_FALLBACK_BETA],
        fallbacks: "default",
      })) as unknown as RawResponse;
    } else {
      res = (await client().messages.create(
        req as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      )) as unknown as RawResponse;
    }
  } catch (cause) {
    throw new GeneratorFailure("error", `anthropic request failed: ${String(cause)}`, { cause });
  }

  // Always check stop_reason before reading content.
  if (res.stop_reason === "refusal") {
    throw new GeneratorFailure("refusal", "model refused the request");
  }

  const raw = extractJson(res);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new GeneratorFailure("invalid_json", "model output was not valid JSON", { cause });
  }
  const check = args.schema.safeParse(parsed);
  if (!check.success) {
    throw new GeneratorFailure("invalid_json", `output failed schema: ${check.error.message}`);
  }

  return {
    output: check.data,
    usage: mapUsage(res.usage),
    stopReason: res.stop_reason ?? "end_turn",
    model: res.model ?? args.model,
    // Non-streaming call: there is no separate first-token timestamp to report.
    ttftMs: null,
  };
}
