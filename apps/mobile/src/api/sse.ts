import { fetch as expoFetch } from "expo/fetch";
import { PostStreamEventZ, DMStreamEventZ, type PostStreamEvent, type DMStreamEvent } from "@rpgllm/shared";
import { API_BASE, API_ORIGIN, IS_WEB, g } from "../env";
import { getToken } from "../auth/token";

export type StreamKind = "post" | "dm";
export type StreamEvent = PostStreamEvent | DMStreamEvent;

/** `streamUrl` may be absolute, `/v1/...` or `/posts/...`. */
export function resolveStreamUrl(streamUrl: string): string {
  if (streamUrl.startsWith("http")) return streamUrl;
  if (streamUrl.startsWith("/v1/")) return `${API_ORIGIN}${streamUrl}`;
  return `${API_BASE}${streamUrl.startsWith("/") ? streamUrl : `/${streamUrl}`}`;
}

const POST_NAMES = ["reply", "news", "stat", "event", "fallback", "done"] as const;
const DM_NAMES = ["message", "affinity", "fallback", "done"] as const;

/** Named SSE frames carry the discriminator in `event:`; unnamed ones carry it in the payload. */
function withType(kind: StreamKind, name: string, raw: unknown): unknown {
  if (raw && typeof raw === "object" && "type" in (raw as Record<string, unknown>)) return raw;
  const o = (raw ?? {}) as Record<string, unknown>;
  const known = (kind === "post" ? POST_NAMES : DM_NAMES) as readonly string[];
  if (known.includes(name)) return { type: name, ...o };
  // Unnamed frame: infer from the payload shape.
  if (typeof o.energy === "number") return { type: "done", ...o };
  if (typeof o.message === "string") return { type: "fallback", ...o };
  if (kind === "dm") {
    if (o.message && typeof o.message === "object") return { type: "message", ...o };
    if (typeof o.delta === "number") return { type: "affinity", ...o };
  } else {
    if (o.snapshot) return { type: "stat", ...o };
    if (o.event) return { type: "event", ...o };
    if (o.post) return { type: "reply", ...o };
  }
  return o;
}

export function parseStreamEvent(kind: StreamKind, name: string, data: string): StreamEvent | null {
  if (!data || data === "[DONE]") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const shaped = withType(kind, name, raw);
  const schema = kind === "post" ? PostStreamEventZ : DMStreamEventZ;
  const parsed = schema.safeParse(shaped);
  if (!parsed.success) {
    if (typeof console !== "undefined") console.warn(`[sse] dropped ${kind}/${name} frame: ${parsed.error.message}`);
    return null;
  }
  g.__sseFrames = (g.__sseFrames ?? 0) + 1;
  return parsed.data as StreamEvent;
}

export type Subscription = { close: () => void };

/**
 * Subscribe to a server-sent event stream.
 * Web: `EventSource` (no custom headers → the JWT rides on `?token=`).
 * Native: streaming body via `expo/fetch` with a bearer header.
 */
export function subscribe(
  streamUrl: string,
  kind: StreamKind,
  onEvent: (e: StreamEvent) => void,
  onClose?: (error?: unknown) => void,
): Subscription {
  const token = getToken();
  let closed = false;
  const url = resolveStreamUrl(streamUrl);

  const emit = (e: StreamEvent | null) => {
    if (closed || !e) return;
    onEvent(e);
    if (e.type === "done") finish();
  };

  let cleanup = () => {};
  const finish = (error?: unknown) => {
    if (closed) return;
    closed = true;
    cleanup();
    onClose?.(error);
  };

  if (IS_WEB && typeof EventSource !== "undefined") {
    const withToken = token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;
    const es = new EventSource(withToken);
    const names = kind === "post" ? POST_NAMES : DM_NAMES;
    const listeners: Array<[string, EventListener]> = [];
    for (const name of names) {
      if (name === "message") continue; // delivered through onmessage
      const fn = ((ev: MessageEvent) => emit(parseStreamEvent(kind, name, ev.data))) as EventListener;
      es.addEventListener(name, fn);
      listeners.push([name, fn]);
    }
    es.onmessage = (ev: MessageEvent) => emit(parseStreamEvent(kind, "message", ev.data));
    es.onerror = () => {
      // EventSource errors on normal server close too; treat as end-of-stream.
      finish();
    };
    cleanup = () => {
      for (const [name, fn] of listeners) es.removeEventListener(name, fn);
      es.close();
    };
    return { close: () => finish() };
  }

  const controller = new AbortController();
  cleanup = () => controller.abort();
  void (async () => {
    try {
      const res = await expoFetch(url, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      const body = res.body;
      if (!body) {
        finish(new Error("no stream body"));
        return;
      }
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let name = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) name = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length) emit(parseStreamEvent(kind, name, dataLines.join("\n")));
          if (closed) return;
          idx = buffer.indexOf("\n\n");
        }
      }
      finish();
    } catch (e) {
      finish(e);
    }
  })();

  return { close: () => finish() };
}
