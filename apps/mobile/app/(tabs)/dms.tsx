import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useAppState, useT } from "../../src/state/store";
import { Button, Screen } from "../../src/components/ui";
import { SkeletonList } from "../../src/components/Skeleton";
import { Avatar } from "../../src/components/Avatar";
import type { DMList } from "../../src/api/types";

/** SCR-020 — DM inbox. */
export default function DMInbox() {
  const { me } = useAppState();
  const { t } = useT();
  const [data, setData] = useState<DMList | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);

  const personaId = me?.persona?.id ?? "";

  const load = useCallback(() => {
    if (!personaId) return;
    void api
      .dms(personaId)
      .then((res) => {
        setData(res);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [personaId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openWith = async (characterId: string) => {
    if (!personaId || busy) return;
    setBusy(true);
    try {
      const res = await api.createThread(personaId, characterId);
      setPicker(false);
      router.push({ pathname: "/dms/[threadId]", params: { threadId: res.thread.id } });
    } catch {
      /* stay on the picker */
    } finally {
      setBusy(false);
    }
  };

  const threads = data?.threads ?? [];

  return (
    <Screen>
      <View style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ color: colors.text, fontSize: font.xl, fontWeight: "800" }}>{t("messages")}</Text>
      </View>

      {status === "loading" && !data ? (
        <SkeletonList count={4} />
      ) : (
        <ScrollView>
          {threads.length === 0 ? (
            <View style={{ padding: spacing.xxl, alignItems: "center" }}>
              <Text style={{ color: colors.textMuted, fontSize: font.md, textAlign: "center" }}>{t("noMessages")}</Text>
            </View>
          ) : null}
          {threads.map((th) => (
            <Pressable
              key={th.id}
              testID={T.dmThread(th.id)}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/dms/[threadId]", params: { threadId: th.id } })}
              style={{
                flexDirection: "row",
                gap: spacing.md,
                alignItems: "center",
                padding: spacing.lg,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Avatar handle={th.character.handle} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>{`@${th.character.handle}`}</Text>
                <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: font.sm }}>
                  {th.lastMessage ?? ""}
                </Text>
              </View>
              {th.unreadCount > 0 ? (
                <View style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.accent }} />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={{ padding: spacing.lg }}>
        <Button testID={T.dmNew} label={`+ ${t("newMessage")}`} onPress={() => setPicker((v) => !v)} />
      </View>

      {picker ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            maxHeight: "70%",
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            zIndex: 25,
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: font.sm, marginBottom: spacing.md }}>{t("newMessage")}</Text>
          <ScrollView>
            {(data?.followers ?? []).map((c) => (
              <Pressable
                key={c.id}
                testID={T.dmChar(c.handle)}
                accessibilityRole="button"
                onPress={() => void openWith(c.id)}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}
              >
                <Avatar handle={c.handle} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: font.md }}>{`${c.displayName} @${c.handle}`}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{c.role}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable accessibilityRole="button" onPress={() => setPicker(false)} style={{ alignSelf: "center", padding: spacing.md }}>
            <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("cancel")}</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
