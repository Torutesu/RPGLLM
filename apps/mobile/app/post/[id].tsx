import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { T, colors, font, spacing, type Post } from "@rpgllm/shared";
import { api } from "../../src/api/client";
import { useActions, useAppState, useT } from "../../src/state/store";
import { Button, HeaderBar, Screen } from "../../src/components/ui";
import { PostCell, ReplyCell } from "../../src/components/PostCell";
import { SkeletonList } from "../../src/components/Skeleton";
import type { PostDetail } from "../../src/api/types";

/** SCR-012 — thread view with rating and lazy "load more". */
export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const postId = id ?? "";
  const { liveReplies } = useAppState();
  const { replacePost } = useActions();
  const { t } = useT();

  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [extra, setExtra] = useState<Post[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [moreUsed, setMoreUsed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!postId) return;
    try {
      const res = await api.post(postId);
      setDetail(res);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const merged: Post[] = (() => {
    const all = [...(detail?.replies ?? []), ...extra, ...(liveReplies[postId] ?? [])];
    const seen = new Set<string>();
    const out: Post[] = [];
    for (const r of all) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  })();

  const applyReplacement = (replacement: unknown) => {
    if (!replacement || typeof replacement !== "object" || !("author" in replacement)) return;
    const post = replacement as Post;
    setDetail((d) => (d ? { ...d, replies: d.replies.map((r) => (r.id === post.id ? post : r)) } : d));
    setExtra((xs) => xs.map((r) => (r.id === post.id ? post : r)));
    replacePost(post);
  };

  const rate = {
    busyId,
    onUp: (p: Post) => {
      if (!p.generationId) return;
      setBusyId(p.id);
      void api
        .rate(p.generationId, 1, false, p.id)
        .catch(() => undefined)
        .finally(() => setBusyId(null));
    },
    onDown: (p: Post) => {
      if (!p.generationId) return;
      setBusyId(p.id);
      void api
        .rate(p.generationId, -1, true, p.id)
        .then((res) => applyReplacement(res.replacement))
        .catch(() => undefined)
        .finally(() => setBusyId(null));
    },
  };

  const onLoadMore = async () => {
    setMoreUsed(true);
    try {
      const res = await api.moreReplies(postId);
      setExtra((xs) => [...xs, ...res.replies]);
    } catch {
      /* keep the thread as-is */
    }
  };

  const target = selected ?? postId;

  return (
    <Screen>
      <HeaderBar title={t("reply")} onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))} />
      {status === "loading" && !detail ? (
        <SkeletonList count={4} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {detail ? <PostCell post={detail.post} maxReplies={0} /> : null}
          {merged.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: font.sm, padding: spacing.lg }}>{t("wakingUp")}</Text>
          ) : null}
          <View style={{ paddingHorizontal: spacing.lg }}>
            {merged.map((r) => (
              <ReplyCell key={r.id} post={r} rate={rate} selected={selected === r.id} onPress={(p) => setSelected(p.id)} />
            ))}
          </View>
          {detail?.moreAvailable && !moreUsed ? (
            <View style={{ padding: spacing.lg }}>
              <Button testID={T.loadMore} label={t("loadMore")} variant="ghost" onPress={() => void onLoadMore()} />
            </View>
          ) : null}
        </ScrollView>
      )}
      <View style={{ padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Button
          testID={T.replyBtn}
          label={`${t("reply")} ⚡1`}
          onPress={() => router.push({ pathname: "/compose", params: { parentId: target } })}
        />
      </View>
    </Screen>
  );
}
