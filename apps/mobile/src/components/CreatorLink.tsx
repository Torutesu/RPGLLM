import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { pushOnce } from "../nav";
import { typo } from "../ui";

/**
 * Circuit ② — the credit, as a place you can go.
 *
 * A credit that is only a string is not authorship: it names someone the reader cannot reach, so
 * "who made this" stays a decoration and the second circuit never closes. Every "by @x" in the app
 * is this component, and every one of them lands on `/creator/[handle]`.
 *
 * The word "by" stays muted and only the handle carries the accent — the link is the *person*, not
 * the sentence, and a row of cards each shouting a full accent-coloured phrase would out-compete
 * the world titles they belong to.
 *
 * `testID` is required rather than defaulted: the world page's credit must keep `T.worldCredit`
 * (the id E2E already asserts), while the credit on a card is `T.creatorLink` scoped by its card
 * wrapper. Defaulting one of them would silently duplicate an id across a screen.
 */
export function CreatorLink({
  handle,
  testID,
  onPress,
  size = "count",
}: {
  handle: string;
  testID: string;
  /** Overrides the push — the world page uses it to walk *back* to the creator it came from. */
  onPress?: () => void;
  /** `count` on cards, `meta` where the credit is a line of its own. */
  size?: "count" | "meta";
}) {
  const { t } = useT();
  const clean = handle.replace(/^@/, "");
  const role = size === "meta" ? typo.meta : typo.count;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`${t("studioBy")} @${clean}`}
      hitSlop={spacing.xs}
      onPress={() => {
        if (onPress) onPress();
        else pushOnce({ pathname: "/creator/[handle]", params: { handle: clean } });
      }}
    >
      {({ pressed }) => (
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xxs }}>
          <Text importantForAccessibility="no" numberOfLines={1} style={[role, { color: colors.textMuted }]}>
            {t("studioBy")}
          </Text>
          <Text
            importantForAccessibility="no"
            numberOfLines={1}
            style={[
              role,
              {
                color: pressed ? colors.accent : colors.accentHi,
                textDecorationLine: pressed ? "underline" : "none",
              },
            ]}
          >
            {`@${clean}`}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
