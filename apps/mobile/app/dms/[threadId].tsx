import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, font, radius, spacing } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { subscribe, type Subscription } from "../../src/api/sse";
import { useActions, useT } from "../../src/state/store";
import { Screen } from "../../src/components/ui";
import { Bubble, TypingBubble } from "../../src/components/Bubble";
import { SkeletonList } from "../../src/components/Skeleton";
import { InlineError } from "../../src/components/Toast";
import type { DMMessage, DMThreadRes } from "../../src/api/types";

const HEARTS = 5;

/**
 * Agent H (S2-3): the hearts are the way into the memory ledger (SCR-039) — "what they remember",
 * with the receipts. Both the hearts and the explicit link open it.
 */
function Affinity({ affinity, handle }: { affinity: number; handle: string }) {
  const { t } = useT();
  const filled = Math.max(0, Math.min(HEARTS, Math.round(affinity / 20)));
  const open = () => {
    if (handle) router.push({ pathname: "/memory/[handle]", params: { handle } });
  };
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Pressable
        testID={T.dmAffinity}
        accessibilityRole="button"
        accessibilityLabel={`${t("remembers")} — ${affinity}`}
        onPress={open}
      >
        <Text style={{ color: colors.danger, fontSize: font.sm }}>
          {`${"❤".repeat(filled)}${"♡".repeat(HEARTS - filled)} ${affinity}`}
        </Text>
      </Pressable>
      <Pressable testID={T.memoryOpen} accessibilityRole="button" accessibilityLabel={t("receipts")} onPress={open}>
        <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{t("receipts")}</Text>
      </Pressable>
    </View>
  );
}

/** SCR-021 — 1:1 thread with streaming bubbles. */
export default function DMThreadScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const id = threadId ?? "";
  const { refreshMe, showToast } = useActions();
  const { t } = useT();

  const [data, setData] = useState<DMThreadRes | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [affinity, setAffinity] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<Subscription | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await api.dmThread(id);
      setData(res);
      setMessages(res.messages);
      setAffinity(res.relationship.affinity);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
    return () => streamRef.current?.close();
  }, [load]);

  const onSend = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setError(null);
    setBusy(true);
    setTyping(true);
    setText("");
    try {
      const res = await api.sendDM(id, body);
      setMessages((m) => [...m, res.message]);
      streamRef.current?.close();
      streamRef.current = subscribe(
        res.streamUrl,
        "dm",
        (e) => {
          if (e.type === "message") {
            setTyping(false);
            setMessages((m) => (m.some((x) => x.id === e.message.id) ? m : [...m, e.message]));
          } else if (e.type === "affinity") {
            setAffinity(e.affinity);
          } else if (e.type === "fallback") {
            setTyping(false);
            showToast("fallback", t("fallbackNotice"));
          } else if (e.type === "done") {
            setTyping(false);
            void refreshMe();
          }
        },
        () => {
          setTyping(false);
          void refreshMe();
        },
      );
    } catch (e) {
      setTyping(false);
      const code = (e as { code?: string }).code;
      if (code === "SAFETY_BLOCKED") setError(t("safetyBlocked"));
      else if (code !== "ENERGY_REQUIRED") setError(t("notSent"));
      setText(body);
    } finally {
      setBusy(false);
      void refreshMe();
    }
  };

  const character = data?.thread.character;

  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          padding: spacing.lg,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.md,
        }}
      >
        <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace("/dms"))}>
          <Text style={{ color: colors.accent, fontSize: font.lg }}>‹</Text>
        </Pressable>
        <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700", flex: 1 }} numberOfLines={1}>
          {character ? `@${character.handle}` : ""}
          {character?.isPressAccount ? " ✓" : ""}
        </Text>
        <Affinity affinity={affinity} handle={character?.handle ?? ""} />
      </View>

      {status === "loading" && !data ? (
        <SkeletonList count={3} />
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: font.sm, textAlign: "center" }}>{t("noMessages")}</Text>
          ) : null}
          {messages.map((m) => (
            <Bubble key={m.id} text={m.text} fromCharacter={m.fromCharacter} />
          ))}
          {typing ? <TypingBubble /> : null}
        </ScrollView>
      )}

      {error ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <InlineError testID={T.safetyError} text={error} />
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          gap: spacing.md,
          padding: spacing.lg,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          alignItems: "center",
        }}
      >
        <TextInput
          testID={T.dmInput}
          value={text}
          onChangeText={setText}
          accessibilityLabel={t("send")}
          placeholder={t("send")}
          placeholderTextColor={colors.textMuted}
          maxLength={500}
          onSubmitEditing={() => void onSend()}
          style={{
            flex: 1,
            color: colors.text,
            fontSize: font.md,
            backgroundColor: colors.bgElevated,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
          }}
        />
        <Pressable
          testID={T.dmSend}
          accessibilityRole="button"
          accessibilityLabel={t("send")}
          accessibilityState={{ disabled: busy || !text.trim(), busy }}
          onPress={() => void onSend()}
          disabled={busy || !text.trim()}
          style={{
            backgroundColor: colors.accent,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            opacity: busy || !text.trim() ? 0.5 : 1,
          }}
        >
          <Text style={{ color: colors.bg, fontWeight: "700", fontSize: font.sm }}>{`${t("send")} ⚡1`}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
