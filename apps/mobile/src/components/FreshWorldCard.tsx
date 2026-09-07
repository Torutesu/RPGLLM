import React from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, radius, spacing, timeAgo } from "@rpgllm/shared";
import type { WorldFull } from "../api/client";
import { useT } from "../state/store";
import { isReportableWorld } from "../studio/report";
import { Gradient, Icon, PressScale, typo } from "../ui";
import { CreatorLink } from "./CreatorLink";
import { Overflow } from "./Overflow";
import { WorldCover } from "./WorldCard";

/**
 * Circuit ③ — a world shown because it is new, and for no other reason.
 *
 * The design problem this solves: two shelves of the same-looking cards is noise, and a second
 * shelf that looks like the first reads as a second ranking — which is precisely what this slot is
 * not. So the card is built to disagree with the ranked row on every axis that carries meaning:
 *
 * - **Shape.** A portrait card in a horizontal rail, against the ranked shelf's vertical list of
 *   76px thumbnail rows. One is a browse, the other is a chart.
 * - **The number.** The ranked row's number is `playCount` — that *is* the ranking. This card
 *   refuses to print a play count at all and shows the world's **age** instead. A world with four
 *   plays sitting next to one with forty thousand would be reading itself as a loser; here the
 *   only quantity on the card is how long ago it appeared, and newest is best.
 * - **The tone.** The ranked card is a neutral surface. This one is accent-lit with a spark on the
 *   cover, which is the visual grammar this app already uses for "just happened" — an invitation
 *   to be early rather than a position in a table.
 *
 * No status pill either: everything on this rail is public and ready, so a badge would only repeat
 * the shelf it is sitting on.
 */

const CARD_W = 168;
const COVER_H = 104;

export function FreshWorldCard({ world, onPress }: { world: WorldFull; onPress: () => void }) {
  const { t } = useT();
  const reportable = isReportableWorld(world);
  const line = world.scenario.trim().length > 0 ? world.scenario : world.premise;

  return (
    /*
     * The report menu is a sibling of the Pressable, never a child (the SCR-037 rule): nested
     * pressables let one tap both report a world and walk into it. `fresh-world-<slug>` rides the
     * wrapper, so it scopes the credit link and the report menu the card offers.
     */
    <View testID={T.freshWorld(world.slug)} style={{ width: CARD_W }}>
      {reportable ? (
        <View style={{ position: "absolute", top: spacing.xs, right: spacing.xs, zIndex: 5 }}>
          <Overflow id={world.slug} target="world" targetId={world.id} testID={T.reportWorld} labelKey="reportWorld" />
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[
          world.title,
          world.creatorHandle ? `${t("studioBy")} @${world.creatorHandle}` : "",
          timeAgo(world.createdAt),
        ]
          .filter(Boolean)
          .join(". ")}
      >
        {({ pressed }) => (
          <PressScale pressed={pressed} to={0.97}>
            <View
              style={{
                borderRadius: radius.lg,
                overflow: "hidden",
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: pressed ? colors.accent : `${colors.accent}55`,
              }}
            >
              <View style={{ height: COVER_H, backgroundColor: colors.bgElevated }}>
                <WorldCover slug={world.slug} height={COVER_H} />
                {/* The "just happened" mark: a spark over a short accent wash on the cover's foot. */}
                <Gradient
                  colors={["rgba(7,7,12,0)", `${colors.accent}66`]}
                  angle={180}
                  pointerEvents="none"
                  style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 34 }}
                />
                <View style={{ position: "absolute", left: spacing.sm, bottom: spacing.xs }}>
                  <Icon name="sparkle" size={14} color={colors.accentHi} filled />
                </View>
              </View>

              <View style={{ padding: spacing.md, gap: spacing.xxs }}>
                <Text numberOfLines={2} importantForAccessibility="no" style={[typo.h2, { color: colors.text }]}>
                  {world.title}
                </Text>
                <Text numberOfLines={2} importantForAccessibility="no" style={[typo.caption, { color: colors.textDim }]}>
                  {line}
                </Text>
                {/*
                 * Age, never plays. This is the whole argument of the rail in one line: the reason
                 * this world is on screen is that it is new, so the only figure it carries is how
                 * new. See the header comment.
                 */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingTop: spacing.xxs }}>
                  <Icon name="clock" size={11} color={colors.accentHi} />
                  <Text importantForAccessibility="no" style={[typo.count, { color: colors.accentHi }]}>
                    {timeAgo(world.createdAt)}
                  </Text>
                </View>
              </View>
            </View>
          </PressScale>
        )}
      </Pressable>

      {/*
       * The credit sits *outside* the card's Pressable for the same reason the report menu does —
       * it is a second destination, and a link nested in a button is a coin toss on which one a tap
       * lands on.
       */}
      {world.creatorHandle ? (
        <View style={{ paddingTop: spacing.xs, paddingHorizontal: spacing.xxs }}>
          <CreatorLink handle={world.creatorHandle} testID={T.creatorLink} />
        </View>
      ) : null}
    </View>
  );
}
