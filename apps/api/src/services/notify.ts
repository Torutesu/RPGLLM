import type { NotificationKind, Prisma, PrismaClient } from "@prisma/client";
import { FOLLOWER_MILESTONES, compactNumber, t } from "@rpgllm/shared";
import type { LocaleKey } from "./locale";
import { pushClient, pushEnabled, pushForNotification } from "./push";
import type { Tx } from "../types";

/**
 * Notifications (SCR-042) — the surface Status leans on hardest and the MVP shipped without.
 *
 * Two rules make the list cheap to render:
 *  1. `text` is **rendered server-side in the persona's locale** and stored, so `GET /v1/notifications`
 *     is one query with one join for the actor and needs no post/event/achievement lookups.
 *  2. every `notify()` takes a transaction client and is called inside the transaction of the thing
 *     that caused it, so a notification can never exist for a row that was rolled back (and vice versa).
 */
export interface NotifyInput {
  personaId: string;
  kind: NotificationKind;
  /** the character that did it; null for `milestone` / `unlock` / `digest` */
  actorId?: string | null;
  /** `post:<id>` | `dm:<threadId>` | `event:<id>` | `digest:<id>` | `achievement:<key>` | `profile` */
  target?: string | null;
  text: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
}

export async function notify(tx: Tx | PrismaClient, input: NotifyInput): Promise<void> {
  await tx.notification.create({
    data: {
      personaId: input.personaId,
      kind: input.kind,
      actorId: input.actorId ?? null,
      target: input.target ?? null,
      text: input.text,
      payload: (input.payload ?? {}) as unknown as Prisma.InputJsonValue,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  /**
   * Agent P: the same row is what a push says. Nothing happens while `PUSH_ENABLED != 1` — the flag
   * is checked before anything is scheduled — and `pushForNotification` filters to the kinds worth
   * waking a phone for. It uses the *base* client registered by `createApp`, never `tx`, and is
   * deliberately not awaited: `notify()` runs inside the transaction of the thing that caused it,
   * and a network round trip must not hold that open. A rolled-back transaction can therefore, in
   * the worst case, cost one push — never a lost one.
   */
  const client = pushClient();
  if (pushEnabled() && client) {
    void pushForNotification(client, {
      personaId: input.personaId,
      kind: input.kind,
      text: input.text,
      target: input.target ?? null,
    }).catch(() => {
      /* a phone that cannot be reached must never fail the action that caused the notification */
    });
  }
}

/**
 * "<name> replied to you" in EN, "<name>が返信しました" in JA — the i18n verbs are written as
 * suffixes, so JA joins without a space and EN with one.
 */
export const actorLine = (locale: LocaleKey, displayName: string, verb: string): string =>
  locale === "ja" ? `${displayName}${verb}` : `${displayName} ${verb}`;

export const replyText = (locale: LocaleKey, displayName: string): string =>
  actorLine(locale, displayName, t(locale, "repliedToYou"));
export const likeText = (locale: LocaleKey, displayName: string): string =>
  actorLine(locale, displayName, t(locale, "likedYourPost"));
export const followText = (locale: LocaleKey, displayName: string): string =>
  actorLine(locale, displayName, t(locale, "followedYou"));
export const dmText = (locale: LocaleKey, displayName: string): string =>
  actorLine(locale, displayName, t(locale, "sentYouADM"));

export const milestoneText = (locale: LocaleKey, followers: number): string =>
  `${t(locale, "youReached")} ${compactNumber(followers)} ${t(locale, "followers")}`;
export const unlockText = (locale: LocaleKey, title: string): string =>
  `${t(locale, "newAchievement")} — ${title}`;
export const eventText = (locale: LocaleKey, title: string): string => `${t(locale, "milestone")} — ${title}`;
export const digestText = (locale: LocaleKey, headline: string): string =>
  `${t(locale, "whileYouWereAway")} — ${headline}`;

/** At most this many `like` rows per post, so one viral post cannot flood the tab. */
export const LIKES_PER_POST = 3;

/**
 * Follower milestones crossed by one stat change. Writes one `milestone` row per threshold so a
 * single huge swing (500 → 6,000) still celebrates every step the player earned.
 */
export async function notifyFollowerMilestones(
  tx: Tx,
  opts: { personaId: string; locale: LocaleKey; before: number; after: number },
): Promise<number[]> {
  const crossed = FOLLOWER_MILESTONES.filter((m) => opts.before < m && opts.after >= m);
  for (const m of crossed) {
    await notify(tx, {
      personaId: opts.personaId,
      kind: "milestone",
      target: "profile",
      text: milestoneText(opts.locale, m),
      payload: { followers: m, kind: "followers" },
    });
  }
  return [...crossed];
}
