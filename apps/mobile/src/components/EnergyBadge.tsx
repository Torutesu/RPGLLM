import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, glow, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { AnimatedNumber, Icon, Pulse, typo } from "../ui";

/** Above this the wallet reads as "full" and the badge glows. */
const FULL_AT = 8;

/**
 * The testid'd node holds the bare number so E2E can assert exact energy values; the bolt and the
 * coffee count sit outside it. The number rolls when it changes — spending energy should be
 * something you feel, not something you notice later.
 */
export function EnergyBadge({ energy, coffee, onPress }: { energy: number; coffee: number; onPress: () => void }) {
  const { t } = useT();
  const empty = energy <= 0;
  const full = energy >= FULL_AT;
  const tone = empty ? colors.textMuted : colors.energy;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Pressable
        testID={T.energyBadge}
        onPress={onPress}
        accessibilityRole="button"
        // "Energy 7" rather than a bare "7" — the bolt next to it is decorative.
        accessibilityLabel={`${t("energy")} ${energy}`}
        accessibilityValue={{ min: 0, now: energy, text: String(energy) }}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingLeft: spacing.sm,
            paddingRight: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colors.cardHi : colors.card,
            borderWidth: 1,
            borderColor: empty ? colors.border : `${colors.energy}55`,
          },
          full ? glow(colors.energy, 12) : null,
        ]}
      >
        <Pulse active={full}>
          <Icon name="bolt" size={15} color={tone} filled={!empty} />
        </Pulse>
        <AnimatedNumber value={energy} style={[typo.metaStrong, { color: empty ? colors.textMuted : colors.text }]} />
      </Pressable>
      <View
        accessibilityRole="text"
        accessibilityLabel={`${t("useCoffee")} ${coffee}`}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxs }}
      >
        <Icon name="coffee" size={15} color={coffee > 0 ? colors.coffee : colors.textMuted} />
        <Text importantForAccessibility="no" style={[typo.count, { color: coffee > 0 ? colors.coffee : colors.textMuted }]}>
          {String(coffee)}
        </Text>
      </View>
    </View>
  );
}
