import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePathname } from "expo-router";
import { T, colors, compactNumber, font, gradients, layout, radius, spacing } from "@rpgllm/shared";
import { AnimatedNumber, Burst, FadeSlideIn, Gradient, Icon, Pulse, typo } from "../ui";
import { useActions, useAppState, useT } from "../state/store";
import { StreakCard } from "./StreakCard";
import { Button } from "./ui";

/**
 * SCR-045 — the celebration moment.
 *
 * A level up, a follower milestone or an achievement earns three seconds of the whole screen: a
 * gradient wash, the number rolling up, a burst, and one line of copy. Three rules keep it from
 * ever becoming an obstacle:
 *   1. **one tap anywhere on the card closes it**, and it auto-retires after `AUTO_MS`;
 *   2. the backdrop is `box-none`, so taps outside the card fall through to the screen underneath;
 *   3. it is suppressed while SCR-013's stat card is up, so two moments never stack.
 */
const AUTO_MS = 2600;

export function Celebration() {
  const { celebration, statCardOpen } = useAppState();
  const { dismissCelebration } = useActions();
  const { t } = useT();
  const [burst, setBurst] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visible = celebration !== null && !statCardOpen;

  useEffect(() => {
    if (!visible) return;
    setBurst((n) => n + 1);
    timer.current = setTimeout(dismissCelebration, AUTO_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [visible, celebration, dismissCelebration]);

  if (!visible || !celebration) return null;

  const kind = celebration.kind;
  const title =
    kind === "level" ? t("levelUp") : kind === "milestone" ? t("milestone") : t("newAchievement");
  const headline =
    kind === "achievement" ? celebration.title : kind === "level" ? `${t("level")} ${celebration.value}` : compactNumber(celebration.value);
  const subtitle =
    kind === "milestone" ? `${t("youReached")} ${compactNumber(celebration.value)} ${t("followers")}` : t("keepGoing");
  const palette = kind === "level" ? gradients.win : kind === "milestone" ? gradients.brand : gradients.gold;

  return (
    // box-none: only the card itself takes touches, so a stray tap never blocks the screen below.
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: spacing.xl }}
    >
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.overlay }} />
      <FadeSlideIn distance={18}>
        <Pressable
          testID={T.celebration}
          onPress={dismissCelebration}
          accessibilityRole="button"
          accessibilityLabel={`${title}. ${headline}. ${subtitle}`}
          accessibilityLiveRegion="polite"
          style={{ width: "100%", maxWidth: 360, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1, borderColor: colors.borderHi }}
        >
          <Gradient colors={palette} angle={150} pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, opacity: 0.24 }} />
          <View style={{ padding: spacing.xl, gap: spacing.md, alignItems: "center", backgroundColor: "rgba(20,20,31,0.86)" }}>
            <View style={{ alignItems: "center", justifyContent: "center", height: 72 }}>
              <Burst trigger={burst} color={kind === "level" ? colors.positive : colors.hot} size={64} />
              <Pulse scaleTo={1.08}>
                {kind === "achievement" ? (
                  <Text importantForAccessibility="no" style={{ fontSize: font.display }}>
                    {celebration.icon}
                  </Text>
                ) : (
                  <Icon name={kind === "level" ? "sparkle" : "crown"} size={44} color={kind === "level" ? colors.positive : colors.energy} filled />
                )}
              </Pulse>
            </View>

            <Text importantForAccessibility="no" style={[typo.micro, { color: colors.textDim }]}>
              {title.toUpperCase()}
            </Text>

            {kind === "achievement" ? (
              <Text testID={T.celebrationTitle} importantForAccessibility="no" numberOfLines={2} style={[typo.title, { color: colors.text, textAlign: "center" }]}>
                {headline}
              </Text>
            ) : (
              <View testID={T.celebrationTitle}>
                <AnimatedNumber
                  value={celebration.value}
                  format={kind === "milestone" ? compactNumber : String}
                  style={[typo.hero, { color: colors.text }]}
                />
              </View>
            )}

            <Text importantForAccessibility="no" style={[typo.meta, { color: colors.textDim, textAlign: "center" }]}>
              {subtitle}
            </Text>

            <Button testID={T.celebrationClose} label={t("close")} onPress={dismissCelebration} variant="secondary" compact />
          </View>
        </Pressable>
      </FadeSlideIn>
    </View>
  );
}

/**
 * The achievement-unlock variant kept under its own testids so the E2E suite can tell the two
 * apart when both are wired to the same overlay.
 */
export function AchievementUnlockBadge({ icon, title, onClose }: { icon: string; title: string; onClose: () => void }) {
  const { t } = useT();
  return (
    <View
      testID={T.achievementUnlock}
      accessibilityRole="summary"
      accessibilityLabel={`${t("newAchievement")}: ${title}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        padding: spacing.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.energy,
        backgroundColor: colors.cardHi,
      }}
    >
      <Text importantForAccessibility="no" style={{ fontSize: font.xl }}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[typo.micro, { color: colors.energy }]}>{t("newAchievement").toUpperCase()}</Text>
        <Text numberOfLines={1} style={[typo.label, { color: colors.text }]}>{title}</Text>
      </View>
      <Button testID={T.achievementUnlockClose} label={t("close")} onPress={onClose} variant="ghost" compact />
    </View>
  );
}

/**
 * The app-wide engagement layer, mounted once in `app/_layout.tsx`.
 *
 * It carries the celebration and the once-a-day streak card. The streak card is deliberately
 * conservative: it only appears **over the feed**, only for a streak the player has actually built
 * (day 2+ — day 1 is still onboarding), it retires itself after `STREAK_MS`, and its container is
 * `box-none` so it never swallows a tap meant for the feed underneath.
 */
const STREAK_MS = 6000;

export function EngagementOverlay() {
  const { me, streak, streakShownFor, statCardOpen } = useAppState();
  const { loadStreak } = useActions();
  const pathname = usePathname();

  const personaId = me?.persona?.id ?? null;
  useEffect(() => {
    if (!personaId) return;
    void loadStreak();
  }, [personaId, loadStreak]);

  const today = new Date().toISOString().slice(0, 10);
  const onFeed = pathname === "/feed" || pathname === "/(tabs)/feed";
  const showStreak =
    onFeed && !statCardOpen && streak !== null && streak.days >= 2 && streakShownFor !== today;

  return (
    <>
      {showStreak ? (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: spacing.lg,
            right: spacing.lg,
            top: layout.headerHeight + spacing.md,
          }}
        >
          <StreakCard autoHideMs={STREAK_MS} />
        </View>
      ) : null}
      <Celebration />
    </>
  );
}
