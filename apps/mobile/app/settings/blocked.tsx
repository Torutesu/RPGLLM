import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../../src/state/store";
import { HeaderBar, Screen } from "../../src/components/ui";

/** SCR-033 → Safety → blocked characters (S1-2). Unblocking brings them back to the feed. */
export default function BlockedScreen() {
  const { blocked, me } = useAppState();
  const { loadBlocked, unblockCharacter } = useActions();
  const { t } = useT();

  const [busy, setBusy] = useState<string | null>(null);

  // `me` arrives after boot; re-run once the persona is known (direct navigation to this route).
  useEffect(() => {
    void loadBlocked();
  }, [loadBlocked, me?.persona?.id]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  };

  const onUnblock = async (characterId: string) => {
    setBusy(characterId);
    await unblockCharacter(characterId);
    setBusy(null);
  };

  return (
    <Screen>
      <HeaderBar title={t("blockedCharacters")} onBack={back} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        {blocked.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: font.md }}>{t("noBlocked")}</Text>
        ) : (
          blocked.map((b) => (
            <View
              key={b.characterId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
              }}
            >
              <View style={{ flexShrink: 1 }}>
                <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>{b.displayName}</Text>
                <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{`@${b.handle}`}</Text>
              </View>
              <Pressable
                testID={T.unblock(b.handle)}
                accessibilityRole="button"
                accessibilityLabel={`${t("unblock")} @${b.handle}`}
                disabled={busy === b.characterId}
                onPress={() => void onUnblock(b.characterId)}
                style={{
                  borderWidth: 1,
                  borderColor: colors.accent,
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.sm,
                  opacity: busy === b.characterId ? 0.5 : 1,
                }}
              >
                <Text style={{ color: colors.accent, fontSize: font.sm, fontWeight: "700" }}>{t("unblock")}</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
