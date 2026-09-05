import React from "react";
import { Text, View } from "react-native";
import { T, colors, layout, radius, spacing } from "@rpgllm/shared";
import type { WorldCastMember } from "../api/client";
import { Avatar } from "./Avatar";
import { FadeSlideIn, typo } from "../ui";

/**
 * SCR-049 — the reveal.
 *
 * The eight characters land one after another, 60ms apart, each with the portrait generated from
 * its handle. This is the moment the player learns their line became *people*, so the cards carry
 * the role and the intro line rather than just a name.
 */
export function StudioCast({ cast }: { cast: readonly WorldCastMember[] }) {
  return (
    <View testID={T.studioCast} style={{ gap: spacing.sm }}>
      {cast.map((member, i) => (
        <FadeSlideIn key={member.handle} delay={i * 60} distance={10}>
          <View
            testID={T.studioCastMember(member.handle)}
            accessibilityRole="text"
            accessibilityLabel={`${member.displayName} @${member.handle}. ${member.role}. ${member.intro}`}
            style={{
              flexDirection: "row",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Avatar handle={member.handle} size={layout.avatarMd} ring />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs }}>
                <Text numberOfLines={1} importantForAccessibility="no" style={[typo.name, { color: colors.text, flexShrink: 1 }]}>
                  {member.displayName}
                </Text>
                <Text numberOfLines={1} importantForAccessibility="no" style={[typo.count, { color: colors.textMuted }]}>
                  {`@${member.handle}`}
                </Text>
              </View>
              <Text numberOfLines={1} importantForAccessibility="no" style={[typo.caption, { color: colors.accentHi }]}>
                {member.role}
              </Text>
              {member.intro ? (
                <Text numberOfLines={2} importantForAccessibility="no" style={[typo.meta, { color: colors.textDim }]}>
                  {member.intro}
                </Text>
              ) : null}
            </View>
          </View>
        </FadeSlideIn>
      ))}
    </View>
  );
}
