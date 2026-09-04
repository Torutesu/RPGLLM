import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import type { Achievement } from "../api/client";
import { Gradient, Icon, typo } from "../ui";
import { useT } from "../state/store";

/**
 * One achievement tile (SCR-044).
 *
 * Tier is the whole visual language here: bronze is a quiet card, legendary is a gradient with a
 * crown. A locked tile still shows its icon — dimmed, with the progress bar underneath — because a
 * grid of grey boxes tells you nothing about what to chase next.
 */
export type Tier = Achievement["tier"];

const TIER: Record<Tier, { from: string; to: string; ink: string }> = {
  bronze: { from: "#C98A4B", to: "#7A4E24", ink: colors.coffee },
  silver: { from: "#C8CEE0", to: "#7B85A0", ink: "#C8CEE0" },
  gold: { from: colors.energy, to: colors.negative, ink: colors.energy },
  legendary: { from: colors.hot, to: colors.accent, ink: colors.hot },
};

const TIER_ICON: Record<Tier, "shield" | "check" | "trophy" | "crown"> = {
  bronze: "shield",
  silver: "check",
  gold: "trophy",
  legendary: "crown",
};

export function AchievementCard({ item, onPress }: { item: Achievement; onPress?: () => void }) {
  const { t, locale } = useT();
  const tier = TIER[item.tier];
  const unlocked = item.unlockedAt !== null;
  const pct = Math.round(Math.max(0, Math.min(1, item.progress)) * 100);
  const date = unlocked ? new Date(item.unlockedAt as string).toLocaleDateString(locale) : null;

  const body = (
    <View
      style={{
        flex: 1,
        minHeight: 148,
        borderRadius: radius.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: unlocked ? `${tier.ink}66` : colors.border,
        backgroundColor: unlocked ? colors.cardHi : colors.card,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      {unlocked ? (
        <Gradient
          colors={[`${tier.from}33`, `${tier.to}11`]}
          angle={135}
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        />
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text
          importantForAccessibility="no"
          style={{ fontSize: font.xl, opacity: unlocked ? 1 : 0.28 }}
        >
          {item.icon}
        </Text>
        <Icon
          name={unlocked ? TIER_ICON[item.tier] : "lock"}
          size={15}
          color={unlocked ? tier.ink : colors.textMuted}
          filled={unlocked}
        />
      </View>

      <Text numberOfLines={2} style={[typo.label, { color: unlocked ? colors.text : colors.textDim }]}>
        {item.title}
      </Text>
      <Text numberOfLines={2} style={[typo.caption, { color: colors.textMuted, flex: 1 }]}>
        {item.description}
      </Text>

      {unlocked ? (
        <Text style={[typo.micro, { color: tier.ink }]}>
          {`${t("unlocked")} · ${date ?? ""}`}
        </Text>
      ) : (
        <View style={{ gap: spacing.xxs }}>
          <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: colors.bgElevated, overflow: "hidden" }}>
            <View style={{ width: `${pct}%`, height: 4, borderRadius: radius.pill, backgroundColor: colors.accent }} />
          </View>
          <Text style={[typo.micro, { color: colors.textMuted }]}>{`${pct}%`}</Text>
        </View>
      )}
    </View>
  );

  const label = `${item.title}. ${item.description}. ${unlocked ? t("unlocked") : `${t("locked")} ${pct}%`}`;
  if (!onPress) {
    return (
      <View testID={T.achievement(item.key)} accessibilityRole="summary" accessibilityLabel={label} style={{ flex: 1 }}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={T.achievement(item.key)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1 })}
    >
      {body}
    </Pressable>
  );
}
