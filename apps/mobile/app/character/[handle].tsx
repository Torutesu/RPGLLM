import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { T, colors, compactNumber, identityFor, layout, radius, spacing } from "@rpgllm/shared";
import { api, type CharacterProfile } from "../../src/api/client";
import { Avatar } from "../../src/components/Avatar";
import { PostCell } from "../../src/components/PostCell";
import { PostMedia } from "../../src/components/PostMedia";
import { SkeletonList } from "../../src/components/Skeleton";
import { Button, Card, HeaderBar, Screen, SectionHeader } from "../../src/components/ui";
import { mediaOf } from "../../src/lib/derive";
import { FadeSlideIn, Gradient, Icon, typo } from "../../src/ui";
import { useActions, useAppState, useT } from "../../src/state/store";

/**
 * SCR-047 — a character's page (Agent K).
 *
 * Before this screen a character was a name attached to some text. Here they are a person: their
 * own colours, what they are for in this world, whether they follow you back, how they feel about
 * you right now, how much of you they remember, and everything they have said in your feed.
 */

/**
 * How they feel about you, −100..100, drawn from the centre out: right in green when they are
 * coming round, left in orange when the world is turning. No label — a heart and a signed number
 * say it in every language.
 */
function AffinityBar({ affinity }: { affinity: number }) {
  const { t } = useT();
  const clamped = Math.max(-100, Math.min(100, affinity));
  const positive = clamped >= 0;
  const tone = positive ? colors.positive : colors.negative;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <Icon name={positive ? "heartFilled" : "heart"} size={17} color={tone} />
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t("follows")}
        accessibilityValue={{ min: -100, max: 100, now: clamped }}
        style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bgElevated, flexDirection: "row" }}
      >
        <View style={{ flex: 1, alignItems: "flex-end", justifyContent: "center" }}>
          {positive ? null : (
            <Gradient
              colors={[`${tone}33`, tone]}
              angle={90}
              style={{ height: 8, width: `${Math.abs(clamped)}%`, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }}
            />
          )}
        </View>
        <View style={{ width: 1, backgroundColor: colors.border }} />
        <View style={{ flex: 1, justifyContent: "center" }}>
          {positive ? (
            <Gradient
              colors={[tone, `${tone}33`]}
              angle={90}
              style={{ height: 8, width: `${clamped}%`, borderTopRightRadius: 4, borderBottomRightRadius: 4 }}
            />
          ) : null}
        </View>
      </View>
      <Text style={[typo.count, { color: tone, minWidth: 34, textAlign: "right" }]}>
        {`${clamped > 0 ? "+" : ""}${clamped}`}
      </Text>
    </View>
  );
}

export default function CharacterScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const key = handle ?? "";
  const { me } = useAppState();
  const { blockByHandle, unblockCharacter, loadBlocked } = useActions();
  const { t } = useT();
  const personaId = me?.persona?.id;

  const [data, setData] = useState<CharacterProfile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      setData(await api.character(key, personaId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [key, personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDm = useCallback(async () => {
    if (!personaId || !data || busy) return;
    setBusy(true);
    try {
      const res = await api.createThread(personaId, data.character.id);
      router.push({ pathname: "/dms/[threadId]", params: { threadId: res.thread.id } });
    } catch {
      /* the page stays; the DM tab is still reachable */
    } finally {
      setBusy(false);
    }
  }, [personaId, data, busy]);

  const toggleBlock = useCallback(async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      if (data.blocked) await unblockCharacter(data.character.id);
      else await blockByHandle(data.character.handle);
      await loadBlocked();
      await load();
    } finally {
      setBusy(false);
    }
  }, [data, busy, blockByHandle, unblockCharacter, loadBlocked, load]);

  if (status === "loading") {
    return (
      <Screen>
        <HeaderBar title="" onBack={() => router.back()} />
        <SkeletonList count={4} />
      </Screen>
    );
  }

  if (status === "error" || !data) {
    return (
      <Screen>
        <HeaderBar title="" onBack={() => router.back()} />
        <View style={{ padding: spacing.xl }}>
          <Card tone="outline" style={{ alignItems: "center", gap: spacing.md }}>
            <Icon name="search" size={24} color={colors.textMuted} />
            <Text style={[typo.body, { color: colors.textDim }]}>{t("loadFailed")}</Text>
            <Button label={t("retry")} variant="secondary" onPress={() => void load()} />
          </Card>
        </View>
      </Screen>
    );
  }

  const c = data.character;
  const identity = identityFor(c.handle);

  return (
    <Screen>
      <HeaderBar title={c.displayName} onBack={() => router.back()} />
      <ScrollView testID={T.characterProfile} contentContainerStyle={{ paddingBottom: spacing.xxxl }}>
        {/* Hero: their colours own the top of the screen, the way a profile banner would. */}
        <Gradient
          colors={[`${identity.from}55`, `${identity.to}18`, "rgba(7,7,12,0)"]}
          angle={165}
          style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl, alignItems: "center", gap: spacing.md }}
        >
          <Avatar
            handle={c.handle}
            size={layout.avatarXl}
            ring
            label={c.displayName}
            {...(c.isPressAccount ? { badge: "bolt" as const } : {})}
            dim={data.blocked}
          />
          <View style={{ alignItems: "center", gap: spacing.xxs }}>
            <Text style={[typo.title, { color: colors.text, textAlign: "center" }]}>{c.displayName}</Text>
            <Text style={[typo.meta, { color: colors.textMuted }]}>{`@${c.handle}`}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" }}>
            <View
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 3,
                borderRadius: radius.pill,
                backgroundColor: `${identity.from}2A`,
                borderWidth: 1,
                borderColor: `${identity.from}66`,
              }}
            >
              <Text style={[typo.micro, { color: colors.text }]}>{c.role.toUpperCase()}</Text>
            </View>
            <View
              testID={T.characterFollowState}
              accessibilityRole="text"
              accessibilityLabel={data.relationship.isFollower ? t("follows") : t("notFollowing")}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
            >
              <Icon
                name={data.relationship.isFollower ? "check" : "eye"}
                size={13}
                color={data.relationship.isFollower ? colors.positive : colors.textMuted}
              />
              <Text style={[typo.label, { color: data.relationship.isFollower ? colors.positive : colors.textMuted }]}>
                {data.relationship.isFollower ? t("follows") : t("notFollowing")}
              </Text>
            </View>
          </View>
          {data.bio ? (
            <Text style={[typo.body, { color: colors.textDim, textAlign: "center" }]} numberOfLines={4}>
              {data.bio}
            </Text>
          ) : null}
        </Gradient>

        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          <Card style={{ gap: spacing.lg }}>
            <AffinityBar affinity={data.relationship.affinity} />
            {data.relationship.summary ? (
              <Text style={[typo.meta, { color: colors.textDim }]}>{data.relationship.summary}</Text>
            ) : null}
            <Pressable
              onPress={() => router.push({ pathname: "/memory/[handle]", params: { handle: c.handle } })}
              accessibilityRole="button"
              accessibilityLabel={t("remembers")}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name="sparkle" size={16} color={colors.accent} />
              <Text style={[typo.label, { color: colors.accent, flex: 1 }]}>
                {`${t("remembers")} · ${compactNumber(data.relationship.memoryCount)}`}
              </Text>
              <Icon name="chevronRight" size={15} color={colors.accent} />
            </Pressable>
          </Card>

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button
              label={t("dms")}
              onPress={() => void openDm()}
              disabled={busy || data.blocked}
              style={{ flex: 1 }}
            />
            <Button
              label={data.blocked ? t("unblock") : t("block")}
              variant="secondary"
              onPress={() => void toggleBlock()}
              disabled={busy}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        <SectionHeader title={t("posts")} />
        <View testID={T.characterPosts}>
          {data.posts.map((p, i) => {
            const media = mediaOf(p);
            return (
              <FadeSlideIn key={p.id} delay={Math.min(i, 5) * 40}>
                <PostCell
                  post={p}
                  onPress={() => router.push({ pathname: "/post/[id]", params: { id: p.id } })}
                />
                {media ? (
                  <View
                    style={{
                      marginTop: -1,
                      paddingLeft: spacing.lg + layout.avatarMd + spacing.md,
                      paddingRight: spacing.lg,
                      paddingBottom: spacing.md,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                      backgroundColor: colors.bg,
                    }}
                  >
                    <PostMedia postId={p.id} handle={p.author.handle} kind={media.kind} seed={media.seed} />
                  </View>
                ) : null}
              </FadeSlideIn>
            );
          })}
          {data.posts.length === 0 ? (
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Card tone="outline" style={{ alignItems: "center", gap: spacing.sm }}>
                <Icon name="message" size={22} color={colors.textMuted} />
                <Text style={[typo.meta, { color: colors.textMuted, textAlign: "center" }]}>
                  {data.blocked ? t("blockWarning") : t("noPostsYet")}
                </Text>
              </Card>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
