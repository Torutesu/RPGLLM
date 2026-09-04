import React, { useEffect } from "react";
import { Animated, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { T, colors, gradients, radius, spacing, timeAgo } from "@rpgllm/shared";
import { Gradient, duration, ease, timing, typo, useAnimatedValue, useReduceMotion } from "../ui";

const TAIL_W = 9;
const TAIL_H = 12;

/** The little hook that joins a bubble to its speaker. Mirrored for your own messages. */
function Tail({ mine, color }: { mine: boolean; color: string }) {
  const side = mine ? { right: -TAIL_W + 1 } : { left: -TAIL_W + 1 };
  return (
    <Svg
      width={TAIL_W}
      height={TAIL_H}
      viewBox="0 0 9 12"
      style={{ position: "absolute", bottom: 0, ...side }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={mine ? "M0 0v12c4-1 7.5-4.5 9-8.5C7 3 4.5 1.6 0 0z" : "M9 0v12c-4-1-7.5-4.5-9-8.5C2 3 4.5 1.6 9 0z"}
        fill={color}
      />
    </Svg>
  );
}

export interface BubbleProps {
  text: string;
  fromCharacter: boolean;
  footer?: React.ReactNode;
  /** Part of a run from the same speaker: tighter spacing, squared inner corner, no tail. */
  grouped?: boolean;
  /** Last bubble of a run — the one that gets the tail. Defaults to true. */
  last?: boolean;
  /** ISO timestamp; rendered as a relative stamp under the last bubble of a run. */
  createdAt?: string;
}

/**
 * iMessage-grade bubble: yours in the brand gradient on the right, theirs on a raised card on the
 * left, each with a tail on the last bubble of a run and a relative timestamp underneath.
 */
export function Bubble({ text, fromCharacter, footer, grouped = false, last = true, createdAt }: BubbleProps) {
  const mine = !fromCharacter;
  const tailColor = mine ? gradients.brand[1] : colors.card;
  const corner = radius.lg;
  const tight = grouped ? radius.xs : corner;
  const shape = mine
    ? { borderTopLeftRadius: corner, borderTopRightRadius: tight, borderBottomLeftRadius: corner, borderBottomRightRadius: last ? radius.xs : tight }
    : { borderTopRightRadius: corner, borderTopLeftRadius: tight, borderBottomRightRadius: corner, borderBottomLeftRadius: last ? radius.xs : tight };
  const pad = { paddingHorizontal: spacing.lg, paddingVertical: spacing.md } as const;
  const stamp = createdAt ? timeAgo(createdAt) : "";

  const body = (
    <Text style={[typo.body, { color: mine ? colors.accentInk : colors.text }]}>{text}</Text>
  );

  return (
    <View style={{ alignItems: mine ? "flex-end" : "flex-start", marginBottom: grouped ? spacing.xxs : spacing.sm, maxWidth: "100%" }}>
      <View style={{ maxWidth: "82%" }}>
        <View testID={T.dmBubble} accessibilityRole="text" accessibilityLabel={text} style={[shape, { overflow: "hidden" }]}>
          {mine ? (
            <Gradient colors={gradients.brand} angle={135} style={[pad, shape]}>
              {body}
            </Gradient>
          ) : (
            <View style={[pad, shape, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>{body}</View>
          )}
        </View>
        {last ? <Tail mine={mine} color={tailColor} /> : null}
      </View>
      {last && stamp ? (
        <Text style={[typo.caption, { color: colors.textMuted, marginTop: spacing.xxs, marginHorizontal: spacing.xs }]}>
          {stamp}
        </Text>
      ) : null}
      {footer}
    </View>
  );
}

function Dot({ index, reduce }: { index: number; reduce: boolean }) {
  const anim = useAnimatedValue(0);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 140),
        timing(anim, 1, { duration: duration.base, easing: ease.inOut }),
        timing(anim, 0, { duration: duration.base, easing: ease.inOut }),
        Animated.delay(420 - index * 140),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, index, reduce]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.textDim,
        opacity,
        transform: [{ translateY }],
      }}
    />
  );
}

/** Three dots that actually move — the signal that a character is composing an answer. */
export function TypingBubble() {
  const reduce = useReduceMotion();
  return (
    <View style={{ alignItems: "flex-start", marginBottom: spacing.sm }}>
      <View style={{ maxWidth: "82%" }}>
        {/* Decoration: announcing it would interrupt the message being read. */}
        <View
          testID={T.dmTyping}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            borderBottomRightRadius: radius.lg,
            borderBottomLeftRadius: radius.xs,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          }}
        >
          {[0, 1, 2].map((i) => (
            <Dot key={i} index={i} reduce={reduce} />
          ))}
        </View>
        <Tail mine={false} color={colors.card} />
      </View>
    </View>
  );
}

export interface StreamMessage {
  id: string;
  text: string;
  fromCharacter: boolean;
  createdAt?: string;
}

/**
 * Renders a whole thread with runs grouped by speaker — only the last bubble of a run gets a tail
 * and a timestamp, which is what makes a transcript read as a conversation instead of a list.
 * The DM screen (owned elsewhere) can adopt this in place of mapping `Bubble` directly.
 */
export function MessageStream({ messages }: { messages: readonly StreamMessage[] }) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        return (
          <Bubble
            key={m.id}
            text={m.text}
            fromCharacter={m.fromCharacter}
            grouped={prev !== undefined && prev.fromCharacter === m.fromCharacter}
            last={next === undefined || next.fromCharacter !== m.fromCharacter}
            {...(m.createdAt === undefined ? {} : { createdAt: m.createdAt })}
          />
        );
      })}
    </>
  );
}
