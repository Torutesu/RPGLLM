import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryLimiter } from "../src/middleware/rate-limit";
import { pruneRateLimitBuckets, SharedLimiter } from "../src/middleware/rate-limit-shared";
import { prisma, resetDatabase } from "./helpers";

/**
 * The rate limiter behind more than one process (production-readiness pass).
 *
 * The in-process limiter is correct for one instance and N× the intended budget for N — and the
 * budget it matters most for is five auth attempts a minute, which is what stands between a
 * guessed six-digit code and somebody's account. Scaling the API out was therefore quietly a
 * security change.
 *
 * The cases below pin the arithmetic against the in-process implementation (they must agree —
 * two limiters that disagree are one limiter and one bug) and then pin the property the shared
 * one has and the other cannot: two processes racing for the last token.
 */

let limiter: SharedLimiter;

beforeAll(() => {
  limiter = new SharedLimiter(prisma);
});
beforeEach(async () => {
  await resetDatabase();
});

const t0 = Date.UTC(2026, 8, 10, 12, 0, 0);

describe("the shared bucket", () => {
  it("spends a full budget and then refuses", async () => {
    for (let i = 0; i < 5; i += 1) {
      const d = await limiter.take("auth:ip:1.2.3.4", 5, t0);
      expect(d.allowed, `attempt ${i + 1}`).toBe(true);
    }
    const denied = await limiter.take("auth:ip:1.2.3.4", 5, t0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // 5 a minute ⇒ a token every 12 seconds, and one is exactly what is owed.
    expect(denied.retryAfterSec).toBeLessThanOrEqual(12);
  });

  it("keeps separate keys separate", async () => {
    for (let i = 0; i < 5; i += 1) await limiter.take("auth:ip:1.2.3.4", 5, t0);
    expect((await limiter.take("auth:ip:5.6.7.8", 5, t0)).allowed).toBe(true);
    expect((await limiter.take("auth:email:a@example.com", 5, t0)).allowed).toBe(true);
  });

  it("refills continuously, and never past capacity", async () => {
    for (let i = 0; i < 5; i += 1) await limiter.take("k", 5, t0);
    expect((await limiter.take("k", 5, t0)).allowed).toBe(false);

    // 12s later: exactly one token.
    expect((await limiter.take("k", 5, t0 + 12_000)).allowed).toBe(true);
    expect((await limiter.take("k", 5, t0 + 12_000)).allowed).toBe(false);

    // An hour later the bucket is full, not overflowing: five, then refused.
    for (let i = 0; i < 5; i += 1) {
      expect((await limiter.take("k", 5, t0 + 3_600_000)).allowed, `refilled ${i + 1}`).toBe(true);
    }
    expect((await limiter.take("k", 5, t0 + 3_600_000)).allowed).toBe(false);
  });

  /**
   * The two limiters are not bit-identical and should not pretend to be: after a refusal the
   * shared one restarts the refill from zero, while the in-process one keeps the fractional
   * credit that request had accumulated. What must hold is the *direction* — the shared limiter
   * is the stricter of the two, always — because the alternative is a distributed limiter that
   * quietly lets through what a single instance would have refused.
   */
  it("never allows what the in-process limiter would refuse", async () => {
    const memory = new MemoryLimiter();
    const times = [t0, t0, t0, t0 + 5_000, t0 + 5_000, t0 + 30_000, t0 + 60_000, t0 + 60_001, t0 + 61_000];
    for (const at of times) {
      const shared = await limiter.take("same", 3, at);
      const inProcess = memory.take("same", 3, at);
      if (shared.allowed) {
        expect(inProcess.allowed, `at ${at - t0}ms the shared limiter must not be the lenient one`).toBe(true);
      }
    }
  });

  it("matches the in-process limiter exactly while nothing has been refused", async () => {
    const memory = new MemoryLimiter();
    for (const at of [t0, t0, t0 + 5_000, t0 + 30_000]) {
      const a = await limiter.take("clean", 5, at);
      const b = memory.take("clean", 5, at);
      expect({ allowed: a.allowed, remaining: a.remaining }, `at ${at - t0}ms`).toEqual({
        allowed: b.allowed,
        remaining: b.remaining,
      });
    }
  });

  /**
   * The reason this exists. Two API processes handling the sixth and seventh attempt at the same
   * instant both read "one token left" in a read-then-write limiter and both allow it; the whole
   * bucket lives inside one `INSERT … ON CONFLICT DO UPDATE`, which re-evaluates under the row's
   * own lock, so exactly one of them can win.
   */
  it("lets exactly one of two racing requests through", async () => {
    const other = new SharedLimiter(prisma);
    for (let i = 0; i < 4; i += 1) await limiter.take("race", 5, t0);

    const [a, b] = await Promise.all([limiter.take("race", 5, t0), other.take("race", 5, t0)]);
    expect([a.allowed, b.allowed].filter(Boolean), "one winner, not two").toHaveLength(1);
  });

  it("lets a burst of twenty spend a budget of five, once", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.take("burst", 5, t0)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });

  /** A denial has to leave a mark, or a flood refills as though it never happened. */
  it("charges a refused request, but never more than one token of debt", async () => {
    for (let i = 0; i < 5; i += 1) await limiter.take("debt", 5, t0);
    for (let i = 0; i < 50; i += 1) await limiter.take("debt", 5, t0);
    // 50 refused attempts must not cost 50 tokens of recovery: 12s still buys one.
    expect((await limiter.take("debt", 5, t0 + 12_000)).allowed).toBe(true);
  });

  it("fails open when the database is unreachable", async () => {
    const broken = new SharedLimiter({
      $queryRaw: () => Promise.reject(new Error("connection refused")),
    } as unknown as typeof prisma);
    // A limiter that 500s has turned a defence into an outage.
    expect((await broken.take("k", 5, t0)).allowed).toBe(true);
  });

  it("refuses a zero budget without asking the database", async () => {
    const exploding = new SharedLimiter({
      $queryRaw: () => {
        throw new Error("must not be called");
      },
    } as unknown as typeof prisma);
    expect((await exploding.take("k", 0, t0)).allowed).toBe(false);
  });
});

describe("house-keeping", () => {
  it("drops buckets that have refilled to capacity", async () => {
    await limiter.take("old", 5, t0);
    await limiter.take("fresh", 5, t0 + 3_600_000);

    const pruned = await pruneRateLimitBuckets(prisma, new Date(t0 + 3_000_000));
    expect(pruned).toBe(1);
    const left = await prisma.rateLimitBucket.findMany({ select: { key: true } });
    expect(left.map((r) => r.key)).toEqual(["fresh"]);
  });
});
