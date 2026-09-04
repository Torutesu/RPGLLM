import React, { useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../state/store";
import { Avatar } from "./Avatar";

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

function Bar({ value }: { value: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: Math.max(0, Math.min(100, value)), duration: 450, useNativeDriver: false }).start();
  }, [anim, value]);
  const width = anim.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] });
  return (
    <View style={{ height: 6, backgroundColor: colors.bgElevated, borderRadius: radius.pill, overflow: "hidden", marginTop: spacing.xs }}>
      <Animated.View style={{ height: 6, width, backgroundColor: colors.accent }} />
    </View>
  );
}

function StatRow({ testID, label, delta, after, bar }: { testID: string; label: string; delta: number; after: number; bar?: boolean }) {
  const tone = delta > 0 ? colors.positive : delta < 0 ? colors.negative : colors.textMuted;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{label}</Text>
        <Text testID={testID} style={{ color: tone, fontSize: font.md, fontWeight: "700" }}>
          {`${signed(delta)} → ${after}`}
        </Text>
      </View>
      {bar ? <Bar value={after} /> : null}
    </View>
  );
}

/**
 * SCR-013 — opens on the `stat` stream event and after an event choice.
 * Rendered as a bottom sheet with no blocking backdrop so the feed above stays interactive.
 */
export function StatCard() {
  const { statCardOpen, lastSnapshot } = useAppState();
  const { closeStatCard } = useActions();
  const { t } = useT();
  if (!statCardOpen || !lastSnapshot) return null;
  const s = lastSnapshot;
  const rel = Object.entries(s.relDeltas ?? {});
  return (
    <View
      testID={T.statCard}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "62%",
        backgroundColor: colors.card,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        padding: spacing.lg,
        zIndex: 20,
      }}
    >
      <ScrollView>
        <StatRow testID={T.statAura} label={t("aura")} delta={s.auraDelta} after={s.after.aura} bar />
        <StatRow testID={T.statFollowers} label={t("followers")} delta={s.followersDelta} after={s.after.followers} />
        <StatRow testID={T.statHumor} label={t("humor")} delta={s.humorDelta} after={s.after.humor} bar />
        <Text testID={T.statNarrative} style={{ color: colors.text, fontSize: font.md, marginVertical: spacing.md }}>
          {s.narrative}
        </Text>
        {rel.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.md }}>
            {rel.map(([handle, delta]) => (
              <View key={handle} style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                <Avatar handle={handle} size={22} />
                <Text style={{ color: delta > 0 ? colors.positive : delta < 0 ? colors.negative : colors.textMuted, fontSize: font.xs }}>
                  {`@${handle} ${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"}`}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <Pressable
        testID={T.statContinue}
        onPress={closeStatCard}
        accessibilityRole="button"
        style={{ backgroundColor: colors.accent, borderRadius: radius.pill, paddingVertical: spacing.md, alignItems: "center" }}
      >
        <Text style={{ color: colors.bg, fontWeight: "700", fontSize: font.md }}>{t("continue")}</Text>
      </Pressable>
    </View>
  );
}
