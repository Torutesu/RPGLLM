/**
 * The rate limiter, shared across processes (`RATE_LIMIT_STORE=shared`).
 *
 * The in-process limiter is correct for one instance and wrong for two: N replicas mean N× the
 * budget, and the budget this matters most for is `RATE_LIMIT_AUTH_PER_MIN` — five attempts a
 * minute is what stands between a guessed six-digit code and an account. Scaling the API out was
 * therefore quietly a security change, which is the worst kind.
 *
 * **The whole token bucket is one statement.** `INSERT … ON CONFLICT DO UPDATE` re-evaluates the
 * `SET` expression against the conflicting row *while holding that row's lock*, so the refill,
 * the test and the decrement are atomic. The read-then-write this replaces would let two requests
 * racing for the last token both read `1` and both be allowed — which is precisely the request
 * pair an attacker generates.
 *
 * **A refused request leaves the bucket at a deficit, and the deficit is forgiven on the next
 * refill.** The stored value goes as low as −1 (one token of debt) and the next call refills from
 * `GREATEST(tokens, 0)`, so a flood of a thousand refusals costs exactly the same recovery as one.
 * This makes the shared limiter *very slightly* stricter than the in-process one, which keeps the
 * fractional credit a refused request had accumulated: after a denial this one starts the next
 * refill from zero. The property that matters is the direction — **it can never allow a request
 * the in-process limiter would have refused** — and `test/rate-limit-shared.test.ts` pins that.
 *
 * Postgres rather than Redis: it is already here. A second datastore is a second thing to run,
 * back up and fail over, and "the rate limiter is down" must never be why the product is down —
 * which is also why `take` **fails open** on a database error and says so in the log.
 */
import type { PrismaClient } from "@prisma/client";
import { logLine } from "./request-log";
import type { Decision, RateLimiter } from "./rate-limit";

const WINDOW_MS = 60_000;

interface Row {
  tokens: number;
}

export class SharedLimiter implements RateLimiter {
  constructor(private readonly prisma: PrismaClient) {}

  kind(): "shared" {
    return "shared";
  }

  async take(key: string, perMin: number, nowMs: number): Promise<Decision> {
    if (perMin <= 0) return { allowed: false, retryAfterSec: 60, remaining: 0 };
    const now = new Date(nowMs);
    try {
      const rows = await this.prisma.$queryRaw<Row[]>`
        INSERT INTO "RateLimitBucket" ("key", "tokens", "updatedAt")
        VALUES (${key}, ${perMin}::float8 - 1, ${now})
        ON CONFLICT ("key") DO UPDATE SET
          "tokens" = LEAST(
            ${perMin}::float8,
            GREATEST("RateLimitBucket"."tokens", 0)
              + EXTRACT(EPOCH FROM (${now}::timestamptz - "RateLimitBucket"."updatedAt"))
                * ${perMin}::float8 / 60.0
          ) - 1,
          "updatedAt" = ${now}
        RETURNING "tokens"`;
      // Refilled from a floor of zero, so the result is in [-1, perMin-1]: negative ⇒ refused.
      const tokens = rows[0]?.tokens ?? perMin - 1;
      if (tokens >= 0) return { allowed: true, retryAfterSec: 0, remaining: Math.floor(tokens) };
      // `tokens` is the post-decrement deficit in [-1, 0): the wait is what it takes to earn it back.
      const msToOne = (-tokens * WINDOW_MS) / perMin;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(msToOne / 1000)), remaining: 0 };
    } catch (err: unknown) {
      // Fail open, loudly. A limiter that 500s has turned a defence into an outage.
      logLine({ level: "error", msg: "ratelimit.store.failed", error: String(err).slice(0, 200) });
      return { allowed: true, retryAfterSec: 0, remaining: 0 };
    }
  }
}

/**
 * House-keeping. A bucket at capacity is indistinguishable from one that never existed, so the
 * sweep is not a compromise — it removes rows that carry no information. Called by the
 * `purge-login-codes` job, which is where the other "stop this table growing forever" work lives.
 */
export async function pruneRateLimitBuckets(prisma: PrismaClient, olderThan: Date): Promise<number> {
  const { count } = await prisma.rateLimitBucket.deleteMany({ where: { updatedAt: { lt: olderThan } } });
  return count;
}
