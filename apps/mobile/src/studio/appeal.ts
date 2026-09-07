import type { WorldFull } from "../api/client";

/**
 * One appeal, and where it sits against the cooldown.
 *
 * A rejected world has two possible next steps and they are answers to different questions.
 * "Send it back" says *nothing was wrong with the decision, try another day*; the appeal says
 * *the decision read this wrong*. The runbook tells reviewers to reject when unsure, so the
 * second one is a real case — but a screen that offers both at full volume is a screen that has
 * not decided anything for the creator. `rejectedStep` decides, and the screen renders one step.
 */

/** `AppealWorldReqZ` is `min(10).max(500)`; the client refuses the same range so a 400 never lands. */
export const APPEAL_MIN = 10;
export const APPEAL_MAX = 500;

/** What the server will actually see. Whitespace is not an appeal, so it is trimmed before both. */
export const appealText = (raw: string): string => raw.trim();

export const isAppealValid = (raw: string): boolean => {
  const n = appealText(raw).length;
  return n >= APPEAL_MIN && n <= APPEAL_MAX;
};

/**
 * The one thing a creator may do next about a rejection.
 *
 * - `appeal`        — an appeal is available and unused: this is the offer.
 * - `appealPending` — it has been sent; there is nothing to do but wait for the person reading it.
 * - `resubmit`      — no appeal left, so the standing offer is the same world, again.
 * - `resubmitWait`  — the server has refused that resubmit; the cooldown gets the sentence.
 *
 * The appeal outranks the cooldown deliberately. While an appeal is available it is the whole next
 * step, so `studioResubmitWait` never appears beside `studioAppeal` — the creator is told one
 * thing to do, not handed two half-offers and asked to referee them.
 */
export type RejectedStep = "appeal" | "appealPending" | "resubmit" | "resubmitWait";

export function rejectedStep(
  world: Pick<WorldFull, "canAppeal" | "appealed">,
  state: { appealSent: boolean; resubmitRefused: boolean },
): RejectedStep {
  // Sent in this session. A successful appeal normally moves the world back to `review`, but the
  // local flag still speaks for the moment between the 200 and the next poll.
  if (state.appealSent) return "appealPending";
  // One per decision (`WORLD_MODERATION.APPEALS_PER_REJECTION`): used is used, whichever way it
  // went. A world that is `rejected` again *after* an appeal is not owed a second one.
  if (world.canAppeal && !world.appealed) return "appeal";
  return state.resubmitRefused ? "resubmitWait" : "resubmit";
}

/**
 * An appeal that is being read right now. The world is back in the queue (`review`), so this is
 * what "pending" means on a screen the creator reopened days later — the state, not a toast.
 */
export const isAppealPending = (world: Pick<WorldFull, "appealed" | "status">): boolean =>
  world.appealed && world.status === "review";
