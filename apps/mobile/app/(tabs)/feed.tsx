import React, { useCallback, useEffect, useMemo } from "react";
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

/** SCR-010 — home feed. */
export default function FeedScreen() {
  const { me, feed, feedStatus, feedCursor, liveReplies, pendingEvent, toasts, lastSnapshot } = useAppState();
  const { loadFeed, loadMoreFeed, openStatCard, clearToast } = useActions();
  const { t } = useT();

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useFocusEffect(
    useCallback(() => {
      void loadFeed();
    }, [loadFeed]),
  );

  const repliesFor = useCallback(
    (post: Post): Post[] => {
      const base = (post.replies ?? []) as Post[];
      const live = liveReplies[post.id] ?? [];
      const seen = new Set<string>();
      const out: Post[] = [];
      for (const r of [...base, ...live]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
      return out;
    },
    [liveReplies],
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
        <EnergyBadge energy={wallet?.energy ?? 0} coffee={wallet?.coffee ?? 0} onPress={() => router.push("/energy")} />
      </View>
    ),
    [wallet?.coffee, wallet?.energy],
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

      {feedStatus === "loading" && feed.length === 0 ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          testID={T.feedList}
          data={feed}
          keyExtractor={(p) => p.id}
          initialNumToRender={30}
          removeClippedSubviews={false}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (feedCursor) void loadMoreFeed();
          }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void loadFeed()} tintColor={colors.accent} />}
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
