import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api, type MemoryLedger } from "../../src/api/client";
import { Avatar } from "../../src/components/Avatar";
import { SkeletonList } from "../../src/components/Skeleton";
import { HeaderBar, Screen } from "../../src/components/ui";
import { useAppState, useT } from "../../src/state/store";

/**
 * SCR-039 — the Relationship Memory Ledger, "Receipts" (S2-3 / AIF-002).
 *
 * Opened from the affinity hearts in a DM (SCR-021) or a cast row on the profile. Every note is
 * shown with the line that produced it; when the source is gone the note stays and the receipt
 * is simply absent. The read also folds the backlog through G7 server-side.
 */
export default function MemoryLedgerScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const character = handle ?? "";
  const { me } = useAppState();
  const { t } = useT();
  const personaId = me?.persona?.id;

  const [ledger, setLedger] = useState<MemoryLedger | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!character) return;
    try {
      setLedger(await api.memory(character, personaId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [character, personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <HeaderBar
        title={ledger ? `@${ledger.character.handle}` : `@${character}`}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/dms"))}
        right={
          ledger ? (
            <Text
              accessibilityRole="text"
              accessibilityLabel={`${t("remembers")} ❤ ${ledger.affinity}`}
              style={{ color: colors.danger, fontSize: font.sm }}
            >
              {`❤ ${ledger.affinity}`}
            </Text>
          ) : null
        }
      />

      {status === "loading" && !ledger ? (
        <SkeletonList count={3} />
      ) : (
        <ScrollView
          testID={T.memoryLedger}
          accessibilityLabel={t("remembers")}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar handle={ledger?.character.handle ?? character} size={44} />
            <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700", flex: 1 }} numberOfLines={1}>
              {ledger?.character.displayName ?? ""}
            </Text>
          </View>

          <View style={{ gap: spacing.xs }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("remembers")}</Text>
            <Text testID={T.memorySummary} style={{ color: colors.text, fontSize: font.sm }}>
              {ledger?.summary && ledger.summary.length > 0 ? ledger.summary : t("noMemories")}
            </Text>
          </View>

          <View style={{ gap: spacing.md }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("receipts")}</Text>
            {(ledger?.memories ?? []).length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("noMemories")}</Text>
            ) : (
              (ledger?.memories ?? []).map((entry) => (
                <View
                  key={entry.id}
                  testID={T.memoryEntry(entry.id)}
                  accessibilityRole="text"
                  accessibilityLabel={entry.note}
                  style={{
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.md,
                    gap: spacing.xs,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: font.sm }}>{entry.note}</Text>
                  {entry.quote ? (
                    <Text style={{ color: colors.textMuted, fontSize: font.xs, fontStyle: "italic" }} numberOfLines={3}>
                      {`“${entry.quote}”`}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
