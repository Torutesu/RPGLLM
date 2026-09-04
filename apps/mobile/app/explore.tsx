import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { HEAT, T, colors, compactNumber, identityFor, layout, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../src/state/store";
import { Card, HeaderBar, Screen, SectionHeader } from "../src/components/ui";
import { Avatar } from "../src/components/Avatar";
import { titleFromSlug } from "../src/components/WorldChip";
import { api, type Trending } from "../src/api/client";
import { AnimatedNumber, FadeSlideIn, Gradient, Icon, typo } from "../src/ui";

/**
 * SCR-046 — Explore (Agent K).
 *
 * Where a session goes when the feed is exhausted. Three questions it answers: what is this world
 * arguing about, who is moving toward me, and how big am I here — plus the other worlds, so
 * "there is nothing left to do" turns into "start a second story" instead of a close.
 */

const heatTone = (heat: number): string =>
  heat >= HEAT.VIRAL ? colors.hot : heat >= HEAT.HOT ? colors.negative : colors.accent;

function RankCard({ rank, worldTitle }: { rank: Trending["yourRank"]; worldTitle: string }) {
  const { t } = useT();
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <Card
        tone="elevated"
        glowColor={rank.trending ? `${colors.hot}66` : undefined}
        style={{ overflow: "hidden" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, gap: spacing.xxs }}>
            <Text style={[typo.micro, { color: colors.textMuted }]}>{t("yourRank").toUpperCase()}</Text>
            <View
              testID={T.trendingRank}
              accessibilityRole="text"
              accessibilityLabel={`${t("topPercent")} ${rank.percentile}% — ${worldTitle}`}
              style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}
            >
              <Text style={[typo.meta, { color: colors.textDim, marginRight: spacing.xxs }]}>{t("topPercent")}</Text>
              <Text style={[typo.title, { color: colors.text }]}>{`${rank.percentile}%`}</Text>
            </View>
            <Text style={[typo.meta, { color: colors.textDim }]} numberOfLines={1}>
              {worldTitle}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: spacing.xxs }}>
            <Text style={[typo.micro, { color: colors.textMuted }]}>{t("followers").toUpperCase()}</Text>
            <AnimatedNumber
              value={rank.followers}
              format={compactNumber}
              label={`${rank.followers} ${t("followers")}`}
              style={[typo.number, { color: colors.text }]}
            />
          </View>
        </View>
        {rank.trending ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              marginTop: spacing.md,
              alignSelf: "flex-start",
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              borderRadius: radius.pill,
              backgroundColor: `${colors.hot}22`,
              borderWidth: 1,
              borderColor: `${colors.hot}55`,
            }}
          >
            <Icon name="flame" size={13} color={colors.hot} filled />
            <Text style={[typo.label, { color: colors.hot }]}>{t("youAreTrending")}</Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

function TopicCard({
  topic,
  index,
  onPress,
}: {
  topic: Trending["topics"][number];
  index: number;
  onPress: () => void;
}) {
  const { t } = useT();
  const tone = heatTone(topic.heat);
  return (
    <FadeSlideIn delay={index * 40}>
      <Pressable
        testID={T.trendingTopic(topic.label)}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${topic.label} — ${topic.posts} ${t("posts")}`}
        style={({ pressed }) => ({
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
          borderRadius: radius.md,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: pressed ? tone : colors.border,
          backgroundColor: colors.card,
        })}
      >
        <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg, gap: spacing.md }}>
          <Text style={[typo.number, { color: colors.textMuted, width: 26 }]}>{index + 1}</Text>
          <View style={{ flex: 1, gap: spacing.xxs }}>
            <Text numberOfLines={1} style={[typo.h2, { color: colors.text }]}>
              {topic.label}
            </Text>
            <Text style={[typo.meta, { color: colors.textMuted }]}>
              {`${topic.posts} ${t("posts")}`}
            </Text>
          </View>
          {topic.heat >= HEAT.HOT ? <Icon name="flame" size={18} color={tone} filled /> : null}
          <Icon name="chevronRight" size={16} color={colors.textMuted} />
        </View>
        {/* The heat bar: how loud this is, at a glance, without a number. */}
        <View style={{ height: 3, backgroundColor: colors.bgElevated }}>
          <Gradient
            colors={[tone, `${tone}33`]}
            angle={90}
            style={{ height: 3, width: `${Math.max(6, Math.min(100, topic.heat))}%` }}
          />
        </View>
      </Pressable>
    </FadeSlideIn>
  );
}

function RisingRail({ rising }: { rising: Trending["risingCharacters"] }) {
  const { t } = useT();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md, paddingVertical: spacing.xs }}
    >
      {rising.map((r) => {
        const up = r.delta > 0;
        const flat = r.delta === 0;
        const tone = flat ? colors.textMuted : up ? colors.positive : colors.negative;
        return (
          <Pressable
            key={r.handle}
            testID={T.risingCharacter(r.handle)}
            onPress={() => router.push({ pathname: "/character/[handle]", params: { handle: r.handle } })}
            accessibilityRole="button"
            accessibilityLabel={`${r.displayName} @${r.handle} — ${r.affinity}`}
            style={({ pressed }) => ({ width: 88, alignItems: "center", gap: spacing.xs, opacity: pressed ? 0.7 : 1 })}
          >
            <Avatar handle={r.handle} size={layout.avatarLg} ring />
            <Text numberOfLines={1} style={[typo.metaStrong, { color: colors.text, maxWidth: 88 }]}>
              {r.displayName}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Icon name={up ? "sparkle" : flat ? "clock" : "flame"} size={11} color={tone} />
              <Text style={[typo.count, { color: tone }]}>
                {flat ? `${r.affinity}` : `${up ? "+" : ""}${r.delta}`}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {rising.length === 0 ? (
        <Text style={[typo.meta, { color: colors.textMuted }]}>{t("wakingUp")}</Text>
      ) : null}
    </ScrollView>
  );
}

export default function ExploreScreen() {
  const { me, worlds } = useAppState();
  const { loadWorlds } = useActions();
  const { t } = useT();
  const personaId = me?.persona?.id ?? null;
  const [trending, setTrending] = useState<Trending | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!personaId) return;
    try {
      setTrending(await api.trending(personaId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!worlds) void loadWorlds();
  }, [loadWorlds, worlds]);

  const worldSlug = me?.persona?.worldSlug ?? "";
  const worldTitle = useMemo(() => {
    const match = worlds?.find((w) => w.slug === worldSlug);
    return match?.title ?? (worldSlug ? titleFromSlug(worldSlug) : "");
  }, [worlds, worldSlug]);
  const otherWorlds = useMemo(() => (worlds ?? []).filter((w) => w.slug !== worldSlug), [worlds, worldSlug]);

  return (
    <Screen>
      <HeaderBar title={t("explore")} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        {trending ? <RankCard rank={trending.yourRank} worldTitle={worldTitle} /> : null}

        <SectionHeader title={t("trendingNow")} />
        <View testID={T.trendingList}>
          {(trending?.topics ?? []).map((topic, i) => (
            <TopicCard
              key={topic.label}
              topic={topic}
              index={i}
              onPress={() => {
                if (topic.postId) router.push({ pathname: "/post/[id]", params: { id: topic.postId } });
                else router.push("/feed");
              }}
            />
          ))}
          {trending && trending.topics.length === 0 ? (
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Card tone="outline" style={{ alignItems: "center", gap: spacing.sm }}>
                <Icon name="search" size={22} color={colors.textMuted} />
                <Text style={[typo.meta, { color: colors.textMuted, textAlign: "center" }]}>
                  {failed ? t("loadFailed") : t("wakingUp")}
                </Text>
              </Card>
            </View>
          ) : null}
        </View>

        <SectionHeader title={t("rising")} />
        <RisingRail rising={trending?.risingCharacters ?? []} />

        <SectionHeader title={t("pickStory")} />
        {otherWorlds.map((w) => {
          const identity = identityFor(w.slug);
          return (
            <Pressable
              key={w.id}
              onPress={() => router.push("/onboarding/scenario")}
              accessibilityRole="button"
              accessibilityLabel={`${w.title} — ${w.scenario}`}
              style={({ pressed }) => ({
                marginHorizontal: spacing.lg,
                marginBottom: spacing.sm,
                borderRadius: radius.md,
                overflow: "hidden",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Gradient
                colors={[`${identity.from}44`, `${identity.to}18`]}
                angle={120}
                style={{ padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}
              >
                <Text style={[typo.h2, { color: colors.text }]} numberOfLines={1}>
                  {w.title}
                </Text>
                <Text style={[typo.meta, { color: colors.textDim, marginTop: spacing.xxs }]} numberOfLines={2}>
                  {w.scenario}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md }}>
                  <Icon name="plus" size={13} color={colors.accentHi} />
                  <Text style={[typo.label, { color: colors.accentHi }]}>{t("enterWorld")}</Text>
                </View>
              </Gradient>
            </Pressable>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
