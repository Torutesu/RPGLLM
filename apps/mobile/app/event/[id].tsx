import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Screen } from "../../src/components/ui";
import { resetToFeed } from "../../src/nav";
import { SkeletonList } from "../../src/components/Skeleton";
import type { GameEvent } from "../../src/api/types";

/** SCR-014 — the 3-choice drama card (modal). */
export default function EventCard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { pendingEvent, me } = useAppState();
  const { chooseEvent } = useActions();
  const { t } = useT();

  const [event, setEvent] = useState<GameEvent | null>(pendingEvent && pendingEvent.id === id ? pendingEvent : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (event || !me?.persona?.id) return;
    void api
      .pendingEvent(me.persona.id)
      .then((res) => setEvent(res.event))
      .catch(() => setError(t("notSent")));
  }, [event, me?.persona?.id, t]);

  const onChoose = async (choiceId: string) => {
    if (!event) return;
    setBusy(true);
    const res = await chooseEvent(event.id, choiceId);
    setBusy(false);
    if (res.ok) {
      // The stat card (SCR-013) is opened by the store and shown over the feed.
      resetToFeed();
      return;
    }
    if (!res.energy) setError(t("notSent"));
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
        <View
          testID={T.eventCard}
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            gap: spacing.lg,
          }}
        >
          <Text style={{ color: colors.negative, fontSize: font.sm, fontWeight: "700" }}>{`🎭 ${t("event")}`}</Text>
          {!event ? (
            <SkeletonList count={2} />
          ) : (
            <>
              <Text style={{ color: colors.text, fontSize: font.lg, fontWeight: "700" }}>{event.title}</Text>
              <Text testID={T.eventPrompt} style={{ color: colors.text, fontSize: font.md }}>
                {event.prompt}
              </Text>
              <View style={{ gap: spacing.md }}>
                {event.choices.map((c, i) => (
                  <Pressable
                    key={c.id}
                    testID={T.eventChoice(i)}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void onChoose(c.id)}
                    style={{
                      backgroundColor: colors.bgElevated,
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: spacing.lg,
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ color: colors.text, fontSize: font.md }}>{c.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: colors.energy, fontSize: font.xs, alignSelf: "flex-end" }}>⚡1</Text>
            </>
          )}
          {error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{error}</Text> : null}
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
          style={{ alignSelf: "center", padding: spacing.md }}
        >
          <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("cancel")}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
