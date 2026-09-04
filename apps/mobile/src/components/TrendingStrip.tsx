import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { HEAT, T, colors, radius, spacing } from "@rpgllm/shared";
import { Icon, typo } from "../ui";
import { useT } from "../i18n/useT";
import type { Trending } from "../api/client";

export type Topic = Trending["topics"][number];

/** Hot enough to burn, warm enough to notice, or just a thing people said twice. */
function toneFor(heat: number): { fg: string; bg: string; border: string; flame: boolean } {
  if (heat >= HEAT.VIRAL) return { fg: colors.hot, bg: `${colors.hot}1F`, border: `${colors.hot}66`, flame: true };
  if (heat >= HEAT.HOT) return { fg: colors.negative, bg: `${colors.negative}1A`, border: `${colors.negative}55`, flame: true };
  return { fg: colors.textDim, bg: colors.card, border: colors.border, flame: false };
}

/**
 * The trending rail under the feed header (Agent K).
 *
 * Six words that tell you what this world is arguing about today, coloured by how hot each one is.
 * Tapping one filters the feed to the posts carrying it — the cheapest way to make a generated
 * timeline feel like it has weather.
 */
export function TrendingStrip({
  topics,
  selected,
  onSelect,
  onOpenExplore,
}: {
  topics: readonly Topic[];
  selected: string | null;
  onSelect: (label: string | null) => void;
  onOpenExplore?: () => void;
}) {
  const { t } = useT();
  if (topics.length === 0) return null;
  return (
    <View
      testID={T.trendingList}
      style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginRight: spacing.xs }}>
          <Icon name="flame" size={13} color={colors.textMuted} />
          <Text style={[typo.micro, { color: colors.textMuted }]}>{t("trendingNow").toUpperCase()}</Text>
        </View>
        {topics.map((topic) => {
          const active = selected === topic.label;
          const tone = toneFor(topic.heat);
          return (
            <Pressable
              key={topic.label}
              testID={T.trendingTopic(topic.label)}
              onPress={() => onSelect(active ? null : topic.label)}
              accessibilityRole="button"
              accessibilityLabel={`${topic.label} — ${topic.posts} ${t("posts")}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs + 1,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: active ? colors.accent : tone.border,
                backgroundColor: active ? `${colors.accent}26` : pressed ? colors.cardHi : tone.bg,
              })}
            >
              {tone.flame ? <Icon name="flame" size={12} color={tone.fg} filled /> : null}
              <Text numberOfLines={1} style={[typo.label, { color: active ? colors.accentHi : tone.fg, maxWidth: 160 }]}>
                {topic.label}
              </Text>
              <Text style={[typo.count, { color: colors.textMuted }]}>{topic.posts}</Text>
            </Pressable>
          );
        })}
        {onOpenExplore ? (
          <Pressable
            onPress={onOpenExplore}
            accessibilityRole="button"
            accessibilityLabel={t("explore")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs + 1,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.cardHi : "transparent",
            })}
          >
            <Text style={[typo.label, { color: colors.accent }]}>{t("explore")}</Text>
            <Icon name="chevronRight" size={13} color={colors.accent} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
