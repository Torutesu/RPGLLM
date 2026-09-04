import React, { useCallback, useEffect, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import type { Achievement } from "../src/api/client";
import { AchievementCard, type Tier } from "../src/components/AchievementCard";
import { StreakChip } from "../src/components/StreakCard";
import { SkeletonList } from "../src/components/Skeleton";
import { HeaderBar, Screen } from "../src/components/ui";
import { Icon, typo } from "../src/ui";
import { resetToFeed } from "../src/nav";
import { useActions, useAppState, useT } from "../src/state/store";

/**
 * SCR-044 — achievements.
 *
 * A grid by tier, because a collection you can see the shape of is a collection you want to
 * finish. Locked tiles keep their icon and show how far along they are; loading the screen also
 * pops the celebration for anything unlocked but never seen.
 */
const ORDER: readonly Tier[] = ["legendary", "gold", "silver", "bronze"];
const TIER_LABEL: Record<Tier, string> = {
  legendary: "Legendary",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};

export default function AchievementsScreen() {
  const { me, achievements, achievementsStatus, streak } = useAppState();
  // Same as notifications: the loaders need `me.persona`, which arrives after mount on a direct visit.
  const personaId = me?.persona?.id ?? null;
  const { loadAchievements, loadStreak } = useActions();
  const { t } = useT();

  const load = useCallback(() => {
    void loadAchievements();
    if (!streak) void loadStreak();
  }, [loadAchievements, loadStreak, streak, personaId]);

  useEffect(load, [load]);
  useFocusEffect(load);

  const byTier = useMemo(() => {
    const map = new Map<Tier, Achievement[]>();
    for (const tier of ORDER) map.set(tier, []);
    for (const a of achievements?.achievements ?? []) map.get(a.tier as Tier)?.push(a);
    // Unlocked first inside a tier, then the closest to unlocking.
    for (const rows of map.values()) {
      rows.sort((x, y) => Number(y.unlockedAt !== null) - Number(x.unlockedAt !== null) || y.progress - x.progress);
    }
    return map;
  }, [achievements]);

  const unlocked = achievements?.unlocked ?? 0;
  const total = achievements?.total ?? 0;
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  return (
    <Screen>
      <HeaderBar title={t("achievements")} onBack={() => resetToFeed()} right={<StreakChip />} />
      <ScrollView testID={T.achievementsList} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl }}>
        <View
          accessibilityRole="summary"
          accessibilityLabel={`${unlocked} / ${total} ${t("unlocked")}`}
          style={{
            flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
            borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
          }}
        >
          <Icon name="trophy" size={26} color={colors.energy} filled />
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text importantForAccessibility="no" style={[typo.number, { color: colors.text }]}>
              {`${unlocked} / ${total}`}
            </Text>
            <View style={{ height: 5, borderRadius: radius.pill, backgroundColor: colors.bgElevated, overflow: "hidden" }}>
              <View style={{ width: `${pct}%`, height: 5, borderRadius: radius.pill, backgroundColor: colors.energy }} />
            </View>
          </View>
        </View>

        {achievementsStatus === "loading" && !achievements ? (
          <SkeletonList count={4} />
        ) : (
          ORDER.map((tier) => {
            const rows = byTier.get(tier) ?? [];
            if (rows.length === 0) return null;
            return (
              <View key={tier} style={{ gap: spacing.sm }}>
                <Text accessibilityRole="header" style={[typo.micro, { color: colors.textMuted }]}>
                  {TIER_LABEL[tier].toUpperCase()}
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {rows.map((item) => (
                    <View key={item.key} style={{ width: "48%", minWidth: 150, flexGrow: 1 }}>
                      <AchievementCard item={item} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}
