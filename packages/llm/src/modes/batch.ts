import type { z } from "zod";
import type { Usage } from "@rpgllm/shared";
import { GeneratorFailure } from "../errors.js";
import { anthropicClient, buildRequest, extractJson, mapUsage, type BuildRequestArgs, type LiveRequest } from "./live.js";

/**
 * Batch tier (cost-architecture §5.4) — the Message Batches API.
 *
 * Everything here is either pure (`buildBatchBody`, `chunkRequests`, `sanitizeCustomId`) or the one
 * networked function `runLiveBatch`. As with `modes/live.ts` there is no API key in this sandbox,
 * so the unit tests assert on the request body and on a stubbed client, never on a round trip.
 *
 * Rules taken from the Batches API reference:
 *   - results come back in **any order** and must be keyed by `custom_id`, never by position;
 *   - a batch is finished when `processing_status === "ended"`, and each entry then carries its own
 *     `succeeded | errored | canceled | expired` result;
 *   - every token is billed at 50% — input, output, cache reads and cache writes alike;
 *   - the server-side `fallbacks` parameter is **rejected on the Batches API**, so batched requests
 *     never carry it (that is why `buildBatchBody` uses the plain `buildRequest` body).
 */

/** Max requests we put in one API batch. The API's own ceiling is 100,000 / 256 MB. */
export const BATCH_MAX_REQUESTS = 500;

export function batchMaxRequests(): number {
  const raw = process.env.LLM_BATCH_MAX_REQUESTS;
  if (raw === undefined || raw.trim() === "") return BATCH_MAX_REQUESTS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : BATCH_MAX_REQUESTS;
}

export function chunkRequests<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

/**
 * `custom_id` accepts `[A-Za-z0-9_-]{1,64}`. Callers key batches on their own ids (a post id, a
 * persona id, an eval case id), so anything else is rewritten and disambiguated with a hash — the
 * caller's original id is recovered from the map `buildBatchBody` returns, never from the position.
 */
export function sanitizeCustomId(customId: string, index: number): string {
  const cleaned = customId.replace(/[^A-Za-z0-9_-]/g, "-");
  const safe = cleaned.length === 0 ? `req-${index}` : cleaned;
  return safe.length <= 64 ? safe : `${safe.slice(0, 52)}-${hash11(customId)}`;
}

function hash11(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}

export interface BatchBuildItem {
  customId: string;
  args: BuildRequestArgs;
}

export interface BatchApiRequest {
  custom_id: string;
  params: LiveRequest;
}

export interface BuiltBatch {
  body: { requests: BatchApiRequest[] };
  /** sent custom_id -> the caller's original id */
  idMap: Map<string, string>;
}

/** Pure: the exact body `client.messages.batches.create` is called with. */
export function buildBatchBody(items: readonly BatchBuildItem[]): BuiltBatch {
  const requests: BatchApiRequest[] = [];
  const idMap = new Map<string, string>();
  const taken = new Set<string>();
  for (const [index, item] of items.entries()) {
    let sent = sanitizeCustomId(item.customId, index);
    let bump = 1;
    while (taken.has(sent)) {
      sent = `${sent.slice(0, 58)}-${bump}`;
      bump += 1;
    }
    taken.add(sent);
    idMap.set(sent, item.customId);
    requests.push({ custom_id: sent, params: buildRequest(item.args) });
  }
  return { body: { requests }, idMap };
}

/* ------------------------------------------------------------------- live ---- */

export type BatchEntryStatus = "succeeded" | "errored" | "canceled" | "expired";

export interface LiveBatchOutcome<T> {
  status: BatchEntryStatus;
  output: T | null;
  usage: Usage;
  stopReason: string;
  model: string;
  error: string | null;
}

interface RawBatch {
  id: string;
  processing_status?: string;
}

interface RawMessage {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  model?: string;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
    output_tokens?: number;
  };
}

interface RawBatchResult {
  custom_id: string;
  result:
    | { type: "succeeded"; message: RawMessage }
    | { type: "errored"; error?: { type?: string; message?: string } }
    | { type: "canceled" }
    | { type: "expired" };
}

interface BatchesApi {
  create(body: { requests: BatchApiRequest[] }): Promise<RawBatch>;
  retrieve(id: string): Promise<RawBatch>;
  results(id: string): Promise<AsyncIterable<RawBatchResult>>;
}

function batchesApi(): BatchesApi {
  const client = anthropicClient() as unknown as { messages: { batches: BatchesApi } };
  return client.messages.batches;
}

const EMPTY: Usage = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

function pollIntervalMs(): number {
  const raw = Number(process.env.LLM_BATCH_POLL_MS ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
}

function pollTimeoutMs(): number {
  const raw = Number(process.env.LLM_BATCH_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 24 * 3_600_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface RunLiveBatchArgs<T> {
  items: ReadonlyArray<{ customId: string; args: BuildRequestArgs & { schema: z.ZodType<T> } }>;
  now?: () => number;
}

/**
 * Submit one batch, poll until it ends, and return one outcome per **caller** id. Entries the API
 * never reports (a truncated result stream, a batch that timed out) come back as `expired` rather
 * than silently missing, so the caller can always resolve every id it asked about.
 */
export async function runLiveBatch<T>(args: RunLiveBatchArgs<T>): Promise<Map<string, LiveBatchOutcome<T>>> {
  const now = args.now ?? (() => Date.now());
  const built = buildBatchBody(args.items.map((i) => ({ customId: i.customId, args: i.args })));
  const schemaBySent = new Map<string, z.ZodType<T>>();
  for (const [sent, original] of built.idMap) {
    const item = args.items.find((i) => i.customId === original);
    if (item !== undefined) schemaBySent.set(sent, item.args.schema);
  }

  const out = new Map<string, LiveBatchOutcome<T>>();
  const miss = (status: BatchEntryStatus, error: string | null): LiveBatchOutcome<T> => ({
    status,
    output: null,
    usage: EMPTY,
    stopReason: status === "succeeded" ? "end_turn" : "error",
    model: "",
    error,
  });

  const api = batchesApi();
  let batch: RawBatch;
  try {
    batch = await api.create(built.body);
  } catch (cause) {
    for (const original of built.idMap.values()) out.set(original, miss("errored", `batch create failed: ${String(cause)}`));
    return out;
  }

  const deadline = now() + pollTimeoutMs();
  let ended = batch.processing_status === "ended";
  while (!ended) {
    if (now() >= deadline) {
      for (const original of built.idMap.values()) out.set(original, miss("expired", "batch did not end before the deadline"));
      return out;
    }
    await sleep(pollIntervalMs());
    try {
      const polled = await api.retrieve(batch.id);
      ended = polled.processing_status === "ended";
    } catch (cause) {
      for (const original of built.idMap.values()) out.set(original, miss("errored", `batch retrieve failed: ${String(cause)}`));
      return out;
    }
  }

  try {
    for await (const entry of await api.results(batch.id)) {
      // Results arrive in an arbitrary order: always resolve through the id map.
      const original = built.idMap.get(entry.custom_id);
      if (original === undefined) continue;
      out.set(original, resolveEntry(entry, schemaBySent.get(entry.custom_id)));
    }
  } catch (cause) {
    for (const original of built.idMap.values()) {
      if (!out.has(original)) out.set(original, miss("errored", `batch results failed: ${String(cause)}`));
    }
    return out;
  }

  for (const original of built.idMap.values()) {
    if (!out.has(original)) out.set(original, miss("expired", "no result returned for this custom_id"));
  }
  return out;
}

function resolveEntry<T>(entry: RawBatchResult, schema: z.ZodType<T> | undefined): LiveBatchOutcome<T> {
  if (entry.result.type !== "succeeded") {
    const error =
      entry.result.type === "errored"
        ? `${entry.result.error?.type ?? "error"}: ${entry.result.error?.message ?? ""}`.trim()
        : entry.result.type;
    return {
      status: entry.result.type,
      output: null,
      usage: EMPTY,
      stopReason: entry.result.type === "errored" ? "error" : entry.result.type,
      model: "",
      error,
    };
  }

  const message = entry.result.message;
  const usage = mapUsage(message.usage);
  const model = message.model ?? "";
  // Always check stop_reason before reading content.
  if (message.stop_reason === "refusal") {
    return { status: "succeeded", output: null, usage, stopReason: "refusal", model, error: "refusal" };
  }
  try {
    const raw = extractJson(message);
    const parsed: unknown = JSON.parse(raw);
    const check = schema === undefined ? { success: false as const } : schema.safeParse(parsed);
    if (!check.success) {
      return { status: "succeeded", output: null, usage, stopReason: "invalid_json", model, error: "output failed schema" };
    }
    return {
      status: "succeeded",
      output: check.data,
      usage,
      stopReason: message.stop_reason ?? "end_turn",
      model,
      error: null,
    };
  } catch (cause) {
    const kind = cause instanceof GeneratorFailure ? cause.kind : "invalid_json";
    return { status: "succeeded", output: null, usage, stopReason: kind, model, error: String(cause) };
  }
}
