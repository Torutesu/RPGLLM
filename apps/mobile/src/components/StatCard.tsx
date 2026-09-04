import React, { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Text, View } from "react-native";
import { T, colors, compactNumber, elevation, gradients, layout, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../state/store";
import { Avatar } from "./Avatar";
import { Button } from "./ui";
import { AnimatedNumber, FadeSlideIn, Gradient, Icon, duration, ease, typo, useAnimatedValue, useHaptic, useReduceMotion, type IconName } from "../ui";

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

function toneOf(delta: number): string {
  return delta > 0 ? colors.positive : delta < 0 ? colors.negative : colors.textMuted;
}

/** Up, down or flat — the arrow does the work the colour alone cannot for colour-blind players. */
function arrowFor(delta: number): IconName {
  return delta > 0 ? "arrowUp" : delta < 0 ? "arrowDown" : "minus";
}

/** A 0–100 stat as a bar that grows from where it was to where it is. */
function Bar({ from, to, label, tone }: { from: number; to: number; label: string; tone: string }) {
  const anim = useAnimatedValue(Math.max(0, Math.min(100, from)));
  const reduce = useReduceMotion();
  useEffect(() => {
    const target = Math.max(0, Math.min(100, to));
    if (reduce) {
      anim.setValue(target);
      return;
    }
    const run = Animated.timing(anim, {
      toValue: target,
      duration: duration.slow * 2,
      easing: ease.out,
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [anim, to, reduce]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(to) }}
      style={{
        height: 8,
        backgroundColor: colors.bgElevated,
        borderRadius: radius.pill,
        overflow: "hidden",
        marginTop: spacing.sm,
      }}
    >
      <Animated.View style={{ height: 8, width }}>
        <Gradient colors={[tone, `${tone}88`]} angle={90} style={{ flex: 1, borderRadius: radius.pill }} />
      </Animated.View>
    </View>
  );
}

/**
 * The testid'd node keeps its exact "+5 → 25" text (E2E reads it); the accessible name prefixes
 * the stat it belongs to, so a screen reader says "Aura +5, 25" instead of a bare number.
 * (i18n has no localized "up"/"down" wording yet — see build-notes "Agent I".)
 */
function StatRow({
  testID,
  label,
  delta,
  after,
  bar,
  index,
}: {
  testID: string;
  label: string;
  delta: number;
  after: number;
  bar?: boolean;
  index: number;
}) {
  const tone = toneOf(delta);
  return (
    <FadeSlideIn delay={120 + index * 90} style={{ marginBottom: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md }}>
        <Text importantForAccessibility="no" style={[typo.metaStrong, { color: colors.textDim }]}>
          {label}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Icon name={arrowFor(delta)} size={14} color={tone} />
          <Text testID={testID} accessibilityLabel={`${label} ${signed(delta)}, ${after}`} style={[typo.metaStrong, { color: tone }]}>
            {`${signed(delta)} → ${after}`}
          </Text>
        </View>
      </View>
      {bar ? <Bar from={after - delta} to={after} label={label} tone={delta === 0 ? colors.accent : tone} /> : null}
    </FadeSlideIn>
  );
}

/**
 * SCR-013 — opens on the `stat` stream event and after an event choice.
 * Rendered as a bottom sheet with no blocking backdrop so the feed above stays interactive.
 *
 * This is the payoff screen of the whole loop, so it gets the loudest treatment in the app: the
 * follower count counts up from where it was, the bars grow, and the cast that changed its mind
 * about you is shown as faces rather than a list of handles.
 */
export function StatCard() {
  const { statCardOpen, lastSnapshot } = useAppState();
  const { closeStatCard } = useActions();
  const { t } = useT();
  const haptic = useHaptic();
  const s = lastSnapshot;
  const open = statCardOpen && s !== null;
  const [followers, setFollowers] = useState(0);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !s) return;
    setFollowers(s.after.followers - s.followersDelta);
    const id = setTimeout(() => setFollowers(s.after.followers), 260);
    if (announced.current !== s.id) {
      announced.current = s.id;
      haptic(s.followersDelta >= 0 ? "success" : "warning");
    }
    return () => clearTimeout(id);
  }, [open, s, haptic]);

  if (!open || !s) return null;
  const rel = Object.entries(s.relDeltas ?? {});
  const tone = toneOf(s.followersDelta);

  return (
    <View
      testID={T.statCard}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[
        {
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: "72%",
          backgroundColor: colors.bgElevated,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          borderWidth: 1,
          borderBottomWidth: 0,
          borderColor: colors.borderHi,
          overflow: "hidden",
          zIndex: 20,
        },
        elevation.high,
      ]}
    >
      <Gradient
        colors={s.followersDelta >= 0 ? [...gradients.win] : [...gradients.lose]}
        angle={90}
        pointerEvents="none"
        style={{ height: 3 }}
      />
      <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.md }}>
        <FadeSlideIn>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginBottom: spacing.lg }}>
            <AnimatedNumber
              value={followers}
              format={compactNumber}
              style={[typo.display, { color: colors.text }]}
              label={`${t("followers")} ${s.after.followers}`}
            />
            <View style={{ paddingBottom: spacing.sm, gap: 2 }}>
              <Text style={[typo.micro, { color: colors.textMuted }]}>{t("followers").toUpperCase()}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxs }}>
                <Icon name={arrowFor(s.followersDelta)} size={13} color={tone} />
                <Text style={[typo.metaStrong, { color: tone }]}>{signed(s.followersDelta)}</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        <StatRow index={0} testID={T.statAura} label={t("aura")} delta={s.auraDelta} after={s.after.aura} bar />
        <StatRow index={1} testID={T.statFollowers} label={t("followers")} delta={s.followersDelta} after={s.after.followers} />
        <StatRow index={2} testID={T.statHumor} label={t("humor")} delta={s.humorDelta} after={s.after.humor} bar />

        <FadeSlideIn delay={340}>
          <Text testID={T.statNarrative} style={[typo.body, { color: colors.text, marginVertical: spacing.md }]}>
            {s.narrative}
          </Text>
        </FadeSlideIn>

        {rel.length ? (
          <FadeSlideIn delay={420}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md }}>
              {rel.map(([handle, delta]) => (
                <View
                  key={handle}
                  accessibilityRole="text"
                  accessibilityLabel={`@${handle} ${signed(delta)}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.xs,
                    paddingRight: spacing.sm,
                    paddingLeft: spacing.xxs,
                    paddingVertical: spacing.xxs,
                    borderRadius: radius.pill,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Avatar
                    handle={handle}
                    size={layout.avatarXs}
                    {...(delta > 0 ? { badge: "heart" as const } : {})}
                  />
                  <Text importantForAccessibility="no" style={[typo.count, { color: colors.textDim }]}>
                    {`@${handle}`}
                  </Text>
                  <Icon name={arrowFor(delta)} size={12} color={toneOf(delta)} />
                </View>
              ))}
            </View>
          </FadeSlideIn>
        ) : null}
      </ScrollView>
      <View style={{ padding: spacing.lg, paddingTop: 0 }}>
        <Button testID={T.statContinue} label={t("continue")} onPress={closeStatCard} />
      </View>
    </View>
  );
}
