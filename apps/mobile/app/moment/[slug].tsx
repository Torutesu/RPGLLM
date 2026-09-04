import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { colors, font, spacing } from "@rpgllm/shared";
import { api, type Moment } from "../../src/api/client";
import { MomentCard } from "../../src/components/MomentCard";
import { SkeletonList } from "../../src/components/Skeleton";
import { HeaderBar, Screen } from "../../src/components/ui";
import { useT } from "../../src/state/store";

/**
 * SCR-040 standalone — the share target (S2-4 / AIF-005).
 *
 * `GET /v1/moments/:slug` is public, so this page renders for someone with no account: the whole
 * point of the growth loop is that the card works before you sign up.
 */
export default function SharedMomentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useT();
  const [moment, setMoment] = useState<Moment | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      setMoment((await api.sharedMoment(slug)).moment);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <HeaderBar title={t("shareMoment")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))} />
      <View style={{ flex: 1, justifyContent: "center", padding: spacing.lg }}>
        {status === "loading" ? <SkeletonList count={2} /> : null}
        {status === "error" ? (
          <Text style={{ color: colors.textMuted, fontSize: font.sm, textAlign: "center" }}>{t("notSent")}</Text>
        ) : null}
        {moment ? <MomentCard moment={moment} /> : null}
      </View>
    </Screen>
  );
}
