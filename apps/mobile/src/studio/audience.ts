import type { WorldFull, WorldVisibility } from "../api/client";

/**
 * Who can *actually* play a world, and which control moves it out of the state it is in.
 *
 * `World.visibility` is a wish; `World.status` is what happened to it. The API only lets someone
 * other than the creator reach a world when `status === "published"` (`canPlay`), so a `ready`
 * world that says `public` is playable by exactly one person — its creator — no matter what the
 * row claims. SCR-049 and SCR-050 used to read the wish, which is how a world nobody could see
 * came to wear an EVERYONE badge (QA-003).
 *
 * The table this file encodes, status × visibility. "Audience" is what the badge says; the last
 * column is what the screen must still offer so the state is never a dead end:
 *
 * | status     | visibility | audience in force | controls that must be on screen            |
 * |------------|------------|-------------------|--------------------------------------------|
 * | draft      | any        | — (build died)    | try again (SCR-049's failed branch)         |
 * | generating | any        | — (not yet)       | none — it is building                       |
 * | ready      | private    | Just me           | everyone, link, (private = leave)           |
 * | ready      | unlisted   | **Just me**       | everyone, **link** ← the wish is not in force|
 * | ready      | public     | **Just me**       | **everyone**, link ← QA-003b's stranded case |
 * | review     | any        | Just me           | keep private (withdraw). Publishing is the  |
 * |            |            | (In review pill)  | reviewer's move now, and a pulled world may  |
 * |            |            |                   | not republish at all (QA-001)               |
 * | published  | unlisted   | Anyone with link  | everyone (ask for Explore), keep private    |
 * | published  | public     | Everyone          | link (demote), keep private                 |
 * | rejected   | any        | Just me           | appeal / resubmit / play — SCR-049's own    |
 * |            |            |                   | branch, which is never empty                |
 *
 * Every row therefore either is correct as it stands or offers the control that fixes it, and no
 * row's badge names an audience the world does not have.
 */

export type WorldState = Pick<WorldFull, "status" | "visibility">;

/**
 * The audience that is actually in force. Only a published world is reachable by anyone but its
 * creator, so everything else — building, ready, queued, pulled, rejected — is `private`.
 */
export const audienceInForce = (world: WorldState): WorldVisibility =>
  world.status === "published" ? world.visibility : "private";

/**
 * A world that is finished and not with a reviewer: the two states where its creator, not the
 * queue, decides who can play it.
 */
const settled = (world: WorldState): boolean => world.status === "ready" || world.status === "published";

/**
 * "Share it with everyone" — offered unless everyone already has it. Notably offered for a `ready`
 * world that already says `public`: that is precisely the world with no way forward otherwise.
 */
export const canAskForEveryone = (world: WorldState): boolean =>
  settled(world) && audienceInForce(world) !== "public";

/** "Anyone with the link" — offered unless the world is already live behind one. */
export const canPutBehindLink = (world: WorldState): boolean =>
  settled(world) && audienceInForce(world) !== "unlisted";

/** The share panel is only true when the link actually resolves for the person it is sent to. */
export const isLiveBehindLink = (world: WorldState): boolean => audienceInForce(world) === "unlisted";
