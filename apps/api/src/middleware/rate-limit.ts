/**
 * In-process token-bucket rate limiting (Agent F, S0-4). No new dependency.
 *
 * Budgets (per minute, all overridable by env):
 *   auth start/verify   5   — per IP *and* per email
 *   post / DM writes    20  — per user (each one costs an LLM call)
 *   ad reward           10  — per user (each one mints energy)
 *   everything else     120 — per user, or per IP when unauthenticated
 *
 * `/__test/*` is exempt, and the whole limiter is off while `TEST_HOOKS=1` so the vitest and
 * Playwright suites never flake on it (`RATE_LIMIT_ENABLED=0|1` overrides either way).
 *
 * TODO(P1): a single process only. Behind more than one instance this becomes N× the budget;
 * move the buckets to Redis (or an edge limiter) when the API is scaled out.
 */
import type { Context, MiddlewareHandler } from "hono";
import { verifySession } from "../auth";
import {
  rateLimitAdPerMin, rateLimitAuthPerMin, rateLimitDefaultPerMin, rateLimitEnabled, rateLimitWritePerMin,
} from "../env";
import type { AppEnv } from "../types";

export interface Bucket { tokens: number; last: number }
export type RateLimitStore = Map<string, Bucket>;

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 20_000;

export interface Decision { allowed: boolean; retryAfterSec: number; remaining: number }

/** Classic token bucket: capacity `perMin`, refilled continuously at `perMin` per minute. */
export function take(store: RateLimitStore, key: string, perMin: number, nowMs: number): Decision {
  if (perMin <= 0) return { allowed: false, retryAfterSec: 60, remaining: 0 };
  const bucket = store.get(key) ?? { tokens: perMin, last: nowMs };
  const refill = ((nowMs - bucket.last) / WINDOW_MS) * perMin;
  bucket.tokens = Math.min(perMin, bucket.tokens + refill);
  bucket.last = nowMs;

  if (bucket.tokens < 1) {
    store.set(key, bucket);
    const msToOne = ((1 - bucket.tokens) * WINDOW_MS) / perMin;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(msToOne / 1000)), remaining: 0 };
  }
  bucket.tokens -= 1;
  store.set(key, bucket);
  if (store.size > MAX_TRACKED_KEYS) prune(store, perMin, nowMs);
  return { allowed: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
}

/** Drop buckets that have refilled to capacity — they are indistinguishable from a fresh one. */
function prune(store: RateLimitStore, perMin: number, nowMs: number): void {
  for (const [key, b] of store) {
    if (b.tokens + ((nowMs - b.last) / WINDOW_MS) * perMin >= perMin) store.delete(key);
  }
}

/**
 * 429 body. NOTE: `RATE_LIMITED` is not yet in `ErrorCodeZ` (`packages/shared` is owned by the
 * orchestrator — see build-notes "Agent F: required shared change"), so this response is built
 * by hand instead of going through `http.ts#fail`, whose `code` argument is typed `ErrorCode`.
 */
export const RATE_LIMITED_CODE = "RATE_LIMITED";

export function rateLimitedResponse(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ data: null, error: { code: RATE_LIMITED_CODE, message: "Too many requests. Please slow down." } }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfterSec),
      },
    },
  );
}

/* ------------------------------------------------------------------ keys ---- */

function socketAddress(env: unknown): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const incoming = (env as Record<string, unknown>)["incoming"];
  if (typeof incoming !== "object" || incoming === null) return undefined;
  const socket = (incoming as Record<string, unknown>)["socket"];
  if (typeof socket !== "object" || socket === null) return undefined;
  const addr = (socket as Record<string, unknown>)["remoteAddress"];
  return typeof addr === "string" ? addr : undefined;
}

export function clientIp(c: Context<AppEnv>): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd !== undefined && fwd !== "") return (fwd.split(",")[0] ?? "").trim() || "unknown";
  const real = c.req.header("x-real-ip");
  if (real !== undefined && real !== "") return real.trim();
  return socketAddress(c.env) ?? "unknown";
}

export type BudgetKind = "auth" | "write" | "ad" | "default" | "exempt";

/** Route → budget. Paths arrive both as `/v1/...` and (health/test hooks) unversioned. */
export function budgetFor(method: string, path: string): BudgetKind {
  const p = path.replace(/^\/v1/, "");
  if (p.startsWith("/__test")) return "exempt";
  if (p === "/health" || p === "/health/") return "exempt";
  if (method === "OPTIONS") return "exempt";

  if (p.startsWith("/auth/")) {
    if (p === "/auth/age-gate") return "default";
    return method === "POST" ? "auth" : "default";
  }
  if (method === "POST") {
    if (p === "/wallet/ad-reward") return "ad";
    if (p === "/posts" || /^\/posts\/[^/]+\/more-replies$/.test(p)) return "write";
    if (p === "/dms" || /^\/dms\/[^/]+\/messages$/.test(p)) return "write";
    if (/^\/generations\/[^/]+\/rate$/.test(p)) return "write";
  }
  return "default";
}

export const perMinFor = (kind: Exclude<BudgetKind, "exempt">): number =>
  kind === "auth" ? rateLimitAuthPerMin()
    : kind === "write" ? rateLimitWritePerMin()
      : kind === "ad" ? rateLimitAdPerMin()
        : rateLimitDefaultPerMin();

/** Best-effort email extraction for the per-address auth budget. Hono caches the parsed body. */
async function emailOf(c: Context<AppEnv>): Promise<string | null> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body !== "object" || body === null) return null;
    const email = (body as Record<string, unknown>)["email"];
    return typeof email === "string" && email.length <= 320 ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The limiter runs BEFORE `requireAuth` (an unauthenticated flood must be cheap to reject), so
 * the user id is not in the context yet: the bearer token is verified here (one HMAC) to key the
 * bucket per user. Anonymous or invalid-token requests fall back to the client IP.
 */
async function subjectOf(c: Context<AppEnv>): Promise<string | null> {
  const known: string | undefined = c.get("userId");
  if (known !== undefined) return known;
  const header = c.req.header("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  return await verifySession(header.slice(7).trim());
}

export function rateLimit(store: RateLimitStore, now: () => number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const kind = budgetFor(c.req.method, c.req.path);
    if (kind === "exempt" || !rateLimitEnabled()) return await next();

    const perMin = perMinFor(kind);
    const nowMs = now();
    const ip = clientIp(c);
    const keys: string[] = [];

    if (kind === "auth") {
      keys.push(`auth:ip:${ip}`);
      const email = await emailOf(c);
      if (email !== null) keys.push(`auth:email:${email}`);
    } else {
      const userId = await subjectOf(c);
      keys.push(`${kind}:${userId !== null ? `user:${userId}` : `ip:${ip}`}`);
    }

    let worst = 0;
    for (const key of keys) {
      const d = take(store, key, perMin, nowMs);
      if (!d.allowed) worst = Math.max(worst, d.retryAfterSec);
    }
    if (worst > 0) return rateLimitedResponse(worst);
    await next();
  };
}
