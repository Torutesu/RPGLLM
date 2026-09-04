import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  HEAT, T, colors, identityFor, layout, radius, spacing, type Post,
} from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Card, Screen } from "../../src/components/ui";
import { EnergyBadge } from "../../src/components/EnergyBadge";
import { PostCell, ReplyCell } from "../../src/components/PostCell";
import { SkeletonList } from "../../src/components/Skeleton";
import { StatCard } from "../../src/components/StatCard";
import { Toast } from "../../src/components/Toast";
// Agent H (S2): "While you were away" (SCR-038) and the shareable moment (SCR-040).
import { api, type Moment, type Trending } from "../../src/api/client";
import { DigestCard } from "../../src/components/DigestCard";
import { MomentCard } from "../../src/components/MomentCard";
import { StreakChip } from "../../src/components/StreakCard";
// Agent K (feed & discovery).
import { PostMedia } from "../../src/components/PostMedia";
import { TrendingStrip } from "../../src/components/TrendingStrip";
import { WorldChip, titleFromSlug } from "../../src/components/WorldChip";
import { heatOf, mediaOf } from "../../src/lib/derive";
import { Gradient, Icon, FadeSlideIn, typo } from "../../src/ui";
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

/** Entrance stagger, capped so a long page never animates for a second and a half. */
const STAGGER_MS = 45;
const MAX_STAGGER = 6;

/* ------------------------------------------------------------------ row ---- */

/**
 * One feed row (Agent K).
 *
 * `PostCell` (Agent J) owns how a post *looks*; this owns the rhythm around it — the procedural
 * picture roughly every fourth post, the "trending" ribbon and identity glow on a hot one, the
 * replies grouped underneath on their identity rail, and a hit target over the avatar that opens
 * the author's page (SCR-047).
 */
function FeedRow({
  post,
  replies,
  index,
  onOpenPost,
  onOpenAuthor,
}: {
  post: Post;
  replies: Post[];
  index: number;
  onOpenPost: (p: Post) => void;
  onOpenAuthor: (handle: string) => void;
}) {
  const { t } = useT();
  const media = mediaOf(post);
  const heat = heatOf(post);
  const hot = heat >= HEAT.HOT;
  const viral = heat >= HEAT.VIRAL;
  const identity = identityFor(post.author.handle);
  const inline = replies.slice(0, 2);
  const surface = post.author.isYou ? colors.bgElevated : colors.bg;

  return (
    <FadeSlideIn delay={Math.min(index, MAX_STAGGER) * STAGGER_MS}>
      <View
        style={{
          backgroundColor: surface,
          borderLeftWidth: hot ? 2 : 0,
          borderLeftColor: viral ? colors.hot : identity.from,
        }}
      >
        {hot ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              backgroundColor: `${viral ? colors.hot : colors.negative}12`,
            }}
          >
            <Icon name="flame" size={12} color={viral ? colors.hot : colors.negative} filled />
            <Text style={[typo.micro, { color: viral ? colors.hot : colors.negative }]}>
              {t("trendingNow").toUpperCase()}
            </Text>
          </View>
        ) : null}

        {/* The author's avatar is a link to their page. PostCell has no prop for it, so the hit
            target sits over the avatar rather than inside the cell. */}
        {post.author.isYou ? null : (
          <Pressable
            onPress={() => onOpenAuthor(post.author.handle)}
            accessibilityRole="button"
            accessibilityLabel={`${t("viewProfile")} — @${post.author.handle}`}
            style={{
              position: "absolute",
              left: spacing.lg,
              top: (hot ? spacing.lg + spacing.sm : spacing.lg) - 2,
              width: layout.avatarMd,
              height: layout.avatarMd,
              borderRadius: layout.avatarMd / 2,
              zIndex: 6,
            }}
          />
        )}

        <PostCell post={post} replies={[]} onPress={onOpenPost} />

        {media ? (
          <View
            style={{
              // Covers PostCell's own hairline so the picture reads as part of the post.
              marginTop: -1,
              paddingLeft: spacing.lg + layout.avatarMd + spacing.md,
              paddingRight: spacing.lg,
              paddingBottom: spacing.md,
              backgroundColor: surface,
            }}
          >
            <PostMedia postId={post.id} handle={post.author.handle} kind={media.kind} seed={media.seed} />
          </View>
        ) : null}

        {inline.length ? (
          <View
            style={{
              marginTop: media ? 0 : -1,
              paddingLeft: spacing.xxl + spacing.sm,
              paddingRight: spacing.lg,
              paddingBottom: spacing.md,
              gap: spacing.xs,
              backgroundColor: surface,
            }}
          >
            {inline.map((r) => (
              <ReplyCell key={r.id} post={r} onPress={() => onOpenPost(post)} />
            ))}
            {replies.length > inline.length ? (
              <Pressable
                onPress={() => onOpenPost(post)}
                accessibilityRole="button"
                accessibilityLabel={t("showMore")}
                style={{ paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs }}
              >
                <Text style={[typo.metaStrong, { color: colors.accent }]}>{`+${replies.length - inline.length}`}</Text>
                <Icon name="chevronRight" size={13} color={colors.accent} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={{ height: 1, backgroundColor: colors.border }} />
      </View>
    </FadeSlideIn>
  );
}

/* ---------------------------------------------------------------- screen ---- */

/** SCR-010 — home feed. */
export default function FeedScreen() {
  const {
    me, feed, feedStatus, feedCursor, liveReplies, pendingEvent, toasts, lastSnapshot, blocked,
    statCardOpen, worlds,
  } = useAppState();
  const { loadFeed, loadMoreFeed, openStatCard, clearToast, loadBlocked, loadWorlds } = useActions();
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

  // Agent K: the world chip needs the world's title, and the strip needs the trending topics.
  useEffect(() => {
    if (!worlds) void loadWorlds();
  }, [loadWorlds, worlds]);

  const [trending, setTrending] = useState<Trending | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const refreshTrending = useCallback(async () => {
    if (!personaId) return;
    try {
      setTrending(await api.trending(personaId));
    } catch {
      /* the strip is decoration: a feed without it is still a feed */
    }
  }, [personaId]);
  useEffect(() => {
    void refreshTrending();
  }, [refreshTrending, feed.length]);

  const blockedHandles = useMemo(
    () => new Set(blocked.map((b) => b.handle.replace(/^@+/, "").toLowerCase())),
    [blocked],
  );
  const isBlocked = useCallback(
    (p: Post) => blockedHandles.has(p.author.handle.replace(/^@+/, "").toLowerCase()),
    [blockedHandles],
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

  /** A topic filter keeps a post whose own text — or any of its replies — carries the phrase. */
  const matchesTopic = useCallback(
    (p: Post): boolean => {
      if (!topic) return true;
      const needle = topic.toLowerCase();
      if (p.text.toLowerCase().includes(needle)) return true;
      return repliesFor(p).some((r) => r.text.toLowerCase().includes(needle));
    },
    [topic, repliesFor],
  );

  const visibleFeed = useMemo(
    () => feed.filter((p) => !isBlocked(p) && matchesTopic(p)),
    [feed, isBlocked, matchesTopic],
  );

  useFocusEffect(
    useCallback(() => {
      void loadFeed();
    }, [loadFeed, me?.persona?.id]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      await Promise.all([loadFeed(), refreshTrending()]);
      setRefreshing(false);
    })();
  }, [loadFeed, refreshTrending]);

  const [paging, setPaging] = useState(false);
  const onEndReached = useCallback(() => {
    if (!feedCursor || paging) return;
    setPaging(true);
    void (async () => {
      await loadMoreFeed();
      setPaging(false);
    })();
  }, [feedCursor, paging, loadMoreFeed]);

  const openPost = useCallback((p: Post) => router.push({ pathname: "/post/[id]", params: { id: p.id } }), []);
  const openAuthor = useCallback(
    (handle: string) => router.push({ pathname: "/character/[handle]", params: { handle } }),
    [],
  );

  const wallet = me?.wallet;
  const worldSlug = me?.persona?.worldSlug ?? "";
  const worldTitle = useMemo(() => {
    const match = worlds?.find((w) => w.slug === worldSlug);
    return match?.title ?? (worldSlug ? titleFromSlug(worldSlug) : t("feed"));
  }, [worlds, worldSlug, t]);

  const header = (
    <View testID={T.feedHeader} style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        }}
      >
        <WorldChip title={worldTitle} slug={worldSlug || "world"} onPress={() => router.push("/explore")} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <StreakChip />
          <EnergyBadge energy={wallet?.energy ?? 0} coffee={wallet?.coffee ?? 0} onPress={() => router.push("/energy")} />
          {/* Agent G (S1-3/4): the only entry point to SCR-033. */}
          <Pressable
            testID={T.settingsBtn}
            accessibilityRole="button"
            accessibilityLabel={t("settings")}
            onPress={() => router.push("/settings")}
            hitSlop={spacing.sm}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Icon name="gear" size={20} color={colors.textDim} />
          </Pressable>
        </View>
      </View>
      <TrendingStrip
        topics={trending?.topics ?? []}
        selected={topic}
        onSelect={setTopic}
        onOpenExplore={() => router.push("/explore")}
      />
    </View>
  );

  const empty = topic ? (
    <View style={{ padding: spacing.xl }}>
      <Card tone="outline" style={{ alignItems: "center", gap: spacing.md }}>
        <Icon name="search" size={26} color={colors.textMuted} />
        <Text style={[typo.body, { color: colors.textDim, textAlign: "center" }]}>
          {`${t("trendingNow")} · ${topic}`}
        </Text>
        <Pressable onPress={() => setTopic(null)} accessibilityRole="button" accessibilityLabel={t("close")}>
          <Text style={[typo.label, { color: colors.accent }]}>{t("close")}</Text>
        </Pressable>
      </Card>
    </View>
  ) : (
    <View style={{ padding: spacing.xl }}>
      <Card style={{ alignItems: "center", gap: spacing.md, paddingVertical: spacing.xxl }}>
        <Gradient
          colors={[colors.accent, colors.hot]}
          angle={135}
          style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="sparkle" size={26} color={colors.accentInk} />
        </Gradient>
        <Text style={[typo.h2, { color: colors.text, textAlign: "center" }]}>{t("wakingUp")}</Text>
        <Text style={[typo.meta, { color: colors.textMuted, textAlign: "center" }]}>{t("planting")}</Text>
      </Card>
    </View>
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
          accessibilityLabel={pendingEvent.title}
          onPress={() => router.push({ pathname: "/event/[id]", params: { id: pendingEvent.id } })}
          style={({ pressed }) => ({
            margin: spacing.md,
            borderRadius: radius.md,
            overflow: "hidden",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Gradient colors={[`${colors.negative}33`, `${colors.hot}22`]} angle={110} style={{ padding: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
              <Icon name="flame" size={13} color={colors.negative} filled />
              <Text style={[typo.micro, { color: colors.negative }]}>{t("event").toUpperCase()}</Text>
            </View>
            <Text style={[typo.bodyStrong, { color: colors.text, marginTop: spacing.xxs }]} numberOfLines={2}>
              {pendingEvent.title}
            </Text>
          </Gradient>
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
          initialNumToRender={12}
          windowSize={11}
          removeClippedSubviews={false}
          onEndReachedThreshold={0.6}
          onEndReached={onEndReached}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
              progressBackgroundColor={colors.card}
            />
          }
          // SCR-040 rides at the top of the list rather than over it: a scrim here would sit on
          // the compose FAB and the feed cells underneath (Agent H, S2-4).
          ListHeaderComponent={
            moment ? (
              <View style={{ padding: spacing.md }}>
                <MomentCard moment={moment} onClose={() => setMoment(null)} />
              </View>
            ) : null
          }
          ListEmptyComponent={empty}
          ListFooterComponent={
            paging ? (
              <View style={{ paddingVertical: spacing.xl }}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <View style={{ height: spacing.xxxl }} />
            )
          }
          renderItem={({ item, index }) => (
            <FeedRow
              post={item}
              replies={repliesFor(item)}
              index={index}
              onOpenPost={openPost}
              onOpenAuthor={openAuthor}
            />
          )}
        />
      )}

      <StatCard />

      <Pressable
        testID={T.composeFab}
        accessibilityRole="button"
        accessibilityLabel={t("post")}
        onPress={() => router.push("/compose")}
        style={({ pressed }) => ({
          position: "absolute",
          right: spacing.lg,
          bottom: spacing.xl,
          width: 58,
          height: 58,
          borderRadius: radius.pill,
          overflow: "hidden",
          zIndex: 30,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <Gradient
          colors={[colors.accentHi, colors.hot]}
          angle={140}
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="plus" size={26} color={colors.accentInk} />
        </Gradient>
      </Pressable>
    </Screen>
  );
}
