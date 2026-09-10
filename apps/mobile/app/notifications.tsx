import React, { useCallback, useEffect, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { T, colors, compactNumber, radius, spacing, timeAgo } from "@rpgllm/shared";
import type { Notification } from "../src/api/client";
import { StreakCard, StreakChip } from "../src/components/StreakCard";
import { Button, HeaderBar, Screen } from "../src/components/ui";
import { SkeletonList } from "../src/components/Skeleton";
import { Avatar, Icon, typo, type IconName } from "../src/ui";
import { resetToFeed } from "../src/nav";
import { useActions, useAppState, useT } from "../src/state/store";

/**
 * SCR-042 — notifications.
 *
 * The single biggest missing dopamine surface in the MVP. Rows are grouped by day, unread rows
 * carry a left accent rail, and every row knows where it goes: the server stored `target` when it
 * wrote the row, so tapping never needs a lookup.
 */
const KIND_ICON: Record<Notification["kind"], IconName> = {
  like: "heartFilled",
  reply: "reply",
  follow: "person",
  mention: "message",
  dm: "message",
  milestone: "crown",
  event: "sparkle",
  digest: "clock",
  unlock: "trophy",
  /*
   * Circuit ① — the author's return signal. A `playCount` sitting in a table is not a return; the
   * whole reason these four kinds exist is that reaction-free creation stops. They are given the
   * studio's own vocabulary rather than the social one: people for a world being played, a spark
   * for one that finished building, a check for one that cleared review, a shield for one taken
   * back off the shelf.
   */
  world_played: "person",
  world_ready: "sparkle",
  world_reviewed: "check",
  world_pulled: "shield",
};

const KIND_COLOR: Record<Notification["kind"], string> = {
  like: colors.hot,
  reply: colors.accent,
  follow: colors.positive,
  mention: colors.accent,
  dm: colors.verified,
  milestone: colors.energy,
  event: colors.negative,
  digest: colors.textDim,
  unlock: colors.energy,
  world_played: colors.accentHi,
  world_ready: colors.positive,
  world_reviewed: colors.verified,
  world_pulled: colors.danger,
};

/**
 * `post:<id>` | `dm:<threadId>` | `event:<id>` | `achievement:<key>` | `digest:<id>` | `profile`
 * | `world:<id>`.
 *
 * A world notification lands on the world's own page — the thing the news is *about*. When it is
 * yours that page carries the way through to the studio, so "taken down" still reaches the appeal
 * in one more tap without every row needing to know which of the two screens it meant.
 */
function go(target: string | null): void {
  if (!target) return;
  const sep = target.indexOf(":");
  const kind = sep === -1 ? target : target.slice(0, sep);
  const id = sep === -1 ? "" : target.slice(sep + 1);
  switch (kind) {
    case "post":
      router.push(`/post/${id}`);
      return;
    case "dm":
      router.push(`/dms/${id}`);
      return;
    case "event":
      router.push(`/event/${id}`);
      return;
    case "achievement":
      router.push("/achievements");
      return;
    case "profile":
      router.push("/profile");
      return;
    case "world":
      router.push({ pathname: "/world/[id]", params: { id } });
      return;
    case "creator":
      router.push({ pathname: "/creator/[handle]", params: { handle: id } });
      return;
    default:
      resetToFeed();
  }
}

/** First finite number under any of `keys`. `payload` is `Record<string, unknown>` by contract. */
function numberIn(payload: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function stringIn(payload: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

/**
 * A world row, written as news about your work rather than as a line of activity.
 *
 * Only `world_played` has shipped copy (`worldPlayedTitle` / `worldPlayedBody`), and it is the one
 * that carries a number, so it is composed here: the headline is the event and the second line is
 * the figure that makes it worth reading. The other three keep the server's sentence as their
 * headline and add the world's name underneath when the payload names it — requested as three more
 * i18n keys in build-notes.
 */
function worldNews(
  item: Notification,
  t: (k: "worldPlayedTitle" | "worldPlayedBody") => string,
): { title: string; body: string | null } | null {
  if (!item.kind.startsWith("world_")) return null;
  const worldTitle = stringIn(item.payload, ["worldTitle", "title"]);
  if (item.kind === "world_played") {
    const plays = numberIn(item.payload, ["playCount", "plays", "count"]);
    return {
      title: t("worldPlayedTitle"),
      body: plays !== null ? `${compactNumber(plays)} ${t("worldPlayedBody")}` : (worldTitle ?? item.text),
    };
  }
  /*
   * The server's sentence usually already names the world ("Greenhouse Nine is ready to play"),
   * and repeating it underneath reads as a rendering slip rather than as detail. The name is only
   * added when the headline does not already carry it.
   */
  return { title: item.text, body: worldTitle && !item.text.includes(worldTitle) ? worldTitle : null };
}

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function NotificationRow({ item }: { item: Notification }) {
  const { t } = useT();
  const unread = item.readAt === null;
  const tint = KIND_COLOR[item.kind];
  const news = worldNews(item, t);
  return (
    <Pressable
      testID={T.notifRow(item.id)}
      onPress={() => go(item.target)}
      accessibilityRole="button"
      accessibilityLabel={
        news
          ? `${news.title}${news.body ? `. ${news.body}` : ""}, ${timeAgo(item.createdAt)}`
          : `${item.text}, ${timeAgo(item.createdAt)}`
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.md,
        paddingRight: spacing.lg,
        paddingLeft: spacing.lg - 3,
        borderLeftWidth: 3,
        borderLeftColor: unread ? tint : "transparent",
        backgroundColor: pressed ? colors.cardHi : unread ? `${tint}0F` : "transparent",
      })}
    >
      <View>
        {item.actor ? (
          <Avatar handle={item.actor.handle} size={38} dim={!unread} />
        ) : (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${tint}22`,
              borderWidth: 1,
              borderColor: `${tint}55`,
            }}
          >
            <Icon name={KIND_ICON[item.kind]} size={18} color={tint} filled />
          </View>
        )}
        <View
          style={{
            position: "absolute",
            right: -3,
            bottom: -3,
            width: 18,
            height: 18,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.bg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Icon name={KIND_ICON[item.kind]} size={10} color={tint} filled />
        </View>
      </View>

      {news ? (
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={2}
            importantForAccessibility="no"
            style={[typo.bodyStrong, { color: unread ? colors.text : colors.textDim }]}
          >
            {news.title}
          </Text>
          {news.body ? (
            <Text numberOfLines={2} importantForAccessibility="no" style={[typo.meta, { color: colors.textMuted }]}>
              {news.body}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text
          numberOfLines={2}
          importantForAccessibility="no"
          style={[typo.body, { color: unread ? colors.text : colors.textDim, flex: 1 }]}
        >
          {item.text}
        </Text>
      )}
      <Text importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted }]}>
        {timeAgo(item.createdAt)}
      </Text>
    </Pressable>
  );
}

function Empty() {
  const { t } = useT();
  return (
    <View
      testID={T.notifEmpty}
      accessibilityRole="summary"
      accessibilityLabel={t("notifEmpty")}
      style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Icon name="bell" size={28} color={colors.textMuted} />
      </View>
      <Text importantForAccessibility="no" style={[typo.meta, { color: colors.textMuted, textAlign: "center" }]}>
        {t("notifEmpty")}
      </Text>
    </View>
  );
}

export default function NotificationsScreen() {
  const { me, notifications, notifUnread, notifStatus, notifCursor, streak, streakShownFor } = useAppState();
  // The session boots asynchronously, so a direct visit (reload or deep link) mounts this screen
  // before `me.persona` exists and the loaders bail out. Re-run when the persona lands.
  const personaId = me?.persona?.id ?? null;
  const { loadNotifications, loadMoreNotifications, markNotificationsRead, loadStreak } = useActions();
  const { t, locale } = useT();

  const load = useCallback(() => {
    void loadNotifications();
    void loadStreak();
  }, [loadNotifications, loadStreak, personaId]);

  useEffect(load, [load]);
  useFocusEffect(load);

  const groups = useMemo(() => {
    const out: { day: string; rows: Notification[] }[] = [];
    for (const n of notifications) {
      const key = dayKey(n.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === key) last.rows.push(n);
      else out.push({ day: key, rows: [n] });
    }
    return out;
  }, [notifications]);

  const showStreak = streak !== null && streak.days > 0 && streakShownFor !== new Date().toISOString().slice(0, 10);

  return (
    <Screen>
      <HeaderBar
        title={t("notifications")}
        onBack={() => resetToFeed()}
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <StreakChip />
            {notifUnread > 0 ? (
              <Button
                testID={T.notifMarkAll}
                label={t("markAllRead")}
                onPress={() => void markNotificationsRead(null)}
                variant="ghost"
                compact
              />
            ) : null}
          </View>
        }
      />
      <ScrollView
        testID={T.notifList}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          if (notifCursor && layoutMeasurement.height + contentOffset.y >= contentSize.height - 240) {
            void loadMoreNotifications();
          }
        }}
        scrollEventThrottle={200}
      >
        {showStreak ? (
          <View style={{ padding: spacing.lg }}>
            <StreakCard />
          </View>
        ) : null}

        {notifStatus === "loading" && notifications.length === 0 ? (
          <SkeletonList count={6} />
        ) : notifications.length === 0 ? (
          <Empty />
        ) : (
          groups.map((group) => (
            <View key={group.day}>
              <Text
                accessibilityRole="header"
                style={[
                  typo.micro,
                  {
                    color: colors.textMuted,
                    paddingHorizontal: spacing.lg,
                    paddingTop: spacing.lg,
                    paddingBottom: spacing.sm,
                  },
                ]}
              >
                {new Date(`${group.day}T00:00:00.000Z`)
                  .toLocaleDateString(locale, { month: "short", day: "numeric" })
                  .toUpperCase()}
              </Text>
              {group.rows.map((n) => (
                <NotificationRow key={n.id} item={n} />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
