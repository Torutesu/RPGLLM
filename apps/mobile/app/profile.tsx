import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { T, XP_PER_LEVEL, colors, font, radius, spacing } from "@rpgllm/shared";
import { api, type Profile } from "../src/api/client";
import { Avatar } from "../src/components/Avatar";
import { SkeletonList } from "../src/components/Skeleton";
import { HeaderBar, Screen } from "../src/components/ui";
import { useAppState, useT } from "../src/state/store";

/**
 * SCR-026 — profile (S2-6).
 *
 * The screen where progression becomes visible: level + XP bar, the persona's own posts, and the
 * cast with affinity and how much each character remembers (tapping a row opens SCR-039).
 * It is reached from the Profile tab; `app/(tabs)` holds only feed and dms, so the tab bar item
 * pushes this stack route and the header brings you back (build-notes "Agent H").
 */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ color: colors.text, fontSize: font.lg, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { me } = useAppState();
  const { t } = useT();
  const personaId = me?.persona?.id ?? null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    if (!personaId) return;
    try {
      setProfile(await api.profile(personaId));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const persona = profile?.persona;
  // The bar fills across the current level: level N spans (N-1)*100 .. N*100 XP.
  const floor = profile ? (profile.levelProgress.level - 1) * XP_PER_LEVEL : 0;
  const span = profile ? Math.max(1, profile.levelProgress.xpForNext - floor) : 1;
  const progress = profile ? Math.max(0, Math.min(1, (profile.levelProgress.xp - floor) / span)) : 0;
  const toNext = profile ? Math.max(0, profile.levelProgress.xpForNext - profile.levelProgress.xp) : 0;

  return (
    <Screen>
      <HeaderBar
        title={t("profile")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/feed"))}
        right={
          <Pressable
            testID={T.referralOpen}
            accessibilityRole="button"
            accessibilityLabel={t("inviteFriends")}
            onPress={() => router.push("/invite")}
          >
            <Text style={{ color: colors.accent, fontSize: font.sm, fontWeight: "700" }}>{t("inviteFriends")}</Text>
          </Pressable>
        }
      />

      {status === "loading" && !profile ? (
        <SkeletonList count={4} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Avatar handle={persona?.handle ?? ""} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.lg, fontWeight: "800" }} numberOfLines={1}>
                {persona?.displayName ?? ""}
              </Text>
              <Text testID={T.profileHandle} style={{ color: colors.textMuted, fontSize: font.sm }} numberOfLines={1}>
                {persona ? `@${persona.handle}` : ""}
              </Text>
            </View>
          </View>

          {persona ? (
            <View style={{ flexDirection: "row", paddingVertical: spacing.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
              <Stat label={t("followers")} value={persona.followers} />
              <Stat label={t("aura")} value={persona.aura} />
              <Stat label={t("humor")} value={persona.humor} />
            </View>
          ) : null}

          {/* Agent L: the way into SCR-044. */}
          <Pressable
            testID={T.achievementsOpen}
            accessibilityRole="button"
            accessibilityLabel={t("achievements")}
            onPress={() => router.push("/achievements")}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.cardHi : colors.card,
            })}
          >
            <Text style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>{t("achievements")}</Text>
            <Text style={{ color: colors.textMuted, fontSize: font.sm }}>›</Text>
          </Pressable>

          <View
            accessibilityRole="progressbar"
            accessibilityLabel={`${t("level")} ${profile?.levelProgress.level ?? 1}`}
            style={{ gap: spacing.xs }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text testID={T.profileLevel} style={{ color: colors.text, fontSize: font.md, fontWeight: "700" }}>
                {`${t("level")} ${profile?.levelProgress.level ?? 1}`}
              </Text>
              <Text testID={T.profileXp} style={{ color: colors.textMuted, fontSize: font.xs }}>
                {`${profile?.levelProgress.xp ?? 0} XP · ${toNext} ${t("xpToNext")}`}
              </Text>
            </View>
            <View style={{ height: 8, backgroundColor: colors.bgElevated, borderRadius: radius.pill, overflow: "hidden" }}>
              <View style={{ height: 8, width: `${Math.round(progress * 100)}%`, backgroundColor: colors.accent }} />
            </View>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("yourCast")}</Text>
            {(profile?.relationships ?? []).map((rel) => (
              <Pressable
                key={rel.characterId}
                testID={T.profileRelationship(rel.handle)}
                accessibilityRole="button"
                accessibilityLabel={`@${rel.handle} — ${t("remembers")}`}
                onPress={() => router.push({ pathname: "/memory/[handle]", params: { handle: rel.handle } })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  paddingVertical: spacing.sm,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Avatar handle={rel.handle} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: font.sm, fontWeight: "700" }} numberOfLines={1}>
                    {`@${rel.handle}`}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: font.xs }} numberOfLines={1}>
                    {`${rel.memoryCount} · ${t("remembers")}`}
                  </Text>
                </View>
                <Text style={{ color: colors.danger, fontSize: font.sm }}>{`❤ ${rel.affinity}`}</Text>
              </Pressable>
            ))}
          </View>

          <View testID={T.profilePosts} style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.textMuted, fontSize: font.xs, fontWeight: "700" }}>{t("yourPosts")}</Text>
            {(profile?.posts ?? []).length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: font.sm }}>{t("noPostsYet")}</Text>
            ) : (
              (profile?.posts ?? []).map((post) => (
                <Pressable
                  key={post.id}
                  testID={T.post(post.id)}
                  accessibilityRole="button"
                  accessibilityLabel={post.text}
                  onPress={() => router.push({ pathname: "/post/[id]", params: { id: post.id } })}
                  style={{ paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ color: colors.text, fontSize: font.sm }}>{post.text}</Text>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}
