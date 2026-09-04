/**
 * Structured request logging + request ids (Agent F).
 *
 * - honours an inbound `x-request-id`, otherwise generates one
 * - echoes it in the response header and injects it into every JSON error body
 * - one JSON line per request: method, path, status, duration, userId
 * - `authorization` headers and `?token=` values are redacted before anything is logged
 */
import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { requestLogEnabled } from "../env";
import type { AppEnv } from "../types";

export const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REDACTED = "[redacted]";

/** Query values that must never reach a log line. */
const SECRET_QUERY_KEYS = new Set(["token", "jwt", "code", "adtoken", "access_token"]);

export function redactPath(rawUrl: string): string {
  const qi = rawUrl.indexOf("?");
  if (qi < 0) return rawUrl;
  const path = rawUrl.slice(0, qi);
  const params = new URLSearchParams(rawUrl.slice(qi + 1));
  for (const key of [...params.keys()]) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, REDACTED);
  }
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Header snapshot for error diagnostics — `authorization`/`cookie` are never included verbatim. */
export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const k = key.toLowerCase();
    out[k] = k === "authorization" || k === "cookie" || k === "x-api-key" ? REDACTED : value;
  });
  return out;
}

export const logLine = (fields: Record<string, unknown>): void => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
};

export function logError(c: Context<AppEnv>, err: unknown): void {
  const requestId: string | undefined = c.get("requestId");
  const e = err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { name: "unknown", message: String(err) };
  console.error(JSON.stringify({
    ts: new Date().toISOString(), level: "error", msg: "http.error", requestId,
    method: c.req.method, path: redactPath(c.req.path), error: e,
  }));
}

/** Adds `requestId` to a JSON error envelope so a user-visible failure can be traced in the logs. */
async function withRequestId(res: Response, requestId: string): Promise<Response> {
  const type = res.headers.get("content-type") ?? "";
  if (res.status < 400 || !type.includes("application/json") || res.body === null) return res;
  let body: unknown;
  let text: string;
  try {
    text = await res.text();
    body = JSON.parse(text) as unknown;
  } catch {
    return res;
  }
  if (typeof body !== "object" || body === null || !("error" in body)) return new Response(text, res);
  const envelope = body as { error?: unknown };
  if (typeof envelope.error === "object" && envelope.error !== null) {
    (envelope.error as Record<string, unknown>)["requestId"] = requestId;
  }
  return new Response(JSON.stringify(envelope), res);
}

export const requestLog: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  c.set("requestId", requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  const started = Date.now();
  await next();
  if (c.res.status >= 400) c.res = await withRequestId(c.res, requestId);

  if (requestLogEnabled()) {
    const userId: string | undefined = c.get("userId");
    logLine({
      level: c.res.status >= 500 ? "error" : "info",
      msg: "http",
      requestId,
      method: c.req.method,
      path: redactPath(c.req.url.replace(/^https?:\/\/[^/]+/, "")),
      status: c.res.status,
      durationMs: Date.now() - started,
      userId: userId ?? null,
    });
  }
};
