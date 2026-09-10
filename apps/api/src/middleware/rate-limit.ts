/**
 * In-process token-bucket rate limiting (Agent F, S0-4). No new dependency.
 *
 * Budgets (per minute, all overridable by env):
 *   auth start/verify   5   — per IP *and* per email
 *   post / DM writes    20  — per user (each one costs an LLM call)
 *   world create        3   — per user (each one costs a high-tier, two-locale world)
 *   ad reward           10  — per user (each one mints energy)
 *   everything else     120 — per user, or per IP when unauthenticated
 *
 * `/__test/*` is exempt, and the whole limiter is off while `TEST_HOOKS=1` so the vitest and
 * Playwright suites never flake on it (`RATE_LIMIT_ENABLED=0|1` overrides either way).
 *
 * **Where the buckets live** (`RATE_LIMIT_STORE`). In-process by default, which is exactly right
 * for one instance and exactly wrong for two: behind N replicas an in-process budget is N× the
 * intended one, and the budget that matters most — five auth attempts a minute — is the one
 * standing between an attacker and an account.
 *
 * `shared` moves them to Postgres, which this service already depends on, so a distributed limiter
 * needs no new infrastructure. The token-bucket arithmetic runs **inside one `INSERT … ON CONFLICT
 * DO UPDATE`**, where it re-reads the row under the update's own lock: two requests racing for the
 * last token cannot both win, which a read-then-write in application code would allow. The cost is
 * one indexed upsert per request per key, next to the several queries a request already makes.
 *
 * Redis would be faster. It would also be a second datastore to run, back up and fail over, and
 * "the rate limiter is down" must never be a reason the product is down.
 */
import type { Context, MiddlewareHandler } from "hono";
import { verifySession } from "../auth";
import {
  rateLimitAdPerMin, rateLimitAuthPerMin, rateLimitDefaultPerMin, rateLimitEnabled, rateLimitWorldPerMin,
  rateLimitWritePerMin,
} from "../env";
import { fail } from "../http";
import type { AppEnv } from "../types";

export interface Bucket { tokens: number; last: number }
export type RateLimitStore = Map<string, Bucket>;

/**
 * What the middleware talks to. Async because one of the two implementations is a database — and
 * the in-process one answering synchronously behind the same interface costs nothing.
 */
export interface RateLimiter {
  take(key: string, perMin: number, nowMs: number): Decision | Promise<Decision>;
  /** for the boot log and `GET /v1/health`: which of the two is in force */
  kind(): "memory" | "shared";
}

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

/** 429 body. `RATE_LIMITED` is part of `ErrorCodeZ`, so this goes through the shared `fail()`. */
export const RATE_LIMITED_CODE = "RATE_LIMITED" as const;

export function rateLimitedResponse(retryAfterSec: number): Response {
  const res = fail(RATE_LIMITED_CODE, "Too many requests. Please slow down.", 429);
  res.headers.set("retry-after", String(retryAfterSec));
  return res;
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

export type BudgetKind = "auth" | "write" | "ad" | "world" | "default" | "exempt";

/** Route → budget. Paths arrive both as `/v1/...` and (health/test hooks) unversioned. */
export function budgetFor(method: string, path: string): BudgetKind {
  const p = path.replace(/^\/v1/, "");
  if (p.startsWith("/__test")) return "exempt";
  if (p === "/health" || p === "/health/") return "exempt";
  if (method === "OPTIONS") return "exempt";
  // The store's webhook is authenticated by its HMAC, not by a session, and it arrives from a small
  // set of sender IPs. Throttling it would drop purchase events into RevenueCat's retry queue for
  // no security gain — the signature already decides what is accepted, and every event is idempotent.
  if (p === "/billing/webhook") return "exempt";

  if (p.startsWith("/auth/")) {
    if (p === "/auth/age-gate") return "default";
    return method === "POST" ? "auth" : "default";
  }
  if (method === "POST") {
    if (p === "/wallet/ad-reward") return "ad";
    // World Studio (AIF-003): one request here is one Opus 5 high-effort call producing two full
    // locales — an order of magnitude more expensive than a post. Its own, much smaller budget.
    if (p === "/worlds") return "world";
    // Reporting is a write with consequences: WORLD_MODERATION takes a world off the shelf at three
    // distinct reporters, and a low threshold makes brigading the obvious attack. It is limited like
    // the rest of the write surface — the per-user budget is what stops one account manufacturing
    // reporters, on top of the takedown counting distinct *users* rather than reports.
    if (p === "/moderation/report") return "write";
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
        : kind === "world" ? rateLimitWorldPerMin()
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

/** The historical in-process limiter: one `Map`, no I/O, correct for exactly one instance. */
export class MemoryLimiter implements RateLimiter {
  constructor(private readonly store: RateLimitStore = new Map()) {}
  take(key: string, perMin: number, nowMs: number): Decision { return take(this.store, key, perMin, nowMs); }
  kind(): "memory" { return "memory"; }
}

export function rateLimit(limiter: RateLimiter, now: () => number): MiddlewareHandler<AppEnv> {
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
      /*
       * Every key is consumed even after one of them has already denied: the budgets are separate
       * (an IP and an email, say), and skipping the rest would let a flood from one address spend
       * nothing against the other's bucket and reset the moment the first one refills.
       */
      const d = await limiter.take(key, perMin, nowMs);
      if (!d.allowed) worst = Math.max(worst, d.retryAfterSec);
    }
    if (worst > 0) return rateLimitedResponse(worst);
    await next();
  };
}
