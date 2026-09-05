import React from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { T, colors, radius, spacing, type StringKey } from "@rpgllm/shared";
import { useT } from "../state/store";
import type { ReportTarget } from "../api/client";
import { Icon } from "../ui";

/**
 * SCR-037 — the "…" affordance that opens report / block (App Store Guideline 1.2).
 * Rendered on every cell the user did not write.
 *
 * A world uses the same affordance rather than a second pattern: same glyph, same place in the
 * cell, same destination. It only differs in what it names — `T.reportWorld` and "Report this
 * world" — because a world is a place, not a post, and the ids E2E drives are per-surface.
 */
export function Overflow({
  id,
  target,
  targetId,
  handle,
  testID,
  labelKey = "report",
}: {
  /** id used for the test id — the post/message this menu belongs to */
  id: string;
  target: ReportTarget;
  targetId: string;
  /** author handle; enables the block affordance on the report screen */
  handle?: string;
  /** overrides the per-cell id, for surfaces E2E addresses by name (`T.reportWorld`) */
  testID?: string;
  /** what this "…" says to a screen reader */
  labelKey?: StringKey;
}) {
  const { t } = useT();
  return (
    <Pressable
      testID={testID ?? T.overflow(id)}
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      hitSlop={spacing.md}
      onPress={() =>
        router.push({ pathname: "/report", params: { target, targetId, ...(handle ? { handle } : {}) } })
      }
      style={({ pressed }) => ({
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: pressed ? colors.cardHi : "transparent",
      })}
    >
      <Icon name="more" size={16} color={colors.textMuted} />
    </Pressable>
  );
}
