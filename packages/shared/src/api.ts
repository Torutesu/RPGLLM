import { z } from "zod";
import { LocaleZ, StatDeltasZ } from "./generators";
import { PLANS } from "./constants";

/** ---------- Common ---------- */
export const ErrorCodeZ = z.enum([
  "UNAUTHORIZED", "UNDER_13", "VALIDATION", "NOT_FOUND", "ENERGY_REQUIRED", "SAFETY_BLOCKED",
  "AD_LIMIT", "HANDLE_TAKEN", "ALREADY_DONE", "INTERNAL",
  /** S0-4 rate limiting (429) */
  "RATE_LIMITED",
  /** S1-1 the account is scheduled for deletion (410) */
  "ACCOUNT_DELETED",
  /** S1-2 the target is blocked by this persona (409) */
  "BLOCKED",
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
  energy: z.number().int(), coffee: z.number().int(), gems: z.number().int(),
  dailyRefillAt: z.string(), adRewardsToday: z.number().int(), adsEnabled: z.boolean(), adPersonalized: z.boolean(),
  dailyMax: z.number().int(),
});
export const SubscriptionZ = z.object({ plan: z.enum(Object.keys(PLANS) as [keyof typeof PLANS, ...(keyof typeof PLANS)[]]), active: z.boolean(), renewsAt: z.string().nullable() });
export const PersonaZ = z.object({
  id: z.string(), worldId: z.string(), worldSlug: z.string(), handle: z.string(), displayName: z.string(), bio: z.string(),
  avatarUrl: z.string().nullable(), followers: z.number().int(), aura: z.number().int(), humor: z.number().int(),
  level: z.number().int(), xp: z.number().int(), actionCount: z.number().int(),
});
export const MeResZ = z.object({
  user: z.object({ id: z.string(), locale: LocaleZ, isMinor: z.boolean(), birthYear: z.number().int().nullable() }),
  wallet: WalletZ, subscription: SubscriptionZ.nullable(), persona: PersonaZ.nullable(),
});

/** ---------- Worlds (SCR-003/004/006) ---------- */
export const WorldSummaryZ = z.object({ id: z.string(), slug: z.string(), title: z.string(), scenario: z.string(), difficulty: z.number().int(), coverUrl: z.string().nullable() });
export const WorldsResZ = z.array(WorldSummaryZ);
export const CharacterZ = z.object({ id: z.string(), handle: z.string(), displayName: z.string(), role: z.string(), avatarUrl: z.string().nullable(), isPressAccount: z.boolean(), canBeFirstFollower: z.boolean(), intro: z.string() });
export const PresetPersonaZ = z.object({ handle: z.string(), displayName: z.string(), bio: z.string(), avatarUrl: z.string().nullable() });
export const WorldDetailResZ = z.object({ world: WorldSummaryZ, characters: z.array(CharacterZ), presetPersonas: z.array(PresetPersonaZ) });

/** ---------- Personas (SCR-005/006) ---------- */
export const HandleCheckReqZ = z.object({ worldId: z.string(), handle: z.string() });
export const HandleCheckResZ = z.object({ available: z.boolean() });
export const CreatePersonaReqZ = z.object({
  worldId: z.string(), handle: z.string().regex(/^[a-z0-9_]{3,15}$/), displayName: z.string().min(1).max(40), bio: z.string().max(160).default(""),
  avatarUrl: z.string().nullable().default(null), voiceNotes: z.string().max(200).default(""), firstFollowerId: z.string(), idempotencyKey: z.string(),
});
export const CreatePersonaResZ = z.object({ persona: PersonaZ, feedReady: z.boolean() });

/** ---------- Feed / Posts (SCR-010/011/012) ---------- */
export const PostKindZ = z.enum(["user", "character", "news", "ambient", "system"]);
export const PostZ = z.object({
  id: z.string(), kind: PostKindZ, text: z.string(), parentId: z.string().nullable(),
  author: z.object({ handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable(), verified: z.boolean(), isYou: z.boolean() }),
  metrics: z.object({ likes: z.number().int(), reposts: z.number().int(), replies: z.number().int() }),
  generationId: z.string().nullable(), createdAt: z.string(),
  replies: z.array(z.lazy((): z.ZodTypeAny => PostZ)).optional(),
});
export type Post = z.infer<typeof PostZ>;
export const StatSnapshotZ = z.object({
  id: z.string(), cause: z.string(), narrative: z.string(), followersDelta: z.number().int(), auraDelta: z.number().int(), humorDelta: z.number().int(),
  relDeltas: z.record(z.string(), z.number().int()), after: z.object({ followers: z.number().int(), aura: z.number().int(), humor: z.number().int() }), createdAt: z.string(),
});
export const EventZ = z.object({
  id: z.string(), title: z.string(), prompt: z.string(),
  choices: z.array(z.object({ id: z.string(), label: z.string() })).length(3), chosenId: z.string().nullable(),
});
export const FeedResZ = z.object({ posts: z.array(PostZ), nextCursor: z.string().nullable(), pendingEvent: EventZ.nullable(), lastSnapshot: StatSnapshotZ.nullable() });
export const CreatePostReqZ = z.object({ personaId: z.string(), text: z.string().min(1).max(280), parentId: z.string().nullable().default(null) });
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
export const ChooseEventResZ = z.object({ snapshot: StatSnapshotZ, newsPost: PostZ.nullable(), energy: z.number().int() });
export const StatResZ = z.object({ snapshot: StatSnapshotZ, persona: z.object({ followers: z.number().int(), aura: z.number().int(), humor: z.number().int() }) });

/** ---------- DMs (SCR-020/021) ---------- */
export const DMThreadZ = z.object({
  id: z.string(), character: CharacterZ, lastMessage: z.string().nullable(), lastMessageAt: z.string(), unreadCount: z.number().int(),
});
export const DMMessageZ = z.object({ id: z.string(), fromCharacter: z.boolean(), text: z.string(), generationId: z.string().nullable(), createdAt: z.string() });
export const RelationshipZ = z.object({ characterHandle: z.string(), affinity: z.number().int(), summary: z.string(), isFollower: z.boolean() });
export const DMListResZ = z.object({ threads: z.array(DMThreadZ), followers: z.array(CharacterZ) });
export const CreateThreadReqZ = z.object({ personaId: z.string(), characterId: z.string() });
export const CreateThreadResZ = z.object({ thread: DMThreadZ });
export const DMThreadResZ = z.object({ thread: DMThreadZ, messages: z.array(DMMessageZ), relationship: RelationshipZ, nextCursor: z.string().nullable() });
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
export const RateReqZ = z.object({ value: z.union([z.literal(-1), z.literal(1)]), regenerate: z.boolean().default(false) });
export const RateResZ = z.object({ replacement: z.union([PostZ, DMMessageZ]).nullable(), newGenerationId: z.string().nullable() });
export const AssignmentsResZ = z.record(z.string(), z.string());
export const HealthResZ = z.object({ ok: z.boolean(), llmMode: z.string(), champion: z.record(z.string(), z.string()) });

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
  user: z.object({ id: z.string(), email: z.string().nullable(), locale: LocaleZ, birthYear: z.number().int().nullable(), createdAt: z.string() }),
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
  blocked: z.array(z.object({ characterId: z.string(), handle: z.string(), displayName: z.string(), createdAt: z.string() })),
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
  digest: z.object({
    id: z.string(),
    headline: z.string(),
    body: z.string(),
    postIds: z.array(z.string()),
    createdAt: z.string(),
    seenAt: z.string().nullable(),
  }).nullable(),
});
export const MarkDigestSeenResZ = z.object({ seenAt: z.string() });

/** S2-3 Relationship Memory Ledger — what a character remembers, with receipts. */
export const MemoryLedgerResZ = z.object({
  character: z.object({ handle: z.string(), displayName: z.string(), avatarUrl: z.string().nullable() }),
  affinity: z.number().int(),
  summary: z.string(),
  memories: z.array(z.object({
    id: z.string(),
    note: z.string(),
    sourceRef: z.string(),
    /** the quoted text of the post/message that created the memory, when it still exists */
    quote: z.string().nullable(),
    consolidated: z.boolean(),
    createdAt: z.string(),
  })),
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
  relationships: z.array(z.object({
    characterId: z.string(),
    handle: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
    affinity: z.number().int(),
    isFollower: z.boolean(),
    memoryCount: z.number().int(),
  })),
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
