import React, { useEffect } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { colors, glow, identityFor, motion, radius, spacing } from "@rpgllm/shared";
import { Avatar, typo, useAnimatedValue, useReduceMotion } from "../ui";
import { FILL, SoftOrb } from "./Brand";

/**
 * SCR-004 persona tile — "choosing a character", not ticking a radio button.
 *
 * The tile has a **fixed footprint**: selection scales and glows through transforms only, so the
 * grid (and the Continue button under it) never move while the player picks.
 */
export interface PersonaCardProps {
  handle: string;
  displayName: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /** Tile width; the avatar is sized from it. */
  width: number;
}

export function PersonaCard({ handle, displayName, selected, onPress, testID, width }: PersonaCardProps) {
  const reduce = useReduceMotion();
  const id = identityFor(handle);
  const lift = useAnimatedValue(selected ? 1 : 0);
  const avatar = Math.round(width * 0.6);

  useEffect(() => {
    if (reduce) {
      lift.setValue(selected ? 1 : 0);
      return;
    }
    const a = Animated.spring(lift, {
      toValue: selected ? 1 : 0,
      damping: motion.spring.damping,
      stiffness: motion.spring.stiffness,
      mass: motion.spring.mass,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [lift, reduce, selected]);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={`${displayName} @${handle.replace(/^@/, "")}`}
      style={{ width, alignItems: "center", paddingVertical: spacing.md }}
    >
      <Animated.View
        style={{
          alignItems: "center",
          gap: spacing.sm,
          transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) }],
        }}
      >
        <View style={{ width: avatar, height: avatar, alignItems: "center", justifyContent: "center" }}>
          <Animated.View style={{ position: "absolute", opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [0, 0.95] }) }}>
            <SoftOrb from={id.from} to={id.to} size={Math.round(avatar * 1.6)} />
          </Animated.View>
          <View style={[FILL, { alignItems: "center", justifyContent: "center" }]}>
            <Avatar handle={handle} size={avatar} />
          </View>
          <Animated.View
            style={{
              position: "absolute",
              width: avatar + 10,
              height: avatar + 10,
              borderRadius: radius.pill,
              borderWidth: 2,
              borderColor: colors.text,
              opacity: lift,
              ...(selected ? glow(id.to, 16) : {}),
            }}
          />
        </View>

        <Text numberOfLines={1} importantForAccessibility="no" style={[typo.metaStrong, { color: selected ? colors.text : colors.textDim }]}>
          {`@${handle.replace(/^@/, "")}`}
        </Text>
        <Text numberOfLines={1} importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted }]}>
          {displayName}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
