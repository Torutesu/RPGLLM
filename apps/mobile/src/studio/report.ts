import type { WorldFull } from "../api/client";
import { ApiError } from "../api/client";
import type { WorldSummary } from "../api/types";

/**
 * Who may be reported, and how a refused resubmit is recognised.
 *
 * Reporting is only offered where it means something: a world somebody else made. A preset is
 * ours, and your own world is yours to unpublish, not to report — offering it there would be a
 * dead end dressed up as an action.
 */

/** A community card: someone else's world, never a preset, never your own. */
export const isReportableWorld = (w: Pick<WorldFull, "isMine" | "isPreset">): boolean =>
  !w.isMine && !w.isPreset;

/**
 * The world you are *playing* carries no ownership flags — the feed only knows a slug. But the
 * world picker (`GET /v1/worlds`) is exactly "every preset, plus the worlds you made", so a slug
 * that is missing from it is, by construction, someone else's. `null` (not loaded, or the call
 * failed) is not an answer, so nothing is offered until it is.
 */
export const isSomeoneElsesWorld = (worlds: WorldSummary[] | null, slug: string): boolean =>
  worlds !== null && slug.length > 0 && !worlds.some((w) => w.slug === slug);

/**
 * A rejected world may be submitted again, but not straight away
 * (`WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS`). The contract carries no "rejected at", so the
 * cooldown cannot be computed here — the server refuses and the client has to read the refusal.
 *
 * The server answers `VALIDATION` / 409 with the hours still to wait (`resubmitCooldownHours`),
 * checked before the safety gate so a refused resubmit costs no tokens. 429 is accepted too, in
 * case the refusal ever moves onto the rate-limit budget. A 422 is the safety gate and a 5xx is a
 * broken server; neither may be dressed up as "come back tomorrow" — and the caller only asks this
 * about a world that is actually `rejected`, since 409 also means "it hasn't finished building".
 */
export function isResubmitCooldown(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  if (e.isSafety || e.isNetwork) return false;
  return e.status === 409 || e.status === 429 || e.code === "RATE_LIMITED" || e.code === "WORLD_LIMIT";
}
