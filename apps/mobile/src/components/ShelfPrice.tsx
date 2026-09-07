import React from "react";
import { Text, View } from "react-native";
import { T, WORLD_MODERATION, colors, compactNumber, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { Icon, typo } from "../ui";

/**
 * Exit 1 — what the shelf costs, said before the button is pressed.
 *
 * gtm.md §2: a person reads every world that reaches Explore, and that read costs about fifteen
 * times what generating the world cost. Charging for it is how the queue survives; *saying why* is
 * how the charge survives contact with a player. So the hint is not a feature line — it is the
 * reason, in one sentence: a person reads every world in Explore, and this pays for that read.
 *
 * Two rules the layout has to keep:
 *   1. It belongs on the publish row, not in a modal after the press. A price discovered by being
 *      charged is a toll; a price read before deciding is a price.
 *   2. Nothing priced may bleed onto the other two doors. Private and unlisted are free, and the
 *      only thing that makes that obvious is that the gem, the number and the reason are inside
 *      the box the public button sits in, and nowhere near theirs.
 */

/** True when the wallet is known and is short of the shelf price. Unknown is never "short". */
export const shortForShelf = (gems: number | null): boolean =>
  gems !== null && gems < WORLD_MODERATION.PUBLIC_SUBMIT_GEMS;

/**
 * `identified` exists because this surface is stated on **two** screens — SCR-049's publish row and
 * SCR-048's visibility picker, which is the same decision taken before the world exists (the build
 * job walks the created world through the same charge). The frozen id set has one id for it, and
 * Expo Router keeps stacked screens mounted, so a remix opened from a world page with SCR-049 still
 * under it would match `studioPublicCost` twice. SCR-049 keeps the id; SCR-048 says the same
 * sentence without one. Recorded in build-notes — an id of its own is the missing piece.
 */
export function ShelfPrice({
  gems,
  tone = "loud",
  identified = true,
}: {
  gems: number | null;
  tone?: "loud" | "quiet";
  identified?: boolean;
}) {
  const { t } = useT();
  const short = shortForShelf(gems);
  const quiet = tone === "quiet";

  return (
    <View
      testID={identified ? T.studioPublicCost : T.studioPublicCostCreate}
      accessibilityRole="text"
      accessibilityLabel={`${t("studioPublicCost")} ${String(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS)}. ${t("studioPublicCostHint")}`}
      style={{ gap: spacing.xxs }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name="gem" size={quiet ? 13 : 16} color={short ? colors.danger : colors.gem} filled />
        <Text
          importantForAccessibility="no"
          style={[quiet ? typo.caption : typo.metaStrong, { color: quiet ? colors.textDim : colors.text, flex: 1 }]}
        >
          {`${t("studioPublicCost")} ${String(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS)}`}
        </Text>
        {/* The wallet, so "can I afford this" is answerable here. Absent rather than guessed. */}
        {gems !== null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxs }}>
            <Icon name="gem" size={12} color={short ? colors.danger : colors.gem} filled />
            <Text importantForAccessibility="no" style={[typo.count, { color: short ? colors.danger : colors.textDim }]}>
              {compactNumber(gems)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted }]}>
        {t("studioPublicCostHint")}
      </Text>
    </View>
  );
}
