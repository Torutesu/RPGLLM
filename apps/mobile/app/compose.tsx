import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { useActions, useAppState, useT } from "../src/state/store";
import { Button, Screen } from "../src/components/ui";
import { InlineError } from "../src/components/Toast";

const MAX = 280;

/** SCR-011 — composer (modal). `parentId` turns it into a reply. */
export default function Compose() {
  const params = useLocalSearchParams<{ parentId?: string }>();
  const parentId = params.parentId ?? null;
  const { me, feed, liveReplies } = useAppState();
  const { submitPost } = useActions();
  const { t } = useT();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [safety, setSafety] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parent = parentId
    ? feed.find((p) => p.id === parentId) ??
      Object.values(liveReplies)
        .flat()
        .find((p) => p.id === parentId) ??
      null
    : null;
  const energy = me?.wallet.energy ?? 0;

  const onPost = async () => {
    if (!text.trim()) return;
    setSafety(null);
    setError(null);
    setBusy(true);
    const res = await submitPost(text.trim(), parentId);
    setBusy(false);
    if (res.status === "ok") {
      setText("");
      if (router.canGoBack()) router.back();
      else router.replace("/feed");
      return;
    }
    if (res.status === "safety") {
      setSafety(res.message);
      return;
    }
    if (res.status === "error") setError(res.message);
    // "energy" keeps the composer open behind the /energy modal.
  };

  return (
    <Screen>
      <View style={{ padding: spacing.lg, gap: spacing.lg, flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Pressable
            testID={T.composeCancel}
            accessibilityRole="button"
            accessibilityLabel={t("cancel")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
          >
            <Text importantForAccessibility="no" style={{ color: colors.accent, fontSize: font.md }}>
              {t("cancel")}
            </Text>
          </Pressable>
          <Button
            testID={T.composeSubmit}
            label={`${t("post")} ⚡1`}
            onPress={onPost}
            disabled={!text.trim() || busy}
            loading={busy}
          />
        </View>

        {parent ? (
          <Text style={{ color: colors.textMuted, fontSize: font.sm }} numberOfLines={2}>
            {`${t("replyingTo")} @${parent.author.handle} · ${parent.text}`}
          </Text>
        ) : null}

        <TextInput
          testID={T.composeInput}
          accessibilityLabel={t("post")}
          value={text}
          onChangeText={(v) => setText(v.slice(0, MAX))}
          placeholder={t("post")}
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus
          style={{
            flex: 1,
            color: colors.text,
            fontSize: font.lg,
            backgroundColor: colors.bgElevated,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            padding: spacing.lg,
            textAlignVertical: "top",
          }}
        />

        {safety ? <InlineError testID={T.safetyError} text={safety} /> : null}
        {error ? <InlineError text={error} /> : null}

        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{`${text.length}/${MAX}`}</Text>
          <Text accessibilityLabel={`${t("energy")} ${energy}`} style={{ color: colors.energy, fontSize: font.xs }}>
            {`⚡ ${energy}`}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
