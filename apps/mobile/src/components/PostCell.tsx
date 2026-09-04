import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { T, colors, font, radius, spacing, type Post } from "@rpgllm/shared";
import { Avatar } from "./Avatar";
import { Overflow } from "./Overflow";   // Agent G (S1-2)

/**
 * Agent G (S1-2): the report/block affordance. Rendered as a sibling of the cell's Pressable
 * (never nested inside it) so a tap on "…" cannot also open the post.
 */
function CellOverflow({ post }: { post: Post }) {
  if (post.author.isYou) return null;
  return (
    <View style={{ position: "absolute", top: spacing.sm, right: spacing.md, zIndex: 5 }}>
      <Overflow id={post.id} target="post" targetId={post.id} handle={post.author.handle} />
    </View>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Verified() {
  return <Text style={{ color: colors.verified, fontSize: font.sm }}>{" ✓"}</Text>;
}

export type RateHandlers = {
  onUp: (post: Post) => void;
  onDown: (post: Post) => void;
  busyId?: string | null;
};

function Metrics({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const likes = post.metrics.likes + (liked ? 1 : 0);
  const reposts = post.metrics.reposts + (reposted ? 1 : 0);
  return (
    <View style={{ flexDirection: "row", gap: spacing.xl, marginTop: spacing.sm }}>
      <Text style={{ color: colors.textMuted, fontSize: font.xs }}>{`💬 ${compact(post.metrics.replies)}`}</Text>
      <Pressable onPress={() => setReposted((v) => !v)} accessibilityRole="button">
        <Text style={{ color: reposted ? colors.positive : colors.textMuted, fontSize: font.xs }}>{`🔁 ${compact(reposts)}`}</Text>
      </Pressable>
      <Pressable onPress={() => setLiked((v) => !v)} accessibilityRole="button">
        <Text style={{ color: liked ? colors.danger : colors.textMuted, fontSize: font.xs }}>{`❤ ${compact(likes)}`}</Text>
      </Pressable>
    </View>
  );
}

function RateRow({ post, rate }: { post: Post; rate: RateHandlers }) {
  const busy = rate.busyId === post.id;
  return (
    <View style={{ flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm }}>
      <Pressable testID={T.rateUp(post.id)} onPress={() => rate.onUp(post)} disabled={busy} accessibilityRole="button">
        <Text style={{ color: busy ? colors.textMuted : colors.positive, fontSize: font.sm }}>👍</Text>
      </Pressable>
      <Pressable testID={T.rateDown(post.id)} onPress={() => rate.onDown(post)} disabled={busy} accessibilityRole="button">
        <Text style={{ color: busy ? colors.textMuted : colors.negative, fontSize: font.sm }}>👎</Text>
      </Pressable>
    </View>
  );
}

export function ReplyCell({
  post,
  onPress,
  rate,
  selected,
}: {
  post: Post;
  onPress?: (p: Post) => void;
  rate?: RateHandlers;
  selected?: boolean;
}) {
  return (
    <View testID={T.threadReply(post.id)}>
      <CellOverflow post={post} />
      <Pressable
        onPress={() => onPress?.(post)}
        style={{
          flexDirection: "row",
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingLeft: spacing.xl,
          borderLeftWidth: selected ? 2 : 0,
          borderLeftColor: colors.accent,
        }}
      >
        <Avatar handle={post.author.handle} size={28} />
        <View style={{ flex: 1 }}>
          <View testID={T.postKind(post.kind)} style={{ flexDirection: "row", alignItems: "center" }}>
            <Text testID={T.postAuthor} style={{ color: colors.text, fontSize: font.sm, fontWeight: "600" }}>
              {`${post.author.displayName} @${post.author.handle}`}
            </Text>
            {post.author.verified ? <Verified /> : null}
          </View>
          <Text testID={T.postText} style={{ color: colors.text, fontSize: font.sm, marginTop: 2 }}>
            {post.text}
          </Text>
          {rate ? <RateRow post={post} rate={rate} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

/** X-like feed cell. Renders up to `maxReplies` inline replies (SCR-010). */
export function PostCell({
  post,
  replies = [],
  maxReplies = 2,
  onPress,
  onReplyPress,
  showMetrics = true,
  rate,
}: {
  post: Post;
  replies?: Post[];
  maxReplies?: number;
  onPress?: (p: Post) => void;
  onReplyPress?: (p: Post) => void;
  showMetrics?: boolean;
  rate?: RateHandlers;
}) {
  const inline = replies.slice(0, maxReplies);
  return (
    <View testID={T.post(post.id)} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.bg }}>
      <CellOverflow post={post} />
      <Pressable onPress={() => onPress?.(post)} style={{ flexDirection: "row", gap: spacing.md, padding: spacing.lg }}>
        <Avatar handle={post.author.handle} size={40} />
        <View style={{ flex: 1 }}>
          <View testID={T.postKind(post.kind)} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <Text testID={T.postAuthor} style={{ color: colors.text, fontSize: font.sm, fontWeight: "700" }}>
              {`${post.author.displayName} @${post.author.handle}`}
            </Text>
            {post.author.verified ? <Verified /> : null}
            {post.kind === "news" ? (
              <Text style={{ color: colors.negative, fontSize: font.xs, marginLeft: spacing.sm }}>NEWS</Text>
            ) : null}
          </View>
          <Text testID={T.postText} style={{ color: colors.text, fontSize: font.md, marginTop: spacing.xs }}>
            {post.text}
          </Text>
          {showMetrics ? <Metrics post={post} /> : null}
          {rate ? <RateRow post={post} rate={rate} /> : null}
        </View>
      </Pressable>
      {inline.length ? (
        <View style={{ paddingLeft: spacing.xxl, paddingRight: spacing.lg, paddingBottom: spacing.md }}>
          {inline.map((r) => (
            <ReplyCell key={r.id} post={r} onPress={onReplyPress ?? onPress} />
          ))}
          {replies.length > maxReplies ? (
            <Pressable onPress={() => onPress?.(post)} style={{ paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.accent, fontSize: font.sm }}>{`+${replies.length - maxReplies}`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const cellRadius = radius.md;
