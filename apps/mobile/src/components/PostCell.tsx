import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  T,
  colors,
  compactNumber,
  identityFor,
  layout,
  radius,
  spacing,
  timeAgo,
  type Post,
} from "@rpgllm/shared";
import { useT } from "../i18n/useT";
import { Avatar } from "./Avatar";
import { Overflow } from "./Overflow"; // Agent G (S1-2)
import { Chip } from "./ui";
import { Burst, Icon, typo, useHaptic, type IconName } from "../ui";

/**
 * Agent G (S1-2): the report/block affordance. Rendered as a sibling of the cell's Pressable
 * (never nested inside it) so a tap on "…" cannot also open the post. It is pinned to the top-right
 * of the name row rather than floating over the body.
 */
function CellOverflow({ post, top }: { post: Post; top: number }) {
  if (post.author.isYou) return null;
  return (
    <View style={{ position: "absolute", top, right: spacing.sm, zIndex: 5 }}>
      <Overflow id={post.id} target="post" targetId={post.id} handle={post.author.handle} />
    </View>
  );
}

function Verified({ size = 14 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.verified,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="check" size={size * 0.72} color={colors.bg} />
    </View>
  );
}

export type RateHandlers = {
  onUp: (post: Post) => void;
  onDown: (post: Post) => void;
  busyId?: string | null;
};

/** Name · @handle · 12m, on one line, with the hierarchy the old single-string version lacked. */
function AuthorLine({ post, compactSize }: { post: Post; compactSize?: boolean }) {
  const time = timeAgo(post.createdAt);
  return (
    <View
      testID={T.postKind(post.kind)}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingRight: spacing.xl }}
    >
      <Text
        testID={T.postAuthor}
        numberOfLines={1}
        style={[compactSize ? typo.metaStrong : typo.name, { color: colors.text, flexShrink: 1 }]}
      >
        {post.author.displayName}
      </Text>
      {post.author.verified ? <Verified size={compactSize ? 12 : 14} /> : null}
      <Text numberOfLines={1} style={[typo.meta, { color: colors.textMuted, flexShrink: 1 }]}>
        {`@${post.author.handle}`}
      </Text>
      {time ? (
        <>
          <Text style={[typo.meta, { color: colors.textMuted }]}>·</Text>
          <Text testID={T.postTime} style={[typo.meta, { color: colors.textMuted }]}>
            {time}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Action({
  icon,
  count,
  label,
  color,
  activeColor,
  active = false,
  onPress,
  burst = false,
}: {
  icon: IconName;
  count?: number;
  label: string;
  color: string;
  activeColor?: string;
  active?: boolean;
  onPress?: () => void;
  burst?: boolean;
}) {
  const [pops, setPops] = useState(0);
  const haptic = useHaptic();
  const fg = active && activeColor ? activeColor : color;
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={17} color={fg} filled={active} />
        {burst ? <Burst trigger={pops} color={activeColor ?? colors.hot} size={30} /> : null}
      </View>
      {count === undefined ? null : (
        <Text style={[typo.count, { color: fg }]}>{compactNumber(count)}</Text>
      )}
    </View>
  );
  if (!onPress) {
    return (
      <View accessibilityRole="text" accessibilityLabel={count === undefined ? label : `${count} ${label}`}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        if (!active) {
          setPops((n) => n + 1);
          haptic("light");
        }
        onPress();
      }}
      hitSlop={spacing.sm}
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label} · ${count}`}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      {body}
    </Pressable>
  );
}

function Metrics({ post }: { post: Post }) {
  const [liked, setLiked] = useState(false);
  const [reposted, setReposted] = useState(false);
  const { t } = useT();
  const likes = post.metrics.likes + (liked ? 1 : 0);
  const reposts = post.metrics.reposts + (reposted ? 1 : 0);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xxl, marginTop: spacing.md }}>
      <Action icon="reply" count={post.metrics.replies} label={t("reply")} color={colors.textMuted} />
      <Action
        icon="repost"
        count={reposts}
        label={t("share")}
        color={colors.textMuted}
        activeColor={colors.positive}
        active={reposted}
        onPress={() => setReposted((v) => !v)}
      />
      <Action
        icon={liked ? "heartFilled" : "heart"}
        count={likes}
        label={t("likeThis")}
        color={colors.textMuted}
        activeColor={colors.hot}
        active={liked}
        burst
        onPress={() => setLiked((v) => !v)}
      />
      <Action icon="share" label={t("share")} color={colors.textMuted} />
    </View>
  );
}

function RateRow({ post, rate }: { post: Post; rate: RateHandlers }) {
  const busy = rate.busyId === post.id;
  const { t } = useT();
  const chip = (icon: IconName, tone: string, testID: string, label: string, onPress: () => void) => (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      hitSlop={spacing.xs}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: busy ? colors.border : `${tone}55`,
        backgroundColor: pressed ? `${tone}22` : "transparent",
        opacity: busy ? 0.5 : 1,
      })}
    >
      <Icon name={icon} size={15} color={busy ? colors.textMuted : tone} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
      {chip("thumbUp", colors.positive, T.rateUp(post.id), `${t("likeThis")} — @${post.author.handle}`, () => rate.onUp(post))}
      {chip("thumbDown", colors.negative, T.rateDown(post.id), `${t("dislikeThis")} — @${post.author.handle}`, () => rate.onDown(post))}
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
  const identity = identityFor(post.author.handle);
  return (
    <View testID={T.threadReply(post.id)}>
      <CellOverflow post={post} top={spacing.sm} />
      <Pressable
        onPress={() => onPress?.(post)}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: spacing.md,
          paddingVertical: spacing.md,
          paddingLeft: spacing.lg,
          paddingRight: spacing.sm,
          borderLeftWidth: 2,
          // Every character reply carries its author's identity colour, so a thread reads as a cast.
          borderLeftColor: selected ? colors.accent : identity.from,
          borderTopLeftRadius: radius.xs,
          borderBottomLeftRadius: radius.xs,
          backgroundColor: pressed ? colors.card : selected ? colors.bgElevated : "transparent",
        })}
      >
        <Avatar handle={post.author.handle} size={layout.avatarSm} />
        <View style={{ flex: 1 }}>
          <AuthorLine post={post} compactSize />
          <Text testID={T.postText} style={[typo.meta, { color: colors.textDim, marginTop: 3 }]}>
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
  const { t } = useT();
  const inline = replies.slice(0, maxReplies);
  const isNews = post.kind === "news";
  return (
    <View
      testID={T.post(post.id)}
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: post.author.isYou ? colors.bgElevated : colors.bg,
      }}
    >
      <CellOverflow post={post} top={spacing.lg} />
      <Pressable
        onPress={() => onPress?.(post)}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: spacing.md,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.md,
          backgroundColor: pressed ? colors.card : "transparent",
        })}
      >
        <Avatar
          handle={post.author.handle}
          size={layout.avatarMd}
          ring={post.author.verified}
          {...(isNews ? { badge: "bolt" as const } : {})}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <AuthorLine post={post} />
          {isNews ? (
            <View style={{ flexDirection: "row", marginTop: spacing.xs }}>
              <Chip label={t("event")} color={colors.negative} icon="flame" />
            </View>
          ) : null}
          <Text testID={T.postText} style={[typo.body, { color: colors.text, marginTop: spacing.xs }]}>
            {post.text}
          </Text>
          {showMetrics ? <Metrics post={post} /> : null}
          {rate ? <RateRow post={post} rate={rate} /> : null}
        </View>
      </Pressable>
      {inline.length ? (
        <View style={{ paddingLeft: spacing.xxl + spacing.sm, paddingRight: spacing.lg, paddingBottom: spacing.md, gap: spacing.xs }}>
          {inline.map((r) => (
            <ReplyCell key={r.id} post={r} onPress={onReplyPress ?? onPress} />
          ))}
          {replies.length > maxReplies ? (
            <Pressable
              onPress={() => onPress?.(post)}
              accessibilityRole="button"
              accessibilityLabel={t("showMore")}
              style={{ paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.xs }}
            >
              <Text style={[typo.metaStrong, { color: colors.accent }]}>
                {`+${replies.length - maxReplies}`}
              </Text>
              <Icon name="chevronRight" size={13} color={colors.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const cellRadius = radius.md;
