import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { T, colors, font, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import type { ReportTarget } from "../api/client";

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
      style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}
    >
      <Text style={{ color: colors.textMuted, fontSize: font.md, fontWeight: "700" }}>…</Text>
    </Pressable>
  );
}
