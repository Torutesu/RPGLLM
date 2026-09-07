/**
 * The moderation thresholds actually in force (`WORLD_MODERATION`, `WORLD_MODERATION_ENV`).
 *
 * Every number in `WORLD_MODERATION` was chosen for a product with no users — three distinct
 * reporters, a day's SLA, a day's cooldown, twenty minutes on a claim. They are a starting guess,
 * and the first week of real report rates will disagree with all four. So they are overridable per
 * deploy, and **this file is the only place that reads `process.env` for them**: `isOverdue`, the
 * pull threshold, the cooldown, the claim length and the ops surface all resolve through
 * `worldModerationConfig()`, so there is one answer to "what is actually in force" and one place to
 * change how it is read.
 *
 * Read lazily on every call, like `env.ts` — never captured at import time, so a test (or an
 * operator with a restart) can change one without rebuilding the module graph.
 *
 * **A bad value is not an outage.** These bound content moderation: an unparseable
 * `WORLD_REPORTS_TO_PULL` must not take the API down, and must not silently become `0` and pull
 * every world on its first report either. Anything that is not a positive integer within
 * `MAX_VALUE` is refused, logged once, and the shipped default is used instead.
 */
import { WORLD_MODERATION, WORLD_MODERATION_ENV } from "@rpgllm/shared";
import { logLine } from "../middleware/request-log";

export interface WorldModerationConfig {
  /** distinct reporters that take a live world off the shelf */
  reportsToPull: number;
  /** a world waiting longer than this is overdue */
  reviewSlaHours: number;
  /** how long a rejected world waits before it may be offered again */
  resubmitCooldownHours: number;
  /** how long one reviewer holds a world before it returns to the queue */
  claimMinutes: number;
  /**
   * Appeals per rejection. No env key in `WORLD_MODERATION_ENV`: "more than one appeal per
   * decision" is a policy change, not a threshold to tune, so it is resolved here for one source of
   * truth but is not operator-settable.
   */
  appealsPerRejection: number;
  /**
   * gtm.md §2 exit 1 — what a place on the shelf costs, on top of what the world cost to build.
   * **The only one of these that may legitimately be `0`**: a launch promotion, or a market where
   * gems are not sold yet, is a policy someone will actually want, and a fee of zero disables
   * nothing except the charge. Every other number here means something dangerous at zero.
   */
  publicSubmitGems: number;
  /** exit 2 — approvals, with no rejection and no upheld report, that earn sampled review */
  trustApprovals: number;
  /** one submission in this many from a trusted creator is still read end to end. 1 = read them all. */
  trustSampleEvery: number;
  /**
   * Whether a rejection drops a creator back to reading every one. No env key: "a reviewer's no
   * costs a creator their standing" is a policy, not a threshold, so it is resolved here for one
   * source of truth and is not operator-settable.
   */
  trustResetOnReject: boolean;
}

/**
 * A day of hours, a day of minutes-that-are-hours, a lifetime of reporters: past this anything is a
 * typo (a stray `0`, milliseconds pasted into an hours field) rather than a policy.
 */
export const MAX_VALUE = 100_000;

/**
 * Like `resolve`, but `0` is a value rather than a typo. Used for exactly one key — see
 * `publicSubmitGems`. Everything else keeps the stricter reading.
 */
function resolveAllowingZero(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= MAX_VALUE) return n;
  warnOnce(key, raw, fallback);
  return fallback;
}

/** Warn once per distinct bad value — this is read on every request that touches the queue. */
const warned = new Set<string>();

function warnOnce(key: string, raw: string, using: number): void {
  const seen = `${key}=${raw}`;
  if (warned.has(seen)) return;
  warned.add(seen);
  logLine({ level: "warn", msg: "world.moderation.config.invalid", key, value: raw, using });
}

function resolve(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // Positive integers only. `0` is refused on purpose: it is the value a shell expands a typo to,
  // and every one of these means something dangerous at zero.
  if (Number.isInteger(n) && n >= 1 && n <= MAX_VALUE) return n;
  warnOnce(key, raw, fallback);
  return fallback;
}

export const worldModerationConfig = (): WorldModerationConfig => ({
  reportsToPull: resolve(WORLD_MODERATION_ENV.REPORTS_TO_PULL, WORLD_MODERATION.REPORTS_TO_PULL),
  reviewSlaHours: resolve(WORLD_MODERATION_ENV.REVIEW_SLA_HOURS, WORLD_MODERATION.REVIEW_SLA_HOURS),
  resubmitCooldownHours: resolve(WORLD_MODERATION_ENV.RESUBMIT_COOLDOWN_HOURS, WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS),
  claimMinutes: resolve(WORLD_MODERATION_ENV.CLAIM_MINUTES, WORLD_MODERATION.CLAIM_MINUTES),
  appealsPerRejection: WORLD_MODERATION.APPEALS_PER_REJECTION,
  publicSubmitGems: resolveAllowingZero(WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS, WORLD_MODERATION.PUBLIC_SUBMIT_GEMS),
  trustApprovals: resolve(WORLD_MODERATION_ENV.TRUST_APPROVALS, WORLD_MODERATION.TRUST_APPROVALS),
  trustSampleEvery: resolve(WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY, WORLD_MODERATION.TRUST_SAMPLE_EVERY),
  trustResetOnReject: WORLD_MODERATION.TRUST_RESET_ON_REJECT,
});

/** Test seam: forget which bad values have already been logged. */
export const resetConfigWarnings = (): void => warned.clear();
