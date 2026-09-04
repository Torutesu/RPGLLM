import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";

/**
 * The testid'd node holds the bare number so E2E can assert exact energy values;
 * the ⚡ glyph and the coffee count sit outside it.
 */
export function EnergyBadge({ energy, coffee, onPress }: { energy: number; coffee: number; onPress: () => void }) {
  const { t } = useT();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Text importantForAccessibility="no" style={{ color: colors.energy, fontSize: font.md }}>
        ⚡
      </Text>
      <Pressable
        testID={T.energyBadge}
        onPress={onPress}
        accessibilityRole="button"
        // "Energy 7" rather than a bare "7" — the ⚡ glyph next to it is decorative.
        accessibilityLabel={`${t("energy")} ${energy}`}
        accessibilityValue={{ min: 0, now: energy, text: String(energy) }}
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderRadius: radius.pill,
          backgroundColor: colors.bgElevated,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text importantForAccessibility="no" style={{ color: colors.text, fontSize: font.sm, fontWeight: "700" }}>
          {String(energy)}
        </Text>
      </Pressable>
      <Text
        accessibilityLabel={`${t("useCoffee")} ${coffee}`}
        style={{ color: colors.coffee, fontSize: font.sm }}
      >
        {`☕ ${coffee}`}
      </Text>
    </View>
  );
}
