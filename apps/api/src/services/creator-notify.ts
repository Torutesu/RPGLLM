/**
 * The return signal (gtm.md, 勝ち筋 A ①) — **everything a creator is owed about their own world.**
 *
 * Every one of these events used to be addressed to the creator's *most recent persona*, and a
 * persona is per (user, world): the World Studio is reachable from the world picker, which a new
 * player sees before any persona exists, so a creator who had never played anything was told
 * nothing when their world finished, failed, was reviewed or was pulled. The notification was
 * written to nowhere and the creator polled a screen instead. Worse, it was silent — `tellCreator`
 * returned early and logged nothing.
 *
 * So the address is the **account**. `Notification.userId` is the other half of `personaId`
 * (schema.prisma): exactly one of the two is set, and `GET /v1/notifications` returns the account's
 * rows alongside whichever persona's rows it is showing — including when there is no persona at
 * all. Nothing creator-facing can be dropped on the floor any more, and `tellCreator` returning
 * `false` now means one thing only: the world has no creator (a preset, or a purged account).
 *
 * The copy is deliberately assembled from existing `packages/shared` i18n keys — this agent owns
 * `apps/api` and nothing else. `worldApproved` is the one sentence the catalogue is missing; see
 * `pipeline/status/build-notes.md`.
 */
import type { PrismaClient, World } from "@prisma/client";
import { compactNumber, t, type Locale } from "@rpgllm/shared";
import { localized, type LocaleKey } from "./locale";
import { actorLine, notify } from "./notify";
import type { Tx } from "../types";

/** What happened to the world, from the creator's side. */
export type CreatorEvent =
  /** the build job finished — `ok: false` is a failed build, refunded, back to `draft` */
  | { kind: "built"; ok: boolean }
  /** a decision was made about sharing it: a reviewer's, or the pre-publish gate's */
  | { kind: "reviewed"; approved: boolean }
  /** enough players reported it that it came off the shelf */
  | { kind: "pulled" }
  /** somebody who is not the creator played it, and the count reached a threshold */
  | { kind: "played"; plays: number };

/**
 * Their language, not the world's. `genLocale` is what the world is written in — a creator can
 * write an EN world and read their notifications in JA — so the inbox line is rendered in the
 * account's locale, and falls back to the world's only if the account is gone.
 */
async function creatorLocale(tx: Tx | PrismaClient, world: World): Promise<LocaleKey> {
  if (!world.createdBy) return (world.genLocale ?? "en") as LocaleKey;
  const user = await tx.user.findUnique({ where: { id: world.createdBy }, select: { locale: true } });
  return (user?.locale ?? world.genLocale ?? "en") as LocaleKey;
}

function textFor(event: CreatorEvent, locale: LocaleKey, world: World): string {
  const l = locale as Locale;
  switch (event.kind) {
    case "built":
      return t(l, event.ok ? "studioReady" : "studioFailed");
    case "reviewed":
      // Both halves are full sentences: "Explore — <title>" was legible and read like a breadcrumb
      // rather than news about your own work, which is the whole point of this row.
      return event.approved ? `${t(l, "studioApproved")} — ${localized(world.title, locale)}` : t(l, "studioRejected");
    case "pulled":
      return t(l, "studioPulled");
    case "played":
      return event.plays <= 1
        ? t(l, "worldPlayedTitle")
        : actorLine(locale, compactNumber(event.plays), t(l, "worldPlayedBody"));
  }
}

const KIND = {
  built: "world_ready",
  reviewed: "world_reviewed",
  pulled: "world_pulled",
  played: "world_played",
} as const;

/**
 * Tell the creator. One row, addressed to the account, in the caller's transaction.
 *
 * Returns false only when there is nobody to tell — a preset, or a world whose creator deleted
 * their account (`createdBy` is `SetNull`). Every other outcome writes the row.
 */
export async function tellCreator(tx: Tx | PrismaClient, world: World, event: CreatorEvent): Promise<boolean> {
  if (!world.createdBy) return false;
  const locale = await creatorLocale(tx, world);
  await notify(tx, {
    userId: world.createdBy,
    kind: KIND[event.kind],
    target: `world:${world.id}`,
    text: textFor(event, locale, world),
    payload: {
      worldId: world.id,
      slug: world.slug,
      ...(event.kind === "built" ? { ok: event.ok } : {}),
      ...(event.kind === "reviewed" ? { approved: event.approved } : {}),
      ...(event.kind === "pulled" ? { pulled: true } : {}),
      ...(event.kind === "played" ? { plays: event.plays } : {}),
    },
  });
  return true;
}
