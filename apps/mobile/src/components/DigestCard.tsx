import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { T, colors, elevation, gradients, radius, spacing } from "@rpgllm/shared";
import { api, type Digest } from "../api/client";
import { useActions, useAppState, useT } from "../state/store";
import { Button } from "./ui";
import { FadeSlideIn, Gradient, Icon, typo } from "../ui";

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
    <FadeSlideIn style={{ marginHorizontal: spacing.lg, marginTop: spacing.md }}>
      <View
        testID={T.digestCard}
        accessibilityRole="summary"
        accessibilityLabel={`${t("whileYouWereAway")}: ${digest.headline}`}
        style={[
          {
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.borderHi,
            borderRadius: radius.lg,
            overflow: "hidden",
          },
          elevation.mid,
        ]}
      >
        <Gradient colors={gradients.brand} angle={90} pointerEvents="none" style={{ height: 3 }} />
        <Gradient
          colors={["rgba(124,92,255,0.16)", "rgba(124,92,255,0)"]}
          angle={165}
          pointerEvents="none"
          style={{ position: "absolute", left: 0, right: 0, top: 0, height: 140 }}
        />
        <View style={{ padding: spacing.lg, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <Icon name="clock" size={13} color={colors.accentHi} />
            <Text style={[typo.micro, { color: colors.accentHi }]}>{t("whileYouWereAway").toUpperCase()}</Text>
          </View>
          <Text testID={T.digestHeadline} style={[typo.h2, { color: colors.text }]}>
            {digest.headline}
          </Text>
          <Text testID={T.digestBody} style={[typo.meta, { color: colors.textDim }]}>
            {digest.body}
          </Text>
          <Button
            testID={T.digestDismiss}
            label={t("catchUp")}
            onPress={() => void dismiss()}
            icon="sparkle"
            compact
            style={{ alignSelf: "flex-start", marginTop: spacing.sm }}
          />
        </View>
      </View>
    </FadeSlideIn>
  );
}
