import React from "react";
import { Text, View } from "react-native";
import { colors, font, radius, spacing } from "@rpgllm/shared";
import { typo } from "../ui";
import { FILL } from "./Brand";
import { WorldCover } from "./WorldCard";

/**
 * A world, the size of a hero: the generated cover with the title set into the bottom of it.
 *
 * Extracted from SCR-049 so the world page (`app/world/[id].tsx`) shows the recipient of a share
 * link *exactly* the picture the creator saw — one component, one look, whichever screen you
 * arrived from. `veil` is the build scrim: 0 for a finished world, and while it builds the studio
 * screen thins it with the progress figure so the picture arriving is the progress bar's second
 * voice. Above a hair of veil the title is held back — there is nothing to announce yet.
 */
export function WorldHero({
  slug,
  title,
  height,
  veil = 0,
}: {
  slug: string;
  title: string;
  height: number;
  veil?: number;
}) {
  const dim = veil > 0.02;
  return (
    <View style={{ height, borderRadius: radius.xl, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      <WorldCover slug={slug} height={height} />
      {dim ? <View pointerEvents="none" style={[FILL, { backgroundColor: colors.scrim, opacity: veil }]} /> : null}
      {!dim ? (
        <View style={[FILL, { justifyContent: "flex-end", padding: spacing.lg, gap: spacing.xs }]}>
          <Text
            numberOfLines={2}
            style={[
              typo.title,
              {
                color: colors.text,
                fontSize: font.xl,
                textShadowColor: "rgba(0,0,0,0.6)",
                textShadowRadius: 14,
                textShadowOffset: { width: 0, height: 2 },
              },
            ]}
          >
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
