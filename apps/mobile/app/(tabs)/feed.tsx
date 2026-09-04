import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { T, colors, font, radius, spacing, type Post } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Screen, Wordmark } from "../../src/components/ui";
import { EnergyBadge } from "../../src/components/EnergyBadge";
import { PostCell } from "../../src/components/PostCell";
import { SkeletonList } from "../../src/components/Skeleton";
import { StatCard } from "../../src/components/StatCard";
import { Toast } from "../../src/components/Toast";
// Agent H (S2): "While you were away" (SCR-038) and the shareable moment (SCR-040).
import { api, type Moment } from "../../src/api/client";
import { DigestCard } from "../../src/components/DigestCard";
import { MomentCard } from "../../src/components/MomentCard";
import { ensurePushRegistered } from "../../src/push";
import type { StatSnapshot } from "../../src/api/types";

/**
 * S2-4: a swing worth screenshotting — the same rule the server applies before it mints a card
 * (services/moment.ts): |aura| >= 5, |followers| >= 25% of the count before, or an event outcome.
 */
function isBigSwing(s: StatSnapshot): boolean {
  if (s.cause.startsWith("event:")) return true;
  if (Math.abs(s.auraDelta) >= 5) return true;
  const before = Math.max(0, s.after.followers - s.followersDelta);
  return before > 0 && Math.abs(s.followersDelta) >= before * 0.25;
}

/** SCR-010 — home feed. */
export default function FeedScreen() {
  const { me, feed, feedStatus, feedCursor, liveReplies, pendingEvent, toasts, lastSnapshot, blocked, statCardOpen } = useAppState();
  const { loadFeed, loadMoreFeed, openStatCard, clearToast, loadBlocked } = useActions();
  const { t } = useT();

  // `me` (and with it the persona) arrives after the async boot: without it in the deps a direct
  // load of /feed (deep link, reload) never fetches anything. — Agent G
  useEffect(() => {
    void loadFeed();
  }, [loadFeed, me?.persona?.id]);

  // Agent H (S2-2): onboarding is over by the time the feed mounts — ask for push here.
  // No-op on web and wherever `expo-notifications` is not wired (src/push.ts).
  const personaId = me?.persona?.id ?? null;
  useEffect(() => {
    if (personaId) ensurePushRegistered();
  }, [personaId]);

  // Agent H (S2-4): after the stat card closes on a qualifying swing, offer the share card.
  const [moment, setMoment] = useState<Moment | null>(null);
  const shownMomentFor = useRef<string | null>(null);
  useEffect(() => {
    const snapshot = lastSnapshot;
    if (!snapshot || !personaId || statCardOpen) return;
    if (shownMomentFor.current === snapshot.id || !isBigSwing(snapshot)) return;
    shownMomentFor.current = snapshot.id;
    void (async () => {
      try {
        const res = await api.moments(personaId);
        const newest = res.moments[0];
        if (newest) setMoment(newest);
      } catch {
        /* the card is a bonus; never block the feed on it */
      }
    })();
  }, [lastSnapshot, personaId, statCardOpen]);

  // Agent G (S1-2): the server filters every read, this keeps already-rendered cells honest.
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked, me?.persona?.id]);

  const blockedHandles = useMemo(
    () => new Set(blocked.map((b) => b.handle.replace(/^@+/, "").toLowerCase())),
    [blocked],
  );
  const isBlocked = useCallback(
    (p: Post) => blockedHandles.has(p.author.handle.replace(/^@+/, "").toLowerCase()),
    [blockedHandles],
  );
  const visibleFeed = useMemo(() => feed.filter((p) => !isBlocked(p)), [feed, isBlocked]);

  useFocusEffect(
    useCallback(() => {
      void loadFeed();
    }, [loadFeed, me?.persona?.id]),
  );

  const repliesFor = useCallback(
    (post: Post): Post[] => {
      const base = (post.replies ?? []) as Post[];
      const live = liveReplies[post.id] ?? [];
      const seen = new Set<string>();
      const out: Post[] = [];
      for (const r of [...base, ...live]) {
        if (seen.has(r.id) || isBlocked(r)) continue;
        seen.add(r.id);
        out.push(r);
      }
      return out;
    },
    [liveReplies, isBlocked],
  );

  const wallet = me?.wallet;
  const header = useMemo(
    () => (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Wordmark />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <EnergyBadge energy={wallet?.energy ?? 0} coffee={wallet?.coffee ?? 0} onPress={() => router.push("/energy")} />
          {/* Agent G (S1-3/4): the only entry point to SCR-033. */}
          <Pressable
            testID={T.settingsBtn}
            accessibilityRole="button"
            accessibilityLabel={t("settings")}
            onPress={() => router.push("/settings")}
            hitSlop={spacing.sm}
          >
            <Text style={{ color: colors.textMuted, fontSize: font.lg }}>⚙</Text>
          </Pressable>
        </View>
      </View>
    ),
    [t, wallet?.coffee, wallet?.energy],
  );

  return (
    <Screen>
      {header}

      {toasts.fallback ? (
        <Toast testID={T.fallbackToast} text={toasts.fallback} tone="warn" onPress={() => clearToast("fallback")} />
      ) : null}
      {toasts.stat ? (
        <Toast
          testID={T.statToast}
          text={toasts.stat}
          onPress={() => {
            if (lastSnapshot) openStatCard(lastSnapshot);
            clearToast("stat");
          }}
        />
      ) : null}
      {toasts.error ? <Toast text={toasts.error} tone="error" onPress={() => clearToast("error")} /> : null}

      {pendingEvent ? (
        <Pressable
          testID={T.eventBanner}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/event/[id]", params: { id: pendingEvent.id } })}
          style={{
            margin: spacing.md,
            padding: spacing.lg,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.negative,
            borderRadius: radius.md,
          }}
        >
          <Text style={{ color: colors.negative, fontSize: font.xs, fontWeight: "700" }}>{`🎭 ${t("event")}`}</Text>
          <Text style={{ color: colors.text, fontSize: font.md }} numberOfLines={2}>
            {pendingEvent.title}
          </Text>
        </Pressable>
      ) : null}

      {/* SCR-038 — pinned above the feed while the digest is unseen (Agent H, S2-1). */}
      <DigestCard />

      {feedStatus === "loading" && feed.length === 0 ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          testID={T.feedList}
          data={visibleFeed}
          keyExtractor={(p) => p.id}
          initialNumToRender={30}
          removeClippedSubviews={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (feedCursor) void loadMoreFeed();
          }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadFeed()} tintColor={colors.accent} />}
          // SCR-040 rides at the top of the list rather than over it: a scrim here would sit on
          // the compose FAB and the feed cells underneath (Agent H, S2-4).
          ListHeaderComponent={
            moment ? (
              <View style={{ padding: spacing.md }}>
                <MomentCard moment={moment} onClose={() => setMoment(null)} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ padding: spacing.xxl, alignItems: "center" }}>
              <Text style={{ color: colors.textMuted, fontSize: font.md }}>{t("wakingUp")}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <PostCell
              post={item}
              replies={repliesFor(item)}
              onPress={(p) => router.push({ pathname: "/post/[id]", params: { id: p.id } })}
              onReplyPress={(p) => router.push({ pathname: "/post/[id]", params: { id: item.id } })}
            />
          )}
        />
      )}

      <StatCard />

      <Pressable
        testID={T.composeFab}
        accessibilityRole="button"
        onPress={() => router.push("/compose")}
        style={{
          position: "absolute",
          right: spacing.lg,
          bottom: spacing.xl,
          width: 56,
          height: 56,
          borderRadius: radius.pill,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
          zIndex: 30,
        }}
      >
        <Text style={{ color: colors.bg, fontSize: font.lg, fontWeight: "800" }}>+</Text>
      </Pressable>

    </Screen>
  );
}
