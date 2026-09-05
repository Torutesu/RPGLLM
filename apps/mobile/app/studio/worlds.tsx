import React, { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { T, colors, layout, spacing } from "@rpgllm/shared";
import { api, type WorldFull } from "../../src/api/client";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { Empty } from "../../src/components/Empty";
import { SkeletonList } from "../../src/components/Skeleton";
import { StudioWorldCard } from "../../src/components/StudioWorldCard";
import { useT } from "../../src/state/store";
import { FadeSlideIn, typo } from "../../src/ui";

/**
 * SCR-050 — my worlds.
 *
 * The shelf. Every world this account has made, in the state it is actually in — still building,
 * waiting on a human reviewer, live, or turned down with the reason attached — plus the one button
 * that starts another. Re-read on focus, because the interesting change (review finished) happens
 * while the player is somewhere else.
 */
export default function MyWorlds() {
  const { t } = useT();
  const [worlds, setWorlds] = useState<WorldFull[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const res = await api.myWorlds();
      setWorlds(res.worlds);
      setRemaining(res.remainingToday);
      setStatus("ready");
    } catch {
      // Nothing invented: if the list cannot be read the screen says so and offers a retry.
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const list = worlds ?? [];

  return (
    <Screen>
      <HeaderBar
        title={t("studioMyWorlds")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
        right={
          remaining !== null ? (
            <Text
              testID={T.studioRemaining}
              accessibilityRole="text"
              accessibilityLabel={`${remaining} ${t("studioRemainingToday")}`}
              style={[typo.count, { color: colors.textDim }]}
            >
              {`${remaining} ${t("studioRemainingToday")}`}
            </Text>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg }}>
        <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", gap: spacing.lg }}>
          {status === "loading" && !worlds ? <SkeletonList count={3} /> : null}

          {status === "error" && !worlds ? (
            <View style={{ gap: spacing.md }}>
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[typo.meta, { color: colors.textMuted }]}>
                {t("loadFailed")}
              </Text>
              <Button label={t("retry")} variant="secondary" onPress={() => void load()} />
            </View>
          ) : null}

          {worlds !== null && list.length === 0 ? (
            <Empty
              testID={T.studioMyWorldsEmpty}
              icon="sparkle"
              title={t("studioNoWorlds")}
              body={t("studioPitch")}
              actionLabel={t("studioCreate")}
              onAction={() => router.push("/studio")}
            />
          ) : null}

          {list.length > 0 ? (
            <View testID={T.studioMyWorlds} style={{ gap: spacing.md }}>
              {list.map((w, i) => (
                <FadeSlideIn key={w.id} delay={i * 50} distance={12}>
                  <StudioWorldCard
                    world={w}
                    testID={T.studioMyWorldCard(w.slug)}
                    onPress={() => router.push({ pathname: "/studio/[id]", params: { id: w.id } })}
                  />
                </FadeSlideIn>
              ))}
            </View>
          ) : null}

          {list.length > 0 ? (
            <Button label={t("studioCreate")} icon="plus" onPress={() => router.push("/studio")} />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
