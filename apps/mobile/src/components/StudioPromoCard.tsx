import React from "react";
import { Pressable, Text, View } from "react-native";
import { WORLD_STUDIO, colors, gradients, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { Gradient, Icon, PressScale, typo } from "../ui";

/**
 * "Create your own" — the way into the World Studio, placed at the end of the world picker and in
 * Explore.
 *
 * It deliberately looks like a world card that has not been made yet: the same footprint and
 * radius as SCR-003's cards, but drawn in the brand gradient with a dashed edge, so the row of
 * three fixed worlds reads as "…and one more, yours".
 */
export function StudioPromoCard({
  onPress,
  compact = false,
  testID,
}: {
  onPress: () => void;
  /** Explore uses the shorter form; the world picker gets the full-height one. */
  compact?: boolean;
  /**
   * Only the world picker passes `T.studioOpen`. Expo Router keeps the screens beneath the top of
   * the stack mounted, so an id used on two screens can match twice at once and break a strict
   * locator — every studio id in this app therefore lives on exactly one screen.
   */
  testID?: string;
}) {
  const { t } = useT();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t("studioTitle")}. ${t("studioPitch")}. ${t("studioCost")}`}
    >
      {({ pressed }) => (
        <PressScale pressed={pressed} to={0.985}>
          <View
            style={{
              borderRadius: radius.xl,
              overflow: "hidden",
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: pressed ? colors.accentHi : colors.accentMuted,
              backgroundColor: colors.card,
            }}
          >
            <Gradient
              colors={[`${gradients.brand[0]}2E`, `${gradients.brand[1]}14`]}
              angle={130}
              pointerEvents="none"
              style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
            />
            <View
              style={{
                padding: compact ? spacing.lg : spacing.xl,
                gap: spacing.sm,
                minHeight: compact ? 0 : 140,
                justifyContent: "center",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Icon name="plus" size={16} color={colors.accentHi} />
                <Text importantForAccessibility="no" style={[typo.micro, { color: colors.accentHi }]}>
                  {t("studioTitle").toUpperCase()}
                </Text>
              </View>
              <Text
                importantForAccessibility="no"
                numberOfLines={2}
                style={[compact ? typo.h2 : typo.h1, { color: colors.text }]}
              >
                {t("studioPitch")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xxs }}>
                <Icon name="gem" size={13} color={colors.gem} filled />
                <Text importantForAccessibility="no" style={[typo.count, { color: colors.textDim }]}>
                  {t("studioCost")}
                </Text>
                <Text importantForAccessibility="no" style={[typo.count, { color: colors.textMuted }]}>
                  {`· ${WORLD_STUDIO.CAST_SIZE} · ${t("studioCastHeading").toLowerCase()}`}
                </Text>
              </View>
            </View>
          </View>
        </PressScale>
      )}
    </Pressable>
  );
}
