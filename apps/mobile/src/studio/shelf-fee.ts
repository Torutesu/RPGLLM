import { WORLD_MODERATION } from "@rpgllm/shared";

/**
 * The shelf fee in force on this deployment.
 *
 * `WORLD_PUBLIC_SUBMIT_GEMS` exists so the fee can move without shipping an app, which means the
 * constant this build carries is a guess about the server. `GET /v1/worlds/mine` answers with the
 * real one, so whichever screen asks first records it here and every other screen stops guessing.
 *
 * A module-level cache rather than app state on purpose: it is a property of the deployment, not of
 * the session, and nothing should re-render because it arrived. The 402 stays authoritative either
 * way — this only decides whether a player is shown the right number before they press the button.
 */
let known: number | null = null;

export function rememberShelfFee(gems: number | undefined): void {
  if (typeof gems === "number" && Number.isFinite(gems) && gems >= 0) known = gems;
}

export const shelfFee = (): number => known ?? WORLD_MODERATION.PUBLIC_SUBMIT_GEMS;

/** Test seam: forget what the server said. */
export const forgetShelfFee = (): void => { known = null; };
