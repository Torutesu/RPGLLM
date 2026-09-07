import React from "react";
import { Text, View } from "react-native";
import { T, colors, radius, spacing } from "@rpgllm/shared";
import { useT } from "../state/store";
import { countLine, trustView, type CreatorTrust } from "../studio/trust";
import { Icon, typo } from "../ui";

/**
 * Exit 2, on the creator's own page — "reviewed faster", as a thing being earned.
 *
 * A badge would be the wrong shape twice over: it says nothing about how it is earned, and a
 * visible mark of trust is a target for anyone looking for a creator whose worlds are read less
 * closely. So this is a meter and a number of approvals to go, and the caller renders it only for
 * `isYou` — the contract sends `trust` to nobody else, and the page must not print it if it ever
 * arrives anyway.
 *
 * The three states, and the tone each is owed:
 *   earned      the thing worked — positive, and the line says what changed for their worlds
 *   progressing N approvals to go — the accent, because it is a target
 *   lost        they were trusted and a rejection reset it. **Not** a punishment: no danger colour,
 *               no alert, no icon of shame. `trustLost` states what is true of the next submission,
 *               and the progress line under it is the way back — which is the whole point of
 *               showing the two together rather than the fact alone.
 */
export function CreatorTrustBlock({ trust, wasTrusted }: { trust: CreatorTrust; wasTrusted: boolean }) {
  const { t, locale } = useT();
  const view = trustView(trust, wasTrusted);
  const tint = view.earned ? colors.positive : view.lost ? colors.textDim : colors.accentHi;
  const line = view.count === null ? t(view.line) : countLine(locale, view.count, t(view.line));
  const label = [t("trustTitle"), view.lost ? t("trustLost") : null, line].filter(Boolean).join(". ");

  return (
    <View
      testID={T.studioTrust}
      accessibilityRole="text"
      accessibilityLabel={label}
      style={{
        gap: spacing.sm,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: view.earned ? `${colors.positive}59` : colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon name="bolt" size={12} color={tint} filled={view.earned} />
        <Text importantForAccessibility="no" style={[typo.micro, { color: tint }]}>
          {t("trustTitle").toUpperCase()}
        </Text>
      </View>

      {/* The meter carries no text of its own; the line below says the number out loud. */}
      <View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.bgElevated, overflow: "hidden" }}
      >
        <View
          style={{
            height: 6,
            width: `${Math.round(view.progress * 100)}%`,
            minWidth: view.progress > 0 ? 8 : 0,
            borderRadius: radius.pill,
            backgroundColor: tint,
          }}
        />
      </View>

      {view.lost ? (
        <Text importantForAccessibility="no" style={[typo.caption, { color: colors.textMuted }]}>
          {t("trustLost")}
        </Text>
      ) : null}

      <Text importantForAccessibility="no" style={[typo.meta, { color: view.earned ? colors.text : colors.textDim }]}>
        {line}
      </Text>
    </View>
  );
}
