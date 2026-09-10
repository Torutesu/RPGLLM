/**
 * A ceiling on what one day can cost.
 *
 * Everything else in this system bounds a *user*: ten energy a day, five ad rewards, three worlds,
 * a rate limit per minute. None of that bounds the **invoice**, and the gap between the two is
 * where metered-API startups die — a retry loop that does not stop, a bandit that promotes an
 * expensive arm, one account automating the studio, a prompt that starts producing 8k of output
 * because a world's bible grew. Every one of those is a bug we have not written yet, and the
 * defence against a bug you have not written is a limit, not more care.
 *
 * Four decisions:
 *
 * **1. It counts real money only.** The ceiling is enforced when the gateway is `live`. Replay
 * estimates a cost so the dashboards have something to show, but refusing to serve a test because
 * an imaginary budget ran out is a self-inflicted outage.
 *
 * **2. Exhausted looks exactly like an outage, on purpose.** The wrapper throws, and every call
 * site in this service already handles a throwing gateway: that is `LLM_MODE=fail`, which the
 * suite exercises. The player gets the fallback reply and their energy back (CLAUDE.md rule 6),
 * which is the behaviour we already decided was the acceptable degradation.
 *
 * **3. The cap is read from `GenerationLog`, not from a counter.** The log is the thing the
 * invoice is reconciled against; a separate counter is a second source of truth that drifts, and
 * it drifts *downwards* precisely when something is going wrong. The sum is cached for a few
 * seconds and nudged by each call's own cost, so the overshoot is bounded by one refresh window
 * rather than by one request.
 *
 * **4. Unlimited has to be typed out.** `LLM_DAILY_BUDGET_USD=unlimited` is a legitimate answer —
 * but it is an answer, and the production boot gate refuses an empty one. A default of "no limit"
 * that nobody chose is how you find out the number should have existed.
 */
import type { PrismaClient } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import { envNum, envStr } from "../env";
import { logLine } from "../middleware/request-log";

/** The literal that means "we thought about it and there is no cap". */
export const UNLIMITED = "unlimited";

/** `null` ⇒ no ceiling. Anything unparseable is treated as no ceiling *and* refused at boot. */
export function dailyBudgetUsd(): number | null {
  const raw = envStr("LLM_DAILY_BUDGET_USD", "").trim().toLowerCase();
  if (raw === "" || raw === UNLIMITED) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** How long a cached day total may be reused. The overshoot ceiling is (spend rate × this). */
export const budgetRefreshMs = (): number => envNum("LLM_BUDGET_REFRESH_MS", 20_000);

/** UTC, like every other daily boundary in this product (worlds, energy, ad rewards). */
export const dayKeyOf = (now: Date): string => now.toISOString().slice(0, 10);

const startOfUtcDay = (now: Date): Date => new Date(`${dayKeyOf(now)}T00:00:00.000Z`);

export interface BudgetStatus {
  /** the ceiling, or null when it is deliberately unlimited */
  limitUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  exhausted: boolean;
  dayKey: string;
  /** true when the number came from the cache rather than from a fresh sum */
  cached: boolean;
}

interface CacheEntry { dayKey: string; spentUsd: number; fetchedAtMs: number }
let cache: CacheEntry | null = null;

/** Test seam: forget what we counted. */
export const resetBudgetCache = (): void => { cache = null; };

/** The day's spend, summed from the log. Cheap: `GenerationLog` is indexed on `createdAt`. */
export async function spentTodayUsd(prisma: PrismaClient, now: Date): Promise<number> {
  const agg = await prisma.generationLog.aggregate({
    where: { createdAt: { gte: startOfUtcDay(now) } },
    _sum: { costUsd: true },
  });
  return Number(agg._sum.costUsd ?? 0);
}

/**
 * The day's spend, from cache when it is fresh. A day rollover invalidates unconditionally: the
 * one moment the cached number is not merely stale but wrong by the whole of yesterday.
 */
export async function cachedSpentUsd(prisma: PrismaClient, now: Date): Promise<{ spentUsd: number; cached: boolean }> {
  const dayKey = dayKeyOf(now);
  const nowMs = now.getTime();
  if (cache && cache.dayKey === dayKey && nowMs - cache.fetchedAtMs < budgetRefreshMs()) {
    return { spentUsd: cache.spentUsd, cached: true };
  }
  const spentUsd = await spentTodayUsd(prisma, now);
  cache = { dayKey, spentUsd, fetchedAtMs: nowMs };
  return { spentUsd, cached: false };
}

/**
 * Add what a call just cost, so a burst inside one refresh window still moves the number. Without
 * this the ceiling is only ever as tight as the refresh interval — which is exactly the window a
 * runaway loop lives in.
 */
export function noteSpend(costUsd: number, now: Date): void {
  const dayKey = dayKeyOf(now);
  if (!cache || cache.dayKey !== dayKey) return;
  if (Number.isFinite(costUsd) && costUsd > 0) cache.spentUsd += costUsd;
}

export async function budgetStatus(prisma: PrismaClient, now: Date): Promise<BudgetStatus> {
  const limitUsd = dailyBudgetUsd();
  const { spentUsd, cached } = await cachedSpentUsd(prisma, now);
  return {
    limitUsd,
    spentUsd,
    remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - spentUsd),
    exhausted: limitUsd !== null && spentUsd >= limitUsd,
    dayKey: dayKeyOf(now),
    cached,
  };
}

export class BudgetExhaustedError extends Error {
  constructor(readonly spentUsd: number, readonly limitUsd: number) {
    // No user id, no prompt, no content: this string ends up in logs and error trackers.
    super(`daily LLM budget exhausted (${spentUsd.toFixed(2)} of ${limitUsd.toFixed(2)} USD)`);
    this.name = "BudgetExhaustedError";
  }
}

/**
 * Which gateway members do not spend money.
 *
 * These are also the only **synchronous** members of the interface, and that is not a coincidence:
 * the budget check reads the database, so anything this wrapper intercepts necessarily becomes a
 * promise. A new sync method on `Gateway` therefore has to be added here — the type checker will
 * not catch it, so the list is the contract.
 */
const FREE_MEMBERS = new Set(["mode", "setMode", "assignments", "champion"]);

let announcedDay = "";

/**
 * Wraps a gateway so that no generator runs once the day's ceiling is reached.
 *
 * A `Proxy` rather than an object literal with fourteen methods: the interface grows (it grew by
 * three during this project), and an allow-list's failure mode is that the newest and most
 * expensive generator is the one nobody added to it.
 */
export function withBudget(gateway: Gateway, prisma: PrismaClient, now: () => Date): Gateway {
  return new Proxy(gateway, {
    get(target, prop) {
      // `target` as the receiver, not the proxy: a gateway implemented as a class with private
      // fields throws on a getter invoked with a foreign receiver, and the proxy is foreign.
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== "function" || typeof prop !== "string" || FREE_MEMBERS.has(prop)) return value;

      return async (...args: unknown[]): Promise<unknown> => {
        // Only real money is capped; see the header.
        if (target.mode() !== "live" || dailyBudgetUsd() === null) {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        }
        const at = now();
        const status = await budgetStatus(prisma, at);
        if (status.exhausted && status.limitUsd !== null) {
          // One line a day, not one per refused request: past the ceiling every request refuses,
          // and a log that repeats a thousand times an hour is a log nobody reads.
          if (announcedDay !== status.dayKey) {
            announcedDay = status.dayKey;
            logLine({
              level: "error", msg: "llm.budget.exhausted", generator: prop,
              spentUsd: Number(status.spentUsd.toFixed(4)), limitUsd: status.limitUsd, dayKey: status.dayKey,
            });
          }
          throw new BudgetExhaustedError(status.spentUsd, status.limitUsd);
        }
        const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        chargeCache(result, at);
        return result;
      };
    },
  });
}

/** Pull the cost out of whatever shape the call returned (one result, or a batch map). */
function chargeCache(result: unknown, at: Date): void {
  if (typeof result !== "object" || result === null) return;
  const single = (result as { meta?: { costUsd?: unknown } }).meta;
  if (single && typeof single.costUsd === "number") { noteSpend(single.costUsd, at); return; }
  if (result instanceof Map) {
    for (const entry of result.values()) {
      const meta = (entry as { meta?: { costUsd?: unknown } } | null)?.meta;
      if (meta && typeof meta.costUsd === "number") noteSpend(meta.costUsd, at);
    }
    return;
  }
  const results = (result as { results?: unknown }).results;
  if (results instanceof Map) {
    for (const entry of results.values()) {
      const meta = (entry as { meta?: { costUsd?: unknown } } | null)?.meta;
      if (meta && typeof meta.costUsd === "number") noteSpend(meta.costUsd, at);
    }
  }
}
