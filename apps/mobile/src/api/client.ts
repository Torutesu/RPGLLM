import {
  ApiErrorZ, AuthResZ, AgeGateResZ, MeResZ, WorldsResZ, WorldDetailResZ, HandleCheckResZ,
  CreatePersonaResZ, FeedResZ, CreatePostResZ, PostDetailResZ, MoreRepliesResZ, PendingEventResZ,
  ChooseEventResZ, StatResZ, DMListResZ, CreateThreadResZ, DMThreadResZ, SendDMResZ, WalletResZ,
  AdRewardResZ, CoffeeResZ, OfferingsResZ, DevPurchaseResZ, RateResZ, AssignmentsResZ, HealthResZ,
  // S1 (Agent G): account deletion / export / consent and report / block.
  DeleteAccountResZ, CancelDeletionResZ, ExportDataResZ, ConsentResZ, ReportResZ, BlockedListResZ,
  // S2 (Agent H): digest / memory / moments / referral / profile / push.
  DigestResZ, MarkDigestSeenResZ, MemoryLedgerResZ, MomentResZ, MomentListResZ, ReferralResZ,
  RedeemReferralResZ, ProfileResZ, RegisterPushResZ,
  // Feed & discovery (Agent K): SCR-046 trending / explore, SCR-047 character profile.
  TrendingResZ, CharacterProfileResZ,
  // Engagement (Agent L): notifications / streak / achievements.
  NotificationsResZ, MarkNotificationsReadResZ, StreakResZ, AchievementsResZ,
  // World Studio (SCR-048/049/050): create a world from one line, watch it build, publish it.
  CreateWorldResZ, WorldStatusResZ, PublishWorldResZ, MyWorldsResZ, PublicWorldsResZ,
  type ErrorCode, type Locale, type PlanId, type ReportReason, type WorldGenre,
} from "@rpgllm/shared";
import { API_BASE, g } from "../env";
import { getToken } from "../auth/token";

/** `ReportTargetZ` has no exported TS alias in the contract; this mirrors it 1:1. */
export type ReportTarget = "post" | "dm_message" | "character" | "world";

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
  get isEnergy() { return this.code === "ENERGY_REQUIRED" || this.status === 402; }
  get isSafety() { return this.code === "SAFETY_BLOCKED" || this.status === 422; }
  get isNetwork() { return this.status === 0; }
}

export type ApiHandlers = {
  onEnergyRequired?: (e: ApiError) => void;
  onUnauthorized?: (e: ApiError) => void;
  onNetworkError?: (e: ApiError) => void;
};
let handlers: ApiHandlers = {};
/** Wired once by the app store so the client can drive global UI (energy modal, toast). */
export function setApiHandlers(h: ApiHandlers): void {
  handlers = h;
}

type Schema<T> = { parse: (u: unknown) => T };
type Query = Record<string, string | number | null | undefined>;
type Options<T> = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Query;
  schema: Schema<T>;
  auth?: boolean;
  /**
   * Whether a failure may drive app-wide UI. The default is `true`: a 402 opens the energy modal
   * and a 5xx raises a toast. World Studio opts out — its 402 means *gems*, not energy, and the
   * screen shows the price and the way to buy inline, so bouncing to the energy modal would be a
   * lie. 401 always signs out regardless.
   */
  globalErrors?: boolean;
};

function statusToCode(status: number): ErrorCode {
  if (status === 401) return "UNAUTHORIZED";
  if (status === 402) return "ENERGY_REQUIRED";
  if (status === 403) return "UNDER_13";
  if (status === 404) return "NOT_FOUND";
  if (status === 422) return "SAFETY_BLOCKED";
  if (status === 429) return "AD_LIMIT";
  return "INTERNAL";
}

export function buildUrl(path: string, query?: Query): string {
  const base = path.startsWith("http") ? path : `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return base;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `${base}${base.includes("?") ? "&" : "?"}${parts.join("&")}` : base;
}

export async function request<T>(path: string, opts: Options<T>): Promise<T> {
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let sentToken: string | null = null;
  if (opts.auth !== false) {
    sentToken = getToken();
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    const err = new ApiError("INTERNAL", 0, e instanceof Error ? e.message : "network error");
    if (opts.globalErrors !== false) handlers.onNetworkError?.(err);
    throw err;
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const envelope = (json ?? {}) as { data?: unknown; error?: unknown };

  if (!res.ok || (envelope.error !== null && envelope.error !== undefined)) {
    const parsed = ApiErrorZ.safeParse(envelope.error);
    const code = parsed.success ? parsed.data.code : statusToCode(res.status);
    const message = parsed.success ? parsed.data.message : `HTTP ${res.status}`;
    const err = new ApiError(code, res.status, message);
    const global = opts.globalErrors !== false;
    if (global && err.isEnergy) handlers.onEnergyRequired?.(err);
    // Only a rejected *session* signs the user out; a 401 on a request that carried no bearer
    // would otherwise wipe a token that was simply not loaded yet.
    if (res.status === 401 && sentToken) handlers.onUnauthorized?.(err);
    if (global && res.status >= 500) handlers.onNetworkError?.(err);
    throw err;
  }

  try {
    return opts.schema.parse(envelope.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    g.__lastParseError = { path, message };
    if (typeof console !== "undefined") console.warn(`[api] contract mismatch on ${path}: ${message}`);
    throw new ApiError("VALIDATION", res.status, `contract mismatch on ${path}`);
  }
}

/** Typed endpoint surface — mirrors spec/03-api.md 1:1. */
export const api = {
  health: () => request("/health", { schema: HealthResZ, auth: false }),

  /** Sends the login code. Optional on the server (dev code is fixed), so failures are ignored. */
  authStart: async (email: string) => {
    try {
      await request("/auth/email/start", { method: "POST", body: { email }, schema: { parse: (u: unknown) => u }, auth: false });
    } catch {
      /* endpoint may not exist in dev/test — the fixed dev code still verifies */
    }
  },
  authVerify: (email: string, code: string) =>
    request("/auth/email", { method: "POST", body: { email, code }, schema: AuthResZ, auth: false }),
  ageGate: (birthYear: number, locale: Locale) =>
    request("/auth/age-gate", { method: "POST", body: { birthYear, locale }, schema: AgeGateResZ }),

  me: () => request("/me", { schema: MeResZ }),
  worlds: () => request("/worlds", { schema: WorldsResZ }),
  world: (id: string) => request(`/worlds/${encodeURIComponent(id)}`, { schema: WorldDetailResZ }),
  checkHandle: (worldId: string, handle: string) =>
    request("/personas/check", { query: { worldId, handle }, schema: HandleCheckResZ }),
  createPersona: (body: {
    worldId: string; handle: string; displayName: string; bio: string; avatarUrl: string | null;
    voiceNotes: string; firstFollowerId: string; idempotencyKey: string;
  }) => request("/personas", { method: "POST", body, schema: CreatePersonaResZ }),

  feed: (personaId: string, cursor?: string | null) =>
    request("/feed", { query: { personaId, cursor }, schema: FeedResZ }),
  createPost: (personaId: string, text: string, parentId: string | null) =>
    request("/posts", { method: "POST", body: { personaId, text, parentId }, schema: CreatePostResZ }),
  post: (id: string) => request(`/posts/${encodeURIComponent(id)}`, { schema: PostDetailResZ }),
  moreReplies: (id: string) =>
    request(`/posts/${encodeURIComponent(id)}/more-replies`, { method: "POST", body: {}, schema: MoreRepliesResZ }),

  pendingEvent: (personaId: string) => request("/events/pending", { query: { personaId }, schema: PendingEventResZ }),
  chooseEvent: (id: string, choiceId: string) =>
    request(`/events/${encodeURIComponent(id)}/choose`, { method: "POST", body: { choiceId }, schema: ChooseEventResZ }),
  stat: (snapshotId: string) => request(`/stats/${encodeURIComponent(snapshotId)}`, { schema: StatResZ }),

  dms: (personaId: string) => request("/dms", { query: { personaId }, schema: DMListResZ }),
  createThread: (personaId: string, characterId: string) =>
    request("/dms", { method: "POST", body: { personaId, characterId }, schema: CreateThreadResZ }),
  dmThread: (threadId: string, cursor?: string | null) =>
    request(`/dms/${encodeURIComponent(threadId)}`, { query: { cursor }, schema: DMThreadResZ }),
  sendDM: (threadId: string, text: string) =>
    request(`/dms/${encodeURIComponent(threadId)}/messages`, { method: "POST", body: { text }, schema: SendDMResZ }),

  wallet: () => request("/wallet", { schema: WalletResZ }),
  adReward: (adToken: string) => request("/wallet/ad-reward", { method: "POST", body: { adToken }, schema: AdRewardResZ }),
  coffee: () => request("/wallet/coffee", { method: "POST", body: { count: 1 }, schema: CoffeeResZ }),

  offerings: () => request("/billing/offerings", { schema: OfferingsResZ }),
  devPurchase: (plan: PlanId) => request("/billing/dev-purchase", { method: "POST", body: { plan }, schema: DevPurchaseResZ }),

  /** `postId` disambiguates: one G1 call produces K replies that share a generationId. */
  rate: (generationId: string, value: 1 | -1, regenerate: boolean, postId?: string) =>
    request(`/generations/${encodeURIComponent(generationId)}/rate`, {
      method: "POST", body: { value, regenerate }, query: { postId }, schema: RateResZ,
    }),
  assignments: () => request("/experiments/assignments", { schema: AssignmentsResZ }),

  /* ---------- S1 store-compliance surface (Agent G) ---------- */

  /** Guideline 3.1.1 — restore purchases from the store account. */
  restorePurchases: (rcAppUserId: string) =>
    request("/billing/restore", {
      method: "POST", body: { rcAppUserId },
      schema: { parse: (u: unknown) => u as { subscription: { plan: string; active: boolean } | null } },
    }),

  /** Guideline 5.1.1(v) — in-app account deletion. */
  deleteAccount: () => request("/account/delete", { method: "POST", body: { confirm: "DELETE" }, schema: DeleteAccountResZ }),
  restoreAccount: () => request("/account/restore", { method: "POST", body: {}, schema: CancelDeletionResZ }),
  exportData: () => request("/account/export", { schema: ExportDataResZ }),
  setConsent: (analytics: boolean) =>
    request("/account/consent", { method: "POST", body: { analytics }, schema: ConsentResZ }),

  /** Guideline 1.2 — report and block. */
  report: (body: { target: ReportTarget; targetId: string; reason: ReportReason; note: string }) =>
    request("/moderation/report", { method: "POST", body, schema: ReportResZ }),
  block: (personaId: string, characterId: string) =>
    request("/moderation/block", {
      method: "POST", body: { personaId, characterId },
      schema: { parse: (u: unknown) => u as { blocked: boolean; characterId: string; handle: string } },
    }),
  unblock: (personaId: string, characterId: string) =>
    request("/moderation/unblock", {
      method: "POST", body: { personaId, characterId },
      schema: { parse: (u: unknown) => u as { blocked: boolean; characterId: string } },
    }),
  blocked: (personaId: string) => request("/moderation/blocked", { query: { personaId }, schema: BlockedListResZ }),

  /* ---------- S2 retention & growth (Agent H) ---------- */

  /** SCR-038 — "While you were away". The read also runs the offline director when it is due. */
  digest: (personaId: string) => request("/digest", { query: { personaId }, schema: DigestResZ }),
  markDigestSeen: (id: string) =>
    request(`/digest/${encodeURIComponent(id)}/seen`, { method: "POST", body: {}, schema: MarkDigestSeenResZ }),

  /** SCR-039 — memory ledger; `character` is the handle or the character id. */
  memory: (character: string, personaId?: string) =>
    request(`/memory/${encodeURIComponent(character)}`, { query: { personaId }, schema: MemoryLedgerResZ }),

  /** SCR-040 — shareable moments. `sharedMoment` is public: it must not send a bearer. */
  moments: (personaId: string) => request("/moments", { query: { personaId }, schema: MomentListResZ }),
  sharedMoment: (slug: string) =>
    request(`/moments/${encodeURIComponent(slug)}`, { schema: MomentResZ, auth: false }),

  /** SCR-041 — invite a friend. */
  referral: () => request("/referral", { schema: ReferralResZ }),
  redeemReferral: (code: string) =>
    request("/referral/redeem", { method: "POST", body: { code }, schema: RedeemReferralResZ }),

  /** SCR-026 — profile. */
  profile: (personaId: string) => request("/profile", { query: { personaId }, schema: ProfileResZ }),

  /* ---------- Engagement surfaces (Agent L) ---------- */

  /** SCR-042 — notifications, newest first, id-cursored. */
  notifications: (personaId: string, cursor?: string | null) =>
    request("/notifications", { query: { personaId, cursor }, schema: NotificationsResZ }),
  /** `ids: null` means "all" — one tap clears the badge. */
  markNotificationsRead: (personaId: string, ids: string[] | null) =>
    request("/notifications/read", {
      method: "POST", body: { ids }, query: { personaId }, schema: MarkNotificationsReadResZ,
    }),

  /** The daily check-in. Idempotent: `/v1/me` may already have claimed today. */
  streak: () => request("/streak", { schema: StreakResZ }),

  /** SCR-044 — achievements. */
  achievements: (personaId: string) =>
    request("/achievements", { query: { personaId }, schema: AchievementsResZ }),
  markAchievementsSeen: (personaId: string, keys: string[]) =>
    request("/achievements/seen", {
      method: "POST", body: { keys }, query: { personaId },
      schema: { parse: (u: unknown) => u as { pending: number } },
    }),

  /* ---------- Feed & discovery (Agent K) ---------- */

  /** SCR-046 — trending topics, rising characters and your rank in the world. */
  trending: (personaId: string) => request("/trending", { query: { personaId }, schema: TrendingResZ }),

  /** SCR-047 — one character's page. `character` is the handle (with or without "@") or the id. */
  character: (character: string, personaId?: string) =>
    request(`/characters/${encodeURIComponent(character)}`, { query: { personaId }, schema: CharacterProfileResZ }),

  /* ---------- World Studio (AIF-003, SCR-048/049/050) ---------- */

  /**
   * One line in, a world out. Charges gems, so the failures are meaningful and are handled by the
   * screen rather than by a global modal: 402 = not enough gems, 422 = the premise was blocked,
   * 429 = the daily build limit.
   */
  createWorld: (body: { premise: string; genre: WorldGenre; locale: Locale; visibility: "private" | "unlisted" | "public" }) =>
    request("/worlds", { method: "POST", body, schema: CreateWorldResZ, globalErrors: false }),
  /** Polled while the world builds; `progress` (0..1) and `cast` turn the wait into a beat. */
  worldStatus: (id: string) =>
    request(`/worlds/${encodeURIComponent(id)}/status`, { schema: WorldStatusResZ, globalErrors: false }),
  /** Public asks for human review; unlisted and private take effect immediately. */
  publishWorld: (id: string, visibility: "private" | "unlisted" | "public") =>
    request(`/worlds/${encodeURIComponent(id)}/publish`, {
      method: "POST", body: { visibility }, schema: PublishWorldResZ, globalErrors: false,
    }),
  /** SCR-050 — the player's own worlds, plus how many builds are left today. */
  myWorlds: () => request("/worlds/mine", { schema: MyWorldsResZ, globalErrors: false }),
  /** Explore's "made by players" rail. Cursor-paged. */
  publicWorlds: (cursor?: string | null) =>
    request("/worlds/public", { query: { cursor }, schema: PublicWorldsResZ, globalErrors: false }),

  /** S2-2 — Expo push token. */
  registerPush: (token: string, platform: "ios" | "android" | "web") =>
    request("/push/register", { method: "POST", body: { token, platform }, schema: RegisterPushResZ }),
};

/** Response types for the S2 screens, inferred from the shared contracts. */
export type Digest = NonNullable<Awaited<ReturnType<typeof api.digest>>["digest"]>;
export type MemoryLedger = Awaited<ReturnType<typeof api.memory>>;
export type Moment = Awaited<ReturnType<typeof api.sharedMoment>>["moment"];
export type Profile = Awaited<ReturnType<typeof api.profile>>;
export type ReferralInfo = Awaited<ReturnType<typeof api.referral>>;
export type Trending = Awaited<ReturnType<typeof api.trending>>;
export type CharacterProfile = Awaited<ReturnType<typeof api.character>>;
/** Engagement (Agent L). */
export type NotificationsRes = Awaited<ReturnType<typeof api.notifications>>;
export type Notification = NotificationsRes["notifications"][number];
export type Streak = Awaited<ReturnType<typeof api.streak>>;
/** World Studio. */
export type CreateWorldRes = Awaited<ReturnType<typeof api.createWorld>>;
export type WorldStatusRes = Awaited<ReturnType<typeof api.worldStatus>>;
export type WorldFull = WorldStatusRes["world"];
export type WorldCastMember = WorldStatusRes["cast"][number];
export type MyWorldsRes = Awaited<ReturnType<typeof api.myWorlds>>;
export type PublicWorldsRes = Awaited<ReturnType<typeof api.publicWorlds>>;
export type WorldVisibility = WorldFull["visibility"];
export type WorldBuildStatus = WorldFull["status"];
export type AchievementsRes = Awaited<ReturnType<typeof api.achievements>>;
export type Achievement = AchievementsRes["achievements"][number];
