import React, { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { T, colors, font, gradients, radius, spacing } from "@rpgllm/shared";
import { AnimatedNumber, Gradient, Icon, Pulse, typo } from "../ui";
import { useActions, useAppState, useT } from "../state/store";
import { Button } from "./ui";

/**
 * Daily streak (SCR-010).
 *
 * The flame is the cheapest retention mechanic there is: a number that only survives if you come
 * back tomorrow. `StreakChip` is the always-on reminder; `StreakCard` is the once-a-day payout.
 */

const flameColor = (days: number): string =>
  days >= 7 ? colors.hot : days >= 3 ? colors.negative : colors.energy;

/** Compact flame + day count. Belongs in the feed header, and sits in every engagement header. */
export function StreakChip({ onPress }: { onPress?: () => void }) {
  const { streak } = useAppState();
  const { t } = useT();
  const days = streak?.days ?? 0;
  if (days <= 0) return null;
  const label = `${days} ${t("dayStreak")}`;
  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: `${flameColor(days)}22`,
        borderWidth: 1,
        borderColor: `${flameColor(days)}55`,
      }}
    >
      <Pulse active={days >= 3} scaleTo={1.12}>
        <Icon name="flame" size={13} color={flameColor(days)} filled />
      </Pulse>
      <Text importantForAccessibility="no" style={[typo.count, { color: flameColor(days) }]}>
        {days}
      </Text>
    </View>
  );
  if (!onPress) {
    return (
      <View testID={T.streakChip} accessibilityRole="text" accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable testID={T.streakChip} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={spacing.sm}>
      {body}
    </Pressable>
  );
}

function Rung({ row, today }: { row: { day: number; energy: number; coffee: number; gems: number; reached: boolean }; today: boolean }) {
  const tint = today ? colors.energy : row.reached ? colors.positive : colors.textMuted;
  return (
    <View
      testID={T.streakLadderDay(row.day)}
      accessibilityRole="text"
      accessibilityLabel={`Day ${row.day}: ${row.energy} energy${row.coffee ? `, ${row.coffee} coffee` : ""}${row.gems ? `, ${row.gems} gems` : ""}`}
      style={{
        alignItems: "center",
        gap: spacing.xxs,
        minWidth: 44,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: today ? colors.energy : row.reached ? colors.borderHi : colors.border,
        backgroundColor: today ? `${colors.energy}1A` : row.reached ? colors.cardHi : "transparent",
      }}
    >
      <Text importantForAccessibility="no" style={[typo.micro, { color: tint }]}>{row.day}</Text>
      <Icon name={row.gems > 0 ? "gem" : row.coffee > 0 ? "coffee" : "bolt"} size={15} color={tint} filled={row.reached} />
      <Text importantForAccessibility="no" style={[typo.count, { color: row.reached ? colors.text : colors.textMuted }]}>
        {row.gems > 0 ? row.gems : row.coffee > 0 ? row.coffee : row.energy}
      </Text>
    </View>
  );
}

/**
 * The payout card. Dismissible, cheap and never modal: it sits above the feed, auto-retires after
 * `autoHideMs`, and any tap closes it. It must never stand between the player and the composer.
 */
export function StreakCard({ onClose, autoHideMs = 0 }: { onClose?: () => void; autoHideMs?: number }) {
  const { streak } = useAppState();
  const { dismissStreak } = useActions();
  const { t } = useT();

  const close = React.useCallback(() => {
    dismissStreak();
    onClose?.();
  }, [dismissStreak, onClose]);

  useEffect(() => {
    if (autoHideMs <= 0) return;
    const id = setTimeout(close, autoHideMs);
    return () => clearTimeout(id);
  }, [autoHideMs, close]);

  if (!streak || streak.days <= 0) return null;
  const reward = streak.reward ?? { energy: 0, coffee: 0, gems: 0 };

  return (
    <View
      testID={T.streakCard}
      accessibilityRole="summary"
      accessibilityLabel={`${streak.days} ${t("dayStreak")}`}
      style={{
        borderRadius: radius.lg,
        overflow: "hidden",
        borderWidth: 1,
        borderColor: colors.borderHi,
        backgroundColor: colors.card,
      }}
    >
      <Gradient
        colors={streak.days >= 7 ? gradients.gold : gradients.brand}
        angle={120}
        pointerEvents="none"
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: 96, opacity: 0.22 }}
      />
      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pulse scaleTo={1.1}>
            <Icon name="flame" size={30} color={flameColor(streak.days)} filled />
          </Pulse>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
              <AnimatedNumber
                testID={T.streakDays}
                value={streak.days}
                label={`${streak.days} ${t("dayStreak")}`}
                style={[typo.display, { color: colors.text, fontSize: font.xxl }]}
              />
              <Text importantForAccessibility="no" style={[typo.label, { color: colors.textDim }]}>
                {t("dayStreak")}
              </Text>
            </View>
            <Text style={[typo.meta, { color: colors.textMuted }]}>
              {`${t("streakBest")} ${streak.best} · ${t("comeBackTomorrow")}`}
            </Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {streak.ladder.map((row) => (
            <Rung key={row.day} row={row} today={row.day === Math.min(streak.days, streak.ladder.length)} />
          ))}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
            <Reward icon="bolt" value={reward.energy} color={colors.energy} />
            <Reward icon="coffee" value={reward.coffee} color={colors.coffee} />
            <Reward icon="gem" value={reward.gems} color={colors.gem} />
          </View>
          <Button
            testID={T.streakClaim}
            label={streak.claimedToday ? t("claimed") : t("checkIn")}
            onPress={close}
            variant={streak.claimedToday ? "secondary" : "primary"}
            compact
          />
        </View>
      </View>
    </View>
  );
}

function Reward({ icon, value, color }: { icon: "bolt" | "coffee" | "gem"; value: number; color: string }) {
  if (value <= 0) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxs }}>
      <Icon name={icon} size={14} color={color} filled />
      <AnimatedNumber value={value} style={[typo.count, { color: colors.text }]} />
    </View>
  );
}
