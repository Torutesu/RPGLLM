import { z } from "zod";
import { LocaleZ, StatDeltasZ } from "./generators";
import { PLANS, WORLD_MODERATION } from "./constants";

/** ---------- Common ---------- */
export const ErrorCodeZ = z.enum([
  "UNAUTHORIZED",
  "UNDER_13",
  "VALIDATION",
  "NOT_FOUND",
  "ENERGY_REQUIRED",
  "SAFETY_BLOCKED",
  "AD_LIMIT",
  "HANDLE_TAKEN",
  "ALREADY_DONE",
  "INTERNAL",
  /** S0-4 rate limiting (429) */
  "RATE_LIMITED",
  /** S1-1 the account is scheduled for deletion (410) */
  "ACCOUNT_DELETED",
  /** S1-2 the target is blocked by this persona (409) */
  "BLOCKED",
  /** World Studio: not enough gems to build a world (402) */
  "GEMS_REQUIRED",
  /** World Studio: today's world-building allowance is spent (429) — distinct from RATE_LIMITED
   *  so the client can say "come back tomorrow" instead of "slow down". */
  "WORLD_LIMIT",
]);
export type ErrorCode = z.infer<typeof ErrorCodeZ>;
export const ApiErrorZ = z.object({ code: ErrorCodeZ, message: z.string() });
export const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ data, error: ApiErrorZ.nullable() });

/** ---------- Auth (SCR-002) ---------- */
export const AuthProviderZ = z.enum(["email", "apple", "google"]);
export const AuthEmailStartReqZ = z.object({ email: z.string().email() });
export const AuthEmailVerifyReqZ = z.object({ email: z.string().email(), code: z.string().length(6) });
export const AuthResZ = z.object({ jwt: z.string(), isNew: z.boolean(), needsAgeGate: z.boolean() });
export const AgeGateReqZ = z.object({ birthYear: z.number().int().min(1900).max(2100), locale: LocaleZ });
export const AgeGateResZ = z.object({ isMinor: z.boolean() });

/** ---------- Me ---------- */
export const WalletZ = z.object({
  energy: z.number().int(),
  coffee: z.number().int(),
  gems: z.number().int(),
  dailyRefillAt: z.string(),
  adRewardsToday: z.number().int(),
  adsEnabled: z.boolean(),
  adPersonalized: z.boolean(),
  dailyMax: z.number().int(),
});
export const SubscriptionZ = z.object({
  plan: z.enum(Object.keys(PLANS) as [keyof typeof PLANS, ...(keyof typeof PLANS)[]]),
  active: z.boolean(),
  renewsAt: z.string().nullable(),
});
export const PersonaZ = z.object({
  id: z.string(),
  worldId: z.string(),
  worldSlug: z.string(),
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.string().nullable(),
  followers: z.number().int(),
  aura: z.number().int(),
  humor: z.number().int(),
  level: z.number().int(),
  xp: z.number().int(),
  actionCount: z.number().int(),
});
export const MeResZ = z.object({
  user: z.object({
    id: z.string(),
    locale: LocaleZ,
    isMinor: z.boolean(),
    birthYear: z.number().int().nullable(),
    /** SCR-033 shows the signed-in address; null for providers that do not give one. */
    email: z.string().nullable().default(null),
    /** S1-6 current consent, so the settings switch starts from the server value rather than a default. */
    analyticsConsent: z.boolean().default(false),
    /** The name this account's worlds are credited to. Stable, unique, and renameable once claimed. */
    creatorHandle: z.string().default(""),
  }),
  wallet: WalletZ,
  subscription: SubscriptionZ.nullable(),
  persona: PersonaZ.nullable(),
});

/** ---------- Worlds (SCR-003/004/006) ---------- */
/** Mirrors `WORLD_GENRES`. Declared up here because the world detail needs it. */
export const WorldGenreZ = z.enum([
  "fame",
  "academy",
  "idol",
  "office",
  "sports",
  "fantasy",
  "mystery",
  "slice_of_life",
]);

export const WorldSummaryZ = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  scenario: z.string(),
  difficulty: z.number().int(),
  coverUrl: z.string().nullable(),
});
export const WorldsResZ = z.array(WorldSummaryZ);
export const CharacterZ = z.object({
  id: z.string(),
  handle: z.string(),
  displayName: z.string(),
  role: z.string(),
  avatarUrl: z.string().nullable(),
  isPressAccount: z.boolean(),
  canBeFirstFollower: z.boolean(),
  intro: z.string(),
});
export const PresetPersonaZ = z.object({
  handle: z.string(),
  displayName: z.string(),
  bio: z.string(),
  avatarUrl: z.string().nullable(),
});
/**
 * The world detail every player can read — including one they were sent a link to.
 *
 * `creatorHandle` and `playCount` are here because a world someone made has to be presented as
 * *someone's work*: a credit that is only a string in the creator's own screen is not authorship.
 * Both are null/0 for the presets, which nobody authored.
 */
export const WorldDetailResZ = z.object({
  world: WorldSummaryZ.extend({
    creatorHandle: z.string().nullable().default(null),
    playCount: z.number().int().default(0),
    isPreset: z.boolean().default(true),
    /**
     * Lineage, on the page a visitor lands on. A remix that only credits its source inside the
     * creator's own screen credits nobody — the same shape of defect as a share link that only
     * works for the person who made it.
     */
    remixOf: z
      .object({ id: z.string(), slug: z.string(), title: z.string(), creatorHandle: z.string().nullable() })
      .nullable()
      .default(null),
    remixCount: z.number().int().default(0),
    /** What a remix inherits. Without these the remix form can only guess or stay silent. */
    genre: WorldGenreZ.nullable().default(null),
    genLocale: LocaleZ.nullable().default(null),
  }),
  characters: z.array(CharacterZ),
  presetPersonas: z.array(PresetPersonaZ),
});

/** ---------- Personas (SCR-005/006) ---------- */
export const HandleCheckReqZ = z.object({ worldId: z.string(), handle: z.string() });
export const HandleCheckResZ = z.object({ available: z.boolean() });
export const CreatePersonaReqZ = z.object({
  worldId: z.string(),
  handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
  displayName: z.string().min(1).max(40),
  bio: z.string().max(160).default(""),
  avatarUrl: z.string().nullable().default(null),
  voiceNotes: z.string().max(200).default(""),
  firstFollowerId: z.string(),
  idempotencyKey: z.string(),
});
export const CreatePersonaResZ = z.object({ persona: PersonaZ, feedReady: z.boolean() });

/** ---------- Feed / Posts (SCR-010/011/012) ---------- */
export const PostKindZ = z.enum(["user", "character", "news", "ambient", "system"]);
export const PostZ = z.object({
  id: z.string(),
  kind: PostKindZ,
  text: z.string(),
  parentId: z.string().nullable(),
  author: z.object({
    handle: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    verified: z.boolean(),
    isYou: z.boolean(),
  }),
  metrics: z.object({ likes: z.number().int(), reposts: z.number().int(), replies: z.number().int() }),
  generationId: z.string().nullable(),
  createdAt: z.string(),
  replies: z.array(z.lazy((): z.ZodTypeAny => PostZ)).optional(),
});
export type Post = z.infer<typeof PostZ>;
export const StatSnapshotZ = z.object({
  id: z.string(),
  cause: z.string(),
  narrative: z.string(),
  followersDelta: z.number().int(),
  auraDelta: z.number().int(),
  humorDelta: z.number().int(),
  relDeltas: z.record(z.string(), z.number().int()),
  after: z.object({ followers: z.number().int(), aura: z.number().int(), humor: z.number().int() }),
  createdAt: z.string(),
});
export const EventZ = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  choices: z.array(z.object({ id: z.string(), label: z.string() })).length(3),
  chosenId: z.string().nullable(),
});
export const FeedResZ = z.object({
  posts: z.array(PostZ),
  nextCursor: z.string().nullable(),
  pendingEvent: EventZ.nullable(),
  lastSnapshot: StatSnapshotZ.nullable(),
});
export const CreatePostReqZ = z.object({
  personaId: z.string(),
  text: z.string().min(1).max(280),
  parentId: z.string().nullable().default(null),
});
export const CreatePostResZ = z.object({ post: PostZ, streamUrl: z.string() });
export const PostDetailResZ = z.object({ post: PostZ, replies: z.array(PostZ), moreAvailable: z.boolean() });
export const MoreRepliesResZ = z.object({ replies: z.array(PostZ) });

/** SSE event payloads for /posts/:id/stream */
export const PostStreamEventZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reply"), post: PostZ }),
  z.object({ type: z.literal("news"), post: PostZ }),
  z.object({ type: z.literal("stat"), snapshot: StatSnapshotZ }),
  z.object({ type: z.literal("event"), event: EventZ }),
  z.object({ type: z.literal("fallback"), message: z.string() }),
  z.object({ type: z.literal("done"), energy: z.number().int() }),
]);
export type PostStreamEvent = z.infer<typeof PostStreamEventZ>;

/** ---------- Events (SCR-014) ---------- */
export const PendingEventResZ = z.object({ event: EventZ.nullable() });
export const ChooseEventReqZ = z.object({ choiceId: z.string() });
export const ChooseEventResZ = z.object({
  snapshot: StatSnapshotZ,
  newsPost: PostZ.nullable(),
  energy: z.number().int(),
});
export const StatResZ = z.object({
  snapshot: StatSnapshotZ,
  persona: z.object({ followers: z.number().int(), aura: z.number().int(), humor: z.number().int() }),
});

/** ---------- DMs (SCR-020/021) ---------- */
export const DMThreadZ = z.object({
  id: z.string(),
  character: CharacterZ,
  lastMessage: z.string().nullable(),
  lastMessageAt: z.string(),
  unreadCount: z.number().int(),
});
export const DMMessageZ = z.object({
  id: z.string(),
  fromCharacter: z.boolean(),
  text: z.string(),
  generationId: z.string().nullable(),
  createdAt: z.string(),
});
export const RelationshipZ = z.object({
  characterHandle: z.string(),
  affinity: z.number().int(),
  summary: z.string(),
  isFollower: z.boolean(),
});
export const DMListResZ = z.object({ threads: z.array(DMThreadZ), followers: z.array(CharacterZ) });
export const CreateThreadReqZ = z.object({ personaId: z.string(), characterId: z.string() });
export const CreateThreadResZ = z.object({ thread: DMThreadZ });
export const DMThreadResZ = z.object({
  thread: DMThreadZ,
  messages: z.array(DMMessageZ),
  relationship: RelationshipZ,
  nextCursor: z.string().nullable(),
});
export const SendDMReqZ = z.object({ text: z.string().min(1).max(500) });
export const SendDMResZ = z.object({ message: DMMessageZ, streamUrl: z.string() });
export const DMStreamEventZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message"), message: DMMessageZ }),
  z.object({ type: z.literal("affinity"), delta: z.number().int(), affinity: z.number().int() }),
  z.object({ type: z.literal("fallback"), message: z.string() }),
  z.object({ type: z.literal("done"), energy: z.number().int() }),
]);
export type DMStreamEvent = z.infer<typeof DMStreamEventZ>;

/** ---------- Wallet (SCR-032) ---------- */
export const WalletResZ = WalletZ;
export const AdRewardReqZ = z.object({ adToken: z.string() });
export const AdRewardResZ = z.object({ energy: z.number().int(), adRewardsToday: z.number().int() });
export const CoffeeReqZ = z.object({ count: z.literal(1).default(1) });
export const CoffeeResZ = z.object({ energy: z.number().int(), coffee: z.number().int() });

/** ---------- Billing (SCR-030) ---------- */
export const PlanIdZ = z.enum(Object.keys(PLANS) as [keyof typeof PLANS, ...(keyof typeof PLANS)[]]);
export const OfferingsResZ = z.object({
  plans: z.array(z.object({ id: PlanIdZ, usd: z.number(), period: z.string(), highlighted: z.boolean() })),
  experiments: z.object({ trialDays: z.number().int(), showAdFree: z.boolean() }),
});
export const DevPurchaseReqZ = z.object({ plan: PlanIdZ });
export const DevPurchaseResZ = z.object({ subscription: SubscriptionZ, energy: z.number().int() });
export const RestoreReqZ = z.object({ rcAppUserId: z.string() });

/** ---------- Ratings / Experiments ---------- */
export const RateReqZ = z.object({
  value: z.union([z.literal(-1), z.literal(1)]),
  regenerate: z.boolean().default(false),
});
export const RateResZ = z.object({
  replacement: z.union([PostZ, DMMessageZ]).nullable(),
  newGenerationId: z.string().nullable(),
});
export const AssignmentsResZ = z.record(z.string(), z.string());
export const HealthResZ = z.object({
  ok: z.boolean(),
  llmMode: z.string(),
  champion: z.record(z.string(), z.string()),
});

/** ---------- Test hooks (only when TEST_HOOKS=1) ---------- */
export const TestTimeTravelReqZ = z.object({ days: z.number().int().min(-30).max(30) });
export const TestLlmModeReqZ = z.object({ mode: z.enum(["replay", "live", "fail"]) });
export const TestSetEnergyReqZ = z.object({ energy: z.number().int().min(0).max(999) });

export { StatDeltasZ };

/* ============================================================
 * S1 — account, legal, moderation (store-review requirements)
 * ========================================================== */

/** SCR-036 Settings → delete account. Two-step: request, then confirm with the emailed word. */
export const DeleteAccountReqZ = z.object({ confirm: z.literal("DELETE") });
export const DeleteAccountResZ = z.object({ deletedAt: z.string(), purgeAt: z.string() });
export const CancelDeletionResZ = z.object({ restored: z.boolean() });

/** GDPR/APPI data export (SCR-036). Returned inline; large accounts get a truncated flag. */
export const ExportDataResZ = z.object({
  exportedAt: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().nullable(),
    locale: LocaleZ,
    birthYear: z.number().int().nullable(),
    createdAt: z.string(),
  }),
  personas: z.array(z.record(z.string(), z.unknown())),
  posts: z.array(z.record(z.string(), z.unknown())),
  dms: z.array(z.record(z.string(), z.unknown())),
  purchases: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean(),
});

/** S1-6 analytics/personalised-ads consent. Minors can never turn it on. */
export const ConsentReqZ = z.object({ analytics: z.boolean() });
export const ConsentResZ = z.object({ analytics: z.boolean(), locked: z.boolean() });

export const ReportTargetZ = z.enum(["post", "dm_message", "character", "world"]);
export const ReportReasonZ = z.enum(["harassment", "sexual", "self_harm", "hate", "off_character", "other"]);
export const ReportReqZ = z.object({
  target: ReportTargetZ,
  targetId: z.string(),
  reason: ReportReasonZ,
  note: z.string().max(500).default(""),
});
export const ReportResZ = z.object({ id: z.string(), status: z.string() });

export const BlockReqZ = z.object({ personaId: z.string(), characterId: z.string() });
export const BlockedListResZ = z.object({
  blocked: z.array(
    z.object({ characterId: z.string(), handle: z.string(), displayName: z.string(), createdAt: z.string() }),
  ),
});

/* ============================================================
 * S2 — retention & growth
 * ========================================================== */

/** S2-2 Expo push token registration. */
export const PushPlatformZ = z.enum(["ios", "android", "web"]);
export const RegisterPushReqZ = z.object({ token: z.string().min(8), platform: PushPlatformZ });
export const RegisterPushResZ = z.object({ registered: z.boolean() });

/** S2-1 Offline World Director — "While you were away". */
export const DigestResZ = z.object({
  digest: z
    .object({
      id: z.string(),
      headline: z.string(),
      body: z.string(),
      postIds: z.array(z.string()),
      createdAt: z.string(),
      seenAt: z.string().nullable(),
    })
    .nullable(),
});
export const MarkDigestSeenResZ = z.object({ seenAt: z.string() });

/** S2-3 Relationship Memory Ledger — what a character remembers, with receipts. */
export const MemoryLedgerResZ = z.object({
  character: z.object({ handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
  affinity: z.number().int(),
  summary: z.string(),
  memories: z.array(
    z.object({
      id: z.string(),
      note: z.string(),
      sourceRef: z.string(),
      /** the quoted text of the post/message that created the memory, when it still exists */
      quote: z.string().nullable(),
      consolidated: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});

/** S2-4 Shareable Moment — a vertical card the user can screenshot/share. */
export const MomentResZ = z.object({
  moment: z.object({
    id: z.string(),
    shareSlug: z.string(),
    headline: z.string(),
    body: z.string(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  }),
});
export const MomentListResZ = z.object({ moments: z.array(MomentResZ.shape.moment) });

/* ---------- The reel: a moment as something that moves ---------- */
/**
 * A still card cannot carry "this world is interesting" onto TikTok or Shorts — the thing that is
 * good about a drama beat is the *turn*, and a screenshot has already spoiled it. So a moment also
 * comes back as a timeline the client can animate and record.
 *
 * The server owns the timing, not the client, for two reasons: every viewer of a shared reel sees
 * the same cut, and a recorded video and the on-screen animation cannot drift apart.
 */
export const ReelBeatKindZ = z.enum(["setup", "post", "reply", "stat", "headline", "outro"]);
export const ReelBeatZ = z.object({
  kind: ReelBeatKindZ,
  /** ms from the start of the reel */
  at: z.number().int().min(0),
  holdMs: z.number().int().min(0),
  handle: z.string().nullable().default(null),
  displayName: z.string().nullable().default(null),
  text: z.string(),
  /** for `stat`: what moved and by how much, so the number can count rather than appear */
  delta: z
    .object({ followers: z.number().int(), aura: z.number().int(), humor: z.number().int() })
    .nullable()
    .default(null),
});
export const MomentReelResZ = z.object({
  slug: z.string(),
  worldTitle: z.string(),
  worldSlug: z.string(),
  personaHandle: z.string(),
  creatorHandle: z.string().nullable().default(null),
  durationMs: z.number().int(),
  beats: z.array(ReelBeatZ),
});

/* ---------- Moderation, measured ---------- */
/**
 * Every `WORLD_MODERATION` number was picked for a product with no users. This is what makes them
 * re-derivable: the queue as it actually behaves, next to the thresholds actually in force.
 */
export const ModerationMetricsResZ = z.object({
  thresholds: z.object({
    reportsToPull: z.number().int(),
    reviewSlaHours: z.number().int(),
    resubmitCooldownHours: z.number().int(),
    claimMinutes: z.number().int(),
  }),
  queue: z.object({
    waiting: z.number().int(),
    overdue: z.number().int(),
    appeals: z.number().int(),
    pulled: z.number().int(),
    oldestWaitingHours: z.number(),
  }),
  decisions: z.object({
    last7d: z.number().int(),
    approved: z.number().int(),
    rejected: z.number().int(),
    approvalRate: z.number(),
    medianLatencyHours: z.number().nullable(),
    p90LatencyHours: z.number().nullable(),
  }),
  reports: z.object({
    open: z.number().int(),
    last7d: z.number().int(),
    /** the number the pull threshold should actually be derived from */
    perThousandPlays: z.number(),
    pullsLast7d: z.number().int(),
    /** pulls a human then re-approved: how often the threshold is wrong */
    pullsReapproved: z.number().int(),
  }),
  /** what one reviewed world costs to review, at the rate an operator supplies */
  economics: z.object({
    worldsReviewedLast7d: z.number().int(),
    estimatedReviewMinutes: z.number(),
    generationCostUsd: z.number(),
  }),
});

/** S2-5 Referral. */
export const ReferralResZ = z.object({
  code: z.string(),
  link: z.string(),
  invited: z.number().int(),
  coffeeEarned: z.number().int(),
  canRedeem: z.boolean(),
});
export const RedeemReferralReqZ = z.object({ code: z.string().min(4).max(16) });
export const RedeemReferralResZ = z.object({ coffee: z.number().int(), energy: z.number().int() });

/** S2-6 Profile (SCR-026). */
export const ProfileResZ = z.object({
  persona: PersonaZ,
  levelProgress: z.object({ level: z.number().int(), xp: z.number().int(), xpForNext: z.number().int() }),
  posts: z.array(PostZ),
  relationships: z.array(
    z.object({
      characterId: z.string(),
      handle: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      affinity: z.number().int(),
      isFollower: z.boolean(),
      memoryCount: z.number().int(),
    }),
  ),
  recentSnapshots: z.array(StatSnapshotZ),
});

/* ============================================================
 * S3 — cost observability (cost-architecture §6.4)
 * ========================================================== */

export const CostRowZ = z.object({
  key: z.string(),
  calls: z.number().int(),
  inputTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  fallbacks: z.number().int(),
  p50LatencyMs: z.number(),
  p95LatencyMs: z.number(),
});
export const CostSummaryResZ = z.object({
  since: z.string(),
  until: z.string(),
  totals: CostRowZ,
  byDay: z.array(CostRowZ),
  byGenerator: z.array(CostRowZ),
  byVariant: z.array(CostRowZ),
  byModel: z.array(CostRowZ),
  /** the numbers cost-architecture §4 is judged on */
  perAction: z.object({ actions: z.number().int(), usdPerAction: z.number(), usdPerActiveUser: z.number() }),
  cacheHitRate: z.number(),
  ratings: z.object({ up: z.number().int(), down: z.number().int(), regenerations: z.number().int() }),
});

/* ============================================================
 * Engagement — notifications, streaks, achievements, trending
 * ========================================================== */

export const NotificationKindZ = z.enum([
  "like",
  "reply",
  "follow",
  "mention",
  "dm",
  "milestone",
  "event",
  "digest",
  "unlock",
  /** Circuit ① — the author's return signal. A play count in a table is not a return signal. */
  "world_played",
  "world_ready",
  "world_reviewed",
  "world_pulled",
]);
export const NotificationZ = z.object({
  id: z.string(),
  kind: NotificationKindZ,
  text: z.string(),
  target: z.string().nullable(),
  actor: z.object({ handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export const NotificationsResZ = z.object({
  notifications: z.array(NotificationZ),
  unread: z.number().int(),
  nextCursor: z.string().nullable(),
});
export const MarkNotificationsReadReqZ = z.object({ ids: z.array(z.string()).nullable().default(null) });
export const MarkNotificationsReadResZ = z.object({ unread: z.number().int() });

/** Login streak + the daily reward it pays. Checked in on every `/v1/me`. */
export const StreakResZ = z.object({
  days: z.number().int(),
  best: z.number().int(),
  claimedToday: z.boolean(),
  /** what today's check-in paid, null when it was already claimed */
  reward: z.object({ energy: z.number().int(), coffee: z.number().int(), gems: z.number().int() }).nullable(),
  /** the next seven days of the ladder, for the strip in the UI */
  ladder: z.array(
    z.object({
      day: z.number().int(),
      energy: z.number().int(),
      coffee: z.number().int(),
      gems: z.number().int(),
      reached: z.boolean(),
    }),
  ),
});

export const AchievementZ = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string(),
  tier: z.enum(["bronze", "silver", "gold", "legendary"]),
  unlockedAt: z.string().nullable(),
  seenAt: z.string().nullable(),
  value: z.number().int(),
  /** 0..1 toward the threshold, so locked rows can show a bar instead of nothing */
  progress: z.number(),
});
export const AchievementsResZ = z.object({
  achievements: z.array(AchievementZ),
  unlocked: z.number().int(),
  total: z.number().int(),
  /** unlocked but never shown — the client pops a celebration for these, then marks them seen */
  pending: z.array(AchievementZ),
});
export const MarkAchievementsSeenReqZ = z.object({ keys: z.array(z.string()) });

/** What the world is talking about right now. Derived from recent posts, no table. */
export const TrendingResZ = z.object({
  topics: z.array(
    z.object({
      label: z.string(),
      posts: z.number().int(),
      heat: z.number().int(),
      /** the single hottest post carrying this topic, so the row can be tapped */
      postId: z.string().nullable(),
    }),
  ),
  risingCharacters: z.array(
    z.object({
      handle: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable(),
      affinity: z.number().int(),
      delta: z.number().int(),
    }),
  ),
  yourRank: z.object({ percentile: z.number(), followers: z.number().int(), trending: z.boolean() }),
});

/** A character's own page — their posts, their read on you, whether they follow you. */
export const CharacterProfileResZ = z.object({
  character: CharacterZ,
  bio: z.string(),
  relationship: z.object({
    affinity: z.number().int(),
    summary: z.string(),
    isFollower: z.boolean(),
    memoryCount: z.number().int(),
  }),
  posts: z.array(PostZ),
  blocked: z.boolean(),
});

/* ============================================================
 * Cost engine — bandit allocation and offline evaluation
 * (cost-architecture §6.2 / §6.3)
 * ========================================================== */

export const BanditArmZ = z.object({
  generator: z.string(),
  variantId: z.string(),
  model: z.string(),
  tier: z.string(),
  isChampion: z.boolean(),
  disabled: z.boolean(),
  disabledReason: z.string().nullable(),
  calls: z.number().int(),
  /** posterior mean of the reward, i.e. alpha / (alpha + beta) */
  meanReward: z.number(),
  /** 95% credible interval, so a thin arm reads as uncertain rather than good */
  ci: z.tuple([z.number(), z.number()]),
  usdPerCall: z.number(),
  /** share of traffic this arm is currently taking */
  allocation: z.number(),
});
export const BanditStateResZ = z.object({
  generators: z.array(
    z.object({
      generator: z.string(),
      champion: z.string(),
      arms: z.array(BanditArmZ),
      /** probability the leader is genuinely best, from the sampler */
      pBest: z.number(),
      promotable: z.boolean(),
    }),
  ),
  lambda: z.number(),
  updatedAt: z.string(),
});
export const PromoteReqZ = z.object({
  generator: z.string(),
  variantId: z.string(),
  reason: z.string().max(200).default("manual"),
});
export const PromoteResZ = z.object({ generator: z.string(), champion: z.string(), previous: z.string().nullable() });

export const EvalStatusZ = z.enum(["running", "finished", "failed"]);
export const EvalRunZ = z.object({
  id: z.string(),
  generator: z.string(),
  variantId: z.string(),
  status: EvalStatusZ,
  cases: z.number().int(),
  passed: z.number().int(),
  meanScore: z.number(),
  costUsd: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export const EvalRunsResZ = z.object({ runs: z.array(EvalRunZ) });
export const StartEvalReqZ = z.object({
  generator: z.string(),
  variantId: z.string(),
  /** cap so an accidental run cannot spend the month's budget */
  limit: z.number().int().min(1).max(500).default(50),
});
export const EvalCompareResZ = z.object({
  generator: z.string(),
  /** one row per variant with the numbers a promotion decision is made on */
  rows: z.array(
    z.object({
      variantId: z.string(),
      runs: z.number().int(),
      cases: z.number().int(),
      passRate: z.number(),
      meanScore: z.number(),
      usdPerCase: z.number(),
      /** versus the champion, negative is cheaper */
      costDelta: z.number(),
      scoreDelta: z.number(),
      /** the §6.2 gate: within 2 points of quality and at least 20% cheaper, or 3 points better */
      passesGate: z.boolean(),
    }),
  ),
});

/** Scheduler visibility — which jobs exist, when they last ran, and what they did. */
export const JobRunZ = z.object({
  job: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  ok: z.boolean(),
  processed: z.number().int(),
  error: z.string().nullable(),
});
export const JobsResZ = z.object({
  jobs: z.array(
    z.object({
      name: z.string(),
      schedule: z.string(),
      enabled: z.boolean(),
      lastRun: JobRunZ.nullable(),
      nextRunAt: z.string().nullable(),
    }),
  ),
});
export const RunJobReqZ = z.object({ job: z.string(), personaId: z.string().nullable().default(null) });

/* ============================================================
 * World Studio (AIF-003) — one line in, a playable world out
 * ========================================================== */

export const WorldStatusZ = z.enum(["draft", "generating", "ready", "review", "published", "rejected"]);
export const WorldVisibilityZ = z.enum(["private", "unlisted", "public"]);

/** Genre steers the generator without the player having to write a design document. */

export const CreateWorldReqZ = z.object({
  /** the one line the whole world is generated from */
  premise: z.string().min(8).max(200),
  genre: WorldGenreZ,
  locale: LocaleZ,
  /** created private; publishing is a separate, reviewed step */
  visibility: WorldVisibilityZ.default("private"),
});

/* ---------- Exit 3: make the human's twenty minutes shorter ---------- */
/**
 * What a reviewer is actually deciding, extracted before they open the world.
 *
 * The gate today answers "block or not". A reviewer's twenty minutes go on the questions it does
 * not answer — is this somebody else's IP with the names filed off, is the JA written or
 * translated, is this 13+ in spirit rather than in vocabulary — so this puts those in front of
 * them with the evidence attached. It is advice, never a verdict: `confidence` exists so a
 * reviewer can tell a strong signal from a guess, and every point cites where in the world it came
 * from so it can be checked rather than believed.
 */
export const ReviewPointZ = z.object({
  /** the rule from docs/moderation.md §3 this bears on */
  rule: z.enum(["original", "age", "playable", "locales", "vector"]),
  concern: z.string(),
  /** the passage it came from, so the reviewer reads the world and not the summary */
  evidence: z.string(),
  confidence: z.enum(["low", "medium", "high"]),
});
export const ReviewDigestZ = z.object({
  points: z.array(ReviewPointZ),
  /** null when nothing was extracted — an empty digest is a fact, not a pass */
  generatedAt: z.string().nullable(),
  sampled: z.boolean(),
});

/* ---------- Exit 2: trust, so review load follows new creators and not worlds ---------- */
export const CreatorTrustZ = z.object({
  approvals: z.number().int(),
  trusted: z.boolean(),
  /** approvals still needed; null once trusted */
  toTrusted: z.number().int().nullable(),
});

export const WorldSummaryFullZ = WorldSummaryZ.extend({
  status: WorldStatusZ,
  visibility: WorldVisibilityZ,
  premise: z.string(),
  isPreset: z.boolean(),
  isMine: z.boolean(),
  creatorHandle: z.string().nullable(),
  playCount: z.number().int(),
  castCount: z.number().int(),
  createdAt: z.string(),
  /** only set while status is rejected or the generation failed */
  reason: z.string().nullable(),
  /**
   * True when this world was live and enough players reported it to take it back off the shelf.
   * It is `review` either way; the creator is owed the difference between "not looked at yet" and
   * "taken down for another look", so the two say different things on screen.
   */
  pulled: z.boolean().default(false),
  /**
   * Appeal state, from the creator's side. A rejection the creator believes was misread is the one
   * case where "wait 24h and resubmit the same world" is the wrong answer, so `canAppeal` says
   * whether saying so is still available and `appealed` says it has been used.
   */
  canAppeal: z.boolean().default(false),
  appealed: z.boolean().default(false),
  /** The world this one was remixed from, so a derivative credits what it came out of. */
  remixOf: z
    .object({ id: z.string(), slug: z.string(), title: z.string(), creatorHandle: z.string().nullable() })
    .nullable()
    .default(null),
  remixCount: z.number().int().default(0),
});
export const CreateWorldResZ = z.object({
  world: WorldSummaryFullZ,
  /** what the create cost, so the client can show it rather than silently draining a wallet */
  charged: z.object({ gems: z.number().int(), remaining: z.number().int() }),
});
export const WorldStatusResZ = z.object({
  world: WorldSummaryFullZ,
  /** 0..1 while generating, so the wait can be a beat rather than a spinner */
  progress: z.number(),
  cast: z.array(z.object({ handle: z.string(), displayName: z.string(), role: z.string(), intro: z.string() })),
});
export const MyWorldsResZ = z.object({
  worlds: z.array(WorldSummaryFullZ),
  /** how many more this account may create today */
  remainingToday: z.number().int(),
  /**
   * The shelf fee **in force on this deployment**, not the constant the client shipped with. The
   * fee is env-tunable so it can move without a deploy, which means a client rendering its own
   * constant can show a price that is not the price.
   */
  publicSubmitGems: z.number().int().default(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS),
});
/**
 * Explore's community shelf. `worlds` is the ranked list; `fresh` is the slot that exists so a
 * ranking cannot become winner-take-all — worlds nobody has played yet, shown because they are new
 * and for no other reason. Without it a new author's first world never reaches its first ten
 * players and the whole creator loop dies at the third circuit.
 */
export const PublicWorldsResZ = z.object({
  worlds: z.array(WorldSummaryFullZ),
  fresh: z.array(WorldSummaryFullZ).default([]),
  nextCursor: z.string().nullable(),
});

/* ---------- Circuit ②: the creator, as a place you can go ---------- */
export const CreatorProfileResZ = z.object({
  handle: z.string(),
  isYou: z.boolean(),
  /** only ever sent to the creator themselves — a public trust badge is a target */
  trust: CreatorTrustZ.nullable().default(null),
  worldCount: z.number().int(),
  totalPlays: z.number().int(),
  joinedAt: z.string(),
  worlds: z.array(WorldSummaryFullZ),
});

/** Renaming the name your worlds are credited to. Same shape as a persona handle. */
export const SetCreatorHandleReqZ = z.object({ handle: z.string().regex(/^[a-z0-9_]{3,15}$/) });
export const SetCreatorHandleResZ = z.object({ creatorHandle: z.string() });

/* ---------- Circuit ④: making a world out of one you played ---------- */
/**
 * A remix keeps the source world's genre and locale and takes a new premise — the cheapest possible
 * consumer→author conversion, because the hardest parts of the blank page are already filled in.
 * It costs the same as any other world; what is cheaper is the deciding, not the generating.
 */
export const RemixWorldReqZ = z.object({
  premise: z.string().min(8).max(200),
  genre: WorldGenreZ.optional(),
  locale: LocaleZ.optional(),
  visibility: WorldVisibilityZ.default("private"),
});

export const PublishWorldReqZ = z.object({ visibility: WorldVisibilityZ });
export const PublishWorldResZ = z.object({
  world: WorldSummaryFullZ,
  needsReview: z.boolean(),
  /** gems taken for the shelf, and what is left — 0 when the world is not going public */
  charged: z.object({ gems: z.number().int(), remaining: z.number().int() }).default({ gems: 0, remaining: 0 }),
});

/** Admin review queue for worlds asking to go public. */
export const WorldReviewQueueResZ = z.object({
  worlds: z.array(
    WorldSummaryFullZ.extend({
      bibleExcerpt: z.string(),
      cast: z.array(z.object({ handle: z.string(), displayName: z.string(), role: z.string() })),
      safety: z.string().nullable(),
      safetyNote: z.string(),
      /** distinct reporters on this world — a queue sorted by luck is not a queue */
      reportCount: z.number().int(),
      /** how long it has been waiting, and whether that is past WORLD_MODERATION.REVIEW_SLA_HOURS */
      waitingHours: z.number(),
      overdue: z.boolean(),
      /** what people said about it, newest first, so the reviewer reads the complaint not just the world */
      reports: z.array(z.object({ reason: z.string(), note: z.string(), createdAt: z.string() })),
      /** the creator's case, when this is back in the queue because they appealed a rejection */
      appeal: z.object({ message: z.string(), createdAt: z.string(), previousReason: z.string() }).nullable(),
      /** who is looking at it right now, so two reviewers do not spend the same twenty minutes */
      claimedBy: z.string().nullable(),
      claimedUntil: z.string().nullable(),
      /** what to look at first, and whether this one was drawn for a full read */
      digest: ReviewDigestZ.nullable().default(null),
      creatorTrust: CreatorTrustZ.nullable().default(null),
    }),
  ),
  overdueCount: z.number().int(),
  appealCount: z.number().int(),
});

/** A reviewer takes a world for `WORLD_MODERATION.CLAIM_MINUTES`; it returns to the queue after. */
export const ClaimWorldResZ = z.object({ worldId: z.string(), claimedUntil: z.string(), claimedByYou: z.boolean() });
export const ReviewWorldReqZ = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(300).default(""),
});

/** SCR-049 → a rejected world's creator says the decision read it wrong. Once per rejection. */
export const AppealWorldReqZ = z.object({ message: z.string().min(10).max(500) });
export const AppealWorldResZ = z.object({ world: WorldSummaryFullZ });
