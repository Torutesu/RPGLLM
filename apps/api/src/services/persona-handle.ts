/**
 * Who may take a handle in a world — asked once, answered in one place.
 *
 * `status` is single-player. A `Persona` is per (user, world), every post and DM is scoped by
 * `personaId`, and two players in the same world never see each other's anything. So a handle only
 * has to be unique **to a player within a world**. `Persona @@unique([worldId, handle])` made it
 * unique to the *world*, which meant strangers competed for names in a world they do not share —
 * and it got worse the more a world was played, which is exactly backwards for a product whose
 * whole strategy is one world played by many people. `GET /v1/worlds/:id` even hands every player
 * the same `presetPersonas` to choose from, so the most likely first pick was the most likely
 * collision.
 *
 * Two things still have to hold, and they are why this is a function and not a `findUnique`:
 *
 *  1. **The cast owns its handles.** A persona called `@rina` in a world whose cast has `@rina`
 *     puts two of them in one feed, and reply targeting (`story.ts`) resolves a parent author by
 *     handle — so the ambiguity is not cosmetic. `WorldCharacter` is a different table, so no index
 *     can express this; it is checked here, on every path that can create a persona.
 *  2. **One player, one handle per world.** Still enforced, now by `(worldId, userId, handle)`.
 */
import type { Persona, PrismaClient } from "@prisma/client";
import { normHandle } from "./handles";
import type { Tx } from "../types";

export type HandleClaim =
  /** nobody in this world holds it, and the cast does not either */
  | { state: "free"; handle: string }
  /** a cast member's handle. Nobody may take it, ever */
  | { state: "cast"; handle: string }
  /** this player already plays this world under this handle */
  | { state: "mine"; handle: string; persona: Persona };

/**
 * Cast handles are stored with a leading `@` (`seed.ts`), persona handles without one — so the
 * comparison has to be made on the normalised form, both spellings, case-insensitively.
 */
export async function resolveHandle(
  db: PrismaClient | Tx,
  worldId: string,
  userId: string,
  raw: string,
): Promise<HandleClaim> {
  const handle = normHandle(raw);
  const cast = await db.worldCharacter.findFirst({
    where: { worldId, handle: { in: [handle, `@${handle}`], mode: "insensitive" } },
    select: { id: true },
  });
  if (cast !== null) return { state: "cast", handle };

  const mine = await db.persona.findUnique({
    where: { worldId_userId_handle: { worldId, userId, handle } },
  });
  return mine === null ? { state: "free", handle } : { state: "mine", handle, persona: mine };
}
