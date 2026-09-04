import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api, type Digest } from "../api/client";
import { useActions, useAppState, useT } from "../state/store";

/**
 * SCR-038 — "While you were away" (S2-1 / AIF-001).
 *
 * Pinned above the feed while a digest is unseen. The fetch is also the trigger: `GET /v1/digest`
 * runs the offline director when the away window is met (there is no scheduler in this build).
 * Dismissing marks it seen and reloads the feed so the posts the world made while you were gone
 * are there when the card gets out of the way.
 */
export function DigestCard() {
  const { me } = useAppState();
  const { loadFeed } = useActions();
  const { t } = useT();
  const personaId = me?.persona?.id ?? null;

  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!personaId) return;
    try {
      const res = await api.digest(personaId);
      setDigest(res.digest);
      if (res.digest) void loadFeed();
    } catch {
      /* a missing digest must never break the feed */
    }
  }, [loadFeed, personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dismiss = async () => {
    const current = digest;
    if (!current || busy) return;
    setBusy(true);
    setDigest(null);
    try {
      await api.markDigestSeen(current.id);
      await loadFeed();
    } catch {
      /* seen is best-effort: the card is already gone for this session */
    } finally {
      setBusy(false);
    }
  };

  if (!digest) return null;

  return (
    <View
      testID={T.digestCard}
      accessibilityRole="summary"
      accessibilityLabel={`${t("whileYouWereAway")}: ${digest.headline}`}
      style={{
        margin: spacing.md,
        padding: spacing.lg,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.accent,
        borderRadius: radius.md,
        gap: spacing.sm,
      }}
    >
      <Text style={{ color: colors.accent, fontSize: font.xs, fontWeight: "700" }}>{t("whileYouWereAway")}</Text>
      <Text testID={T.digestHeadline} style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>
        {digest.headline}
      </Text>
      <Text testID={T.digestBody} style={{ color: colors.textMuted, fontSize: font.sm }}>
        {digest.body}
      </Text>
      <Pressable
        testID={T.digestDismiss}
        accessibilityRole="button"
        accessibilityLabel={t("catchUp")}
        onPress={() => void dismiss()}
        style={{
          alignSelf: "flex-start",
          marginTop: spacing.sm,
          backgroundColor: colors.accent,
          borderRadius: radius.pill,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.lg,
        }}
      >
        <Text style={{ color: colors.bg, fontSize: font.sm, fontWeight: "700" }}>{t("catchUp")}</Text>
      </Pressable>
    </View>
  );
}
