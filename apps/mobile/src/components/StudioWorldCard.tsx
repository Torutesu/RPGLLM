import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, compactNumber, elevation, radius, spacing } from "@rpgllm/shared";
import type { WorldBuildStatus, WorldFull, WorldVisibility } from "../api/client";
import { useT } from "../state/store";
import { isAppealPending } from "../studio/appeal";
import { audienceInForce } from "../studio/audience";
import { STATUS_LABEL, STATUS_TINT, VISIBILITY_LABEL, isBuilding } from "../studio/labels";
import { isReportableWorld } from "../studio/report";
import { Icon, PressScale, Shimmer, typo } from "../ui";
import { Overflow } from "./Overflow";
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
 *
 * The audience it names is the one **in force**, never the one the row wishes for: a `ready` world
 * whose `visibility` says `public` is playable by its creator and nobody else, and a pill reading
 * EVERYONE over a world no one else can open is the badge lying about the product (QA-003). See
 * `studio/audience.ts` for the whole table.
 *
 * `pulled` is the exception that earns its own pill. It is `review` too, but "waiting to be read"
 * and "taken off the shelf because players reported it" are not the same news, and the second is
 * the one a creator must not discover by accident — so it says so, in the colour of a problem.
 */
export function StudioStatusBadge({
  status,
  visibility,
  pulled = false,
  testID,
}: {
  status: WorldBuildStatus;
  visibility: WorldVisibility;
  pulled?: boolean;
  testID?: string;
}) {
  const { t } = useT();
  const settled = status === "ready" || status === "published";
  const tint = pulled ? colors.danger : STATUS_TINT[status];
  const audience = audienceInForce({ status, visibility });
  const label = t(pulled ? "studioPulled" : settled ? VISIBILITY_LABEL[audience] : STATUS_LABEL[status]);
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
      {pulled ? (
        <Icon name="shield" size={11} color={tint} />
      ) : isBuilding(status) ? (
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
  canReport = false,
}: {
  world: WorldFull;
  onPress: () => void;
  testID: string;
  /** Explore shows who made it; your own list does not need to tell you. */
  showCreator?: boolean;
  /** Explore offers the report affordance; the card still refuses it on a preset or your own. */
  canReport?: boolean;
}) {
  const { t } = useT();
  const building = isBuilding(world.status);
  const pulled = world.pulled && world.status === "review";
  /*
   * A world back in the queue on the creator's own say-so. "In review" is true but it is not the
   * fact the creator came to the shelf to check — they want to know their appeal is still alive,
   * so the card carries the state rather than making them open the world to find out.
   */
  const appealPending = isAppealPending(world);
  const reportable = canReport && isReportableWorld(world);
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
    /*
     * The "…" is a sibling of the card's Pressable, never a child of it (the SCR-037 rule from
     * PostCell): nested pressables let one tap both report the world and walk into it. The test id
     * rides the wrapper so `community-world-<slug>` still scopes everything the card offers.
     */
    <View testID={testID} style={{ position: "relative" }}>
      {reportable ? (
        <View style={{ position: "absolute", top: spacing.sm, right: spacing.sm, zIndex: 5 }}>
          <Overflow
            id={world.slug}
            target="world"
            targetId={world.id}
            testID={T.reportWorld}
            labelKey="reportWorld"
          />
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          world.title,
          t(pulled ? "studioPulled" : STATUS_LABEL[world.status]),
          appealPending ? t("studioAppealPending") : "",
          credit ?? "",
          plays,
        ]
          .filter(Boolean)
          .join(". ")}
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

              <View style={{ flex: 1, gap: spacing.xs, justifyContent: "center", paddingRight: reportable ? spacing.xl : 0 }}>
                <Text numberOfLines={1} importantForAccessibility="no" style={[typo.h2, { color: colors.text }]}>
                  {world.title}
                </Text>
                {line ? (
                  <Text numberOfLines={2} importantForAccessibility="no" style={[typo.meta, { color: colors.textDim }]}>
                    {line}
                  </Text>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
                  <StudioStatusBadge status={world.status} visibility={world.visibility} pulled={pulled} />
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
                {pulled ? (
                  <Text numberOfLines={2} importantForAccessibility="no" style={[typo.caption, { color: colors.textDim }]}>
                    {t("studioPulledHint")}
                  </Text>
                ) : null}
                {appealPending ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                    <Icon name="clock" size={11} color={colors.warning} />
                    <Text numberOfLines={1} importantForAccessibility="no" style={[typo.caption, { color: colors.warning, flex: 1 }]}>
                      {t("studioAppealPending")}
                    </Text>
                  </View>
                ) : null}
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
    </View>
  );
}
