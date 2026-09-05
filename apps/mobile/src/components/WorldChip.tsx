import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, identityFor, radius, spacing } from "@rpgllm/shared";
import { Gradient, typo } from "../ui";

/**
 * The world you are currently living in (Agent K).
 *
 * A social feed with no context is just a list of strangers. This sits at the top-left of every
 * feed, the way a server name sits at the top of a chat app: a gradient dot in the world's own
 * colours plus its title, so you always know which story these posts belong to — and it is the
 * door into Explore, where the other worlds are.
 */
export function WorldChip({
  title,
  slug,
  onPress,
}: {
  title: string;
  slug: string;
  onPress?: () => void;
}) {
  const identity = identityFor(slug);
  const body = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingLeft: spacing.xs,
        paddingRight: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.card,
        maxWidth: 210,
        // The header it sits in is a full row (streak, energy, coffee, settings — and, in a world
        // somebody else made, the report affordance). The title is the part that can afford to
        // give: it shrinks and ellipsises instead of pushing the controls off the screen.
        flexShrink: 1,
        minWidth: 0,
      }}
    >
      <Gradient
        colors={[identity.from, identity.to]}
        angle={135}
        style={{ width: 18, height: 18, borderRadius: 9 }}
      />
      <Text numberOfLines={1} style={[typo.label, { color: colors.text, flexShrink: 1 }]}>
        {title}
      </Text>
    </View>
  );
  if (!onPress) return <View testID={T.worldChip} style={{ flexShrink: 1, minWidth: 0 }}>{body}</View>;
  return (
    <Pressable
      testID={T.worldChip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={spacing.xs}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, flexShrink: 1, minWidth: 0 })}
    >
      {body}
    </Pressable>
  );
}

/** "popstar-era" → "Popstar Era", for the moment before `/v1/worlds` has answered. */
export function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
