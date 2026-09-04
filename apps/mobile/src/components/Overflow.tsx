import React from "react";
import { Pressable } from "react-native";
import { router } from "expo-router";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import type { ReportTarget } from "../api/client";
import { Icon } from "../ui";

/**
 * SCR-037 — the "…" affordance that opens report / block (App Store Guideline 1.2).
 * Rendered on every cell the user did not write.
 */
export function Overflow({
  id,
  target,
  targetId,
  handle,
}: {
  /** id used for the test id — the post/message this menu belongs to */
  id: string;
  target: ReportTarget;
  targetId: string;
  /** author handle; enables the block affordance on the report screen */
  handle?: string;
}) {
  const { t } = useT();
  return (
    <Pressable
      testID={T.overflow(id)}
      accessibilityRole="button"
      accessibilityLabel={t("report")}
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
