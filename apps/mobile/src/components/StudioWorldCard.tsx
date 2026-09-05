import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, compactNumber, elevation, radius, spacing } from "@rpgllm/shared";
import type { WorldBuildStatus, WorldFull, WorldVisibility } from "../api/client";
import { useT } from "../state/store";
import { STATUS_LABEL, STATUS_TINT, VISIBILITY_LABEL, isBuilding } from "../studio/labels";
import { Icon, PressScale, Shimmer, typo } from "../ui";
import { WorldCover } from "./WorldCard";

/**
 * SCR-050 / Explore — one row for a world a player made.
 *
 * Deliberately not the big SCR-003 card: these are lists, and what a player needs from a list is
 * "which one is this, what state is it in, and is anyone playing it". The cover is the same
 * generated art as the hero card, cropped to a thumbnail, so a world looks like itself everywhere.
 */

/**
 * The state pill. `review`, `rejected` and `generating` are the ones people come back to check.
 *
 * A world that is finished says *who can play it* instead ("Just me", "Everyone"): "Your world is
 * ready" is a headline, not a pill, and once it is built the open question is the audience.
 */
export function StudioStatusBadge({
  status,
  visibility,
  testID,
}: {
  status: WorldBuildStatus;
  visibility: WorldVisibility;
  testID?: string;
}) {
  const { t } = useT();
  const settled = status === "ready" || status === "published";
  const tint = STATUS_TINT[status];
  const label = t(settled ? VISIBILITY_LABEL[visibility] : STATUS_LABEL[status]);
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        alignSelf: "flex-start",
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        backgroundColor: `${tint}1F`,
        borderWidth: 1,
        borderColor: `${tint}59`,
      }}
    >
      {isBuilding(status) ? (
        <Icon name="sparkle" size={11} color={tint} filled />
      ) : status === "rejected" || status === "draft" ? (
        <Icon name="shield" size={11} color={tint} />
      ) : status === "review" ? (
        <Icon name="clock" size={11} color={tint} />
      ) : (
        <Icon name="check" size={11} color={tint} />
      )}
      <Text importantForAccessibility="no" numberOfLines={1} style={[typo.micro, { color: tint }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function StudioWorldCard({
  world,
  onPress,
  testID,
  showCreator = false,
}: {
  world: WorldFull;
  onPress: () => void;
  testID: string;
  /** Explore shows who made it; your own list does not need to tell you. */
  showCreator?: boolean;
}) {
  const { t } = useT();
  const building = isBuilding(world.status);
  /*
   * While a world builds the server has no title yet, so it echoes the premise — which made the
   * card print the same sentence twice. When the second line adds nothing, it is not shown.
   */
  const raw = world.scenario.trim().length > 0 ? world.scenario : world.premise;
  const norm = (s: string): string => s.trim().toLowerCase().replace(/[.…\s]+$/, "");
  const line = norm(raw).startsWith(norm(world.title)) || norm(world.title).startsWith(norm(raw)) ? "" : raw;
  const credit = showCreator && world.creatorHandle ? `${t("studioBy")} @${world.creatorHandle}` : null;
  const plays = `${compactNumber(world.playCount)} ${t("studioPlays")}`;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[world.title, t(STATUS_LABEL[world.status]), credit ?? "", plays].filter(Boolean).join(". ")}
    >
      {({ pressed }) => (
        <PressScale pressed={pressed} to={0.99}>
          <View
            style={{
              flexDirection: "row",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.lg,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: pressed ? colors.borderHi : colors.border,
              ...elevation.low,
            }}
          >
            <View style={{ width: 76, height: 76, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.bgElevated }}>
              <WorldCover slug={world.slug} height={76} />
              {building ? (
                <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: 0, justifyContent: "flex-end" }}>
                  <Shimmer height={4} />
                </View>
              ) : null}
            </View>

            <View style={{ flex: 1, gap: spacing.xs, justifyContent: "center" }}>
              <Text numberOfLines={1} importantForAccessibility="no" style={[typo.h2, { color: colors.text }]}>
                {world.title}
              </Text>
              {line ? (
                <Text numberOfLines={2} importantForAccessibility="no" style={[typo.meta, { color: colors.textDim }]}>
                  {line}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
                <StudioStatusBadge status={world.status} visibility={world.visibility} />
                {credit ? (
                  <Text numberOfLines={1} importantForAccessibility="no" style={[typo.count, { color: colors.textMuted }]}>
                    {credit}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Icon name="person" size={11} color={colors.textMuted} />
                  <Text importantForAccessibility="no" style={[typo.count, { color: colors.textMuted }]}>
                    {plays}
                  </Text>
                </View>
              </View>
              {world.status === "rejected" && world.reason ? (
                <Text numberOfLines={2} importantForAccessibility="no" style={[typo.caption, { color: colors.danger }]}>
                  {world.reason}
                </Text>
              ) : null}
            </View>
          </View>
        </PressScale>
      )}
    </Pressable>
  );
}
