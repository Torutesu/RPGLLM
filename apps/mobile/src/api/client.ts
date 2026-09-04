import {
  ApiErrorZ, AuthResZ, AgeGateResZ, MeResZ, WorldsResZ, WorldDetailResZ, HandleCheckResZ,
  CreatePersonaResZ, FeedResZ, CreatePostResZ, PostDetailResZ, MoreRepliesResZ, PendingEventResZ,
  ChooseEventResZ, StatResZ, DMListResZ, CreateThreadResZ, DMThreadResZ, SendDMResZ, WalletResZ,
  AdRewardResZ, CoffeeResZ, OfferingsResZ, DevPurchaseResZ, RateResZ, AssignmentsResZ, HealthResZ,
  type ErrorCode, type Locale, type PlanId,
} from "@rpgllm/shared";
import { API_BASE, g } from "../env";
import { getToken } from "../auth/token";

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
type Options<T> = { method?: "GET" | "POST"; body?: unknown; query?: Query; schema: Schema<T>; auth?: boolean };

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
  if (opts.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
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
    handlers.onNetworkError?.(err);
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
    if (err.isEnergy) handlers.onEnergyRequired?.(err);
    if (res.status === 401) handlers.onUnauthorized?.(err);
    if (res.status >= 500) handlers.onNetworkError?.(err);
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

  rate: (generationId: string, value: 1 | -1, regenerate: boolean) =>
    request(`/generations/${encodeURIComponent(generationId)}/rate`, { method: "POST", body: { value, regenerate }, schema: RateResZ }),
  assignments: () => request("/experiments/assignments", { schema: AssignmentsResZ }),
};
