import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { FOLLOWER_MILESTONES, LOCALES, type Locale, type PlanId, type Post, type ReportReason, t, type StringKey } from "@rpgllm/shared";
import {
  api, ApiError, setApiHandlers,
  type Achievement, type AchievementsRes, type Notification, type ReportTarget, type Streak,
} from "../api/client";
import { subscribe, type StreamEvent, type Subscription as StreamSub } from "../api/sse";
import { getAds } from "../adapters/ads";
import { getBilling, isPurchaseCancelled } from "../adapters/billing";
import { pushAfterFirstPost } from "../push";
import { loadToken, saveToken } from "../auth/token";
import type { GameEvent, Me, StatSnapshot, WorldDetail, WorldSummary } from "../api/types";

export type PersonaDraft = {
  worldId: string;
  worldSlug: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  voiceNotes: string;
};

/** S1-2 (Agent G): a character this persona blocked. */
export type BlockedCharacter = { characterId: string; handle: string; displayName: string };

export type ToastKind = "stat" | "fallback" | "error";
/** One slot per kind so a stat toast never replaces a fallback notice (E2E-010). */
export type ToastState = Partial<Record<ToastKind, string>>;
export type LoadStatus = "idle" | "loading" | "ready" | "error";

export type AppState = {
  booted: boolean;
  token: string | null;
  me: Me | null;
  locale: Locale;
  needsAgeGate: boolean;
  ageBlocked: boolean;
  worlds: WorldSummary[] | null;
  worldsStatus: LoadStatus;
  world: WorldDetail | null;
  worldStatus: LoadStatus;
  draft: PersonaDraft | null;
  feed: Post[];
  feedCursor: string | null;
  feedStatus: LoadStatus;
  /** Replies that arrived over SSE, keyed by parent post id. */
  liveReplies: Record<string, Post[]>;
  pendingEvent: GameEvent | null;
  lastSnapshot: StatSnapshot | null;
  statCardOpen: boolean;
  /** A post that hit 402; re-submitted once energy is topped up (E2E-007). */
  pendingPost: { text: string; parentId: string | null } | null;
  toasts: ToastState;
  streaming: boolean;
  /** S1-2 blocked characters (SCR-033 → Safety). Their posts never render. */
  blocked: BlockedCharacter[];
  /** S1-6 analytics consent, seeded from `/v1/me` on every refresh and updated by the toggle. */
  analyticsConsent: boolean;

  /* ---------------- Engagement surfaces (Agent L) ---------------- */
  /** SCR-042. `notifUnread` drives the tab badge and is the reason people come back. */
  notifications: Notification[];
  notifUnread: number;
  notifCursor: string | null;
  notifStatus: LoadStatus;
  /** The daily check-in. `streakShownFor` is the UTC day the card was already shown for. */
  streak: Streak | null;
  streakShownFor: string | null;
  /** SCR-044. */
  achievements: AchievementsRes | null;
  achievementsStatus: LoadStatus;
  /** SCR-045 — the one moment on screen right now, if any. */
  celebration: Celebration | null;
};

/** A full-screen celebration (SCR-045). Copy is resolved in the component from i18n. */
export type Celebration =
  | { kind: "level"; value: number }
  | { kind: "milestone"; value: number }
  | { kind: "achievement"; key: string; icon: string; title: string; value: number };

const initialLocale = (): Locale => {
  try {
    const tag =
      Platform.OS === "web" && typeof navigator !== "undefined"
        ? navigator.language
        : Intl.DateTimeFormat().resolvedOptions().locale;
    const short = (tag ?? "en").slice(0, 2).toLowerCase();
    return (LOCALES as readonly string[]).includes(short) ? (short as Locale) : "en";
  } catch {
    return "en";
  }
};

const initialState: AppState = {
  booted: false,
  token: null,
  me: null,
  locale: initialLocale(),
  needsAgeGate: false,
  ageBlocked: false,
  worlds: null,
  worldsStatus: "idle",
  world: null,
  worldStatus: "idle",
  draft: null,
  feed: [],
  feedCursor: null,
  feedStatus: "idle",
  liveReplies: {},
  pendingEvent: null,
  lastSnapshot: null,
  statCardOpen: false,
  pendingPost: null,
  toasts: {},
  streaming: false,
  blocked: [],
  analyticsConsent: false,
  notifications: [],
  notifUnread: 0,
  notifCursor: null,
  notifStatus: "idle",
  streak: null,
  streakShownFor: null,
  achievements: null,
  achievementsStatus: "idle",
  celebration: null,
};

export type PostResult =
  | { status: "ok"; post: Post }
  | { status: "energy" }
  | { status: "safety"; message: string }
  | { status: "error"; message: string };

export type Actions = {
  setLocale: (l: Locale) => void;
  signIn: (email: string, code: string) => Promise<{ ok: boolean; needsAgeGate: boolean; message?: string }>;
  submitAgeGate: (birthYear: number) => Promise<{ ok: boolean; blocked: boolean }>;
  refreshMe: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  loadWorlds: () => Promise<void>;
  loadWorld: (worldId: string) => Promise<void>;
  setDraft: (d: PersonaDraft | null) => void;
  patchDraft: (p: Partial<PersonaDraft>) => void;
  createPersona: (firstFollowerId: string) => Promise<{ ok: boolean; message?: string }>;
  loadFeed: () => Promise<void>;
  loadMoreFeed: () => Promise<void>;
  submitPost: (text: string, parentId: string | null) => Promise<PostResult>;
  flushPendingPost: () => Promise<PostResult | null>;
  clearPendingPost: () => void;
  insertPost: (p: Post) => void;
  replacePost: (p: Post) => void;
  startStream: (streamUrl: string, rootPostId: string) => void;
  stopStream: () => void;
  chooseEvent: (eventId: string, choiceId: string) => Promise<{ ok: boolean; energy: boolean; message?: string }>;
  openStatCard: (s: StatSnapshot) => void;
  closeStatCard: () => void;
  watchAd: () => Promise<{ ok: boolean; message?: string }>;
  useCoffee: () => Promise<{ ok: boolean; message?: string }>;
  /** `cancelled` distinguishes "the user closed the store sheet" from a real failure (Agent P). */
  purchase: (plan: PlanId) => Promise<{ ok: boolean; cancelled?: boolean; message?: string }>;
  showToast: (kind: ToastKind, text: string) => void;
  clearToast: (kind?: ToastKind) => void;
  /* S1 store compliance (Agent G) */
  loadBlocked: () => Promise<void>;
  blockByHandle: (handle: string) => Promise<{ ok: boolean; message?: string }>;
  unblockCharacter: (characterId: string) => Promise<{ ok: boolean; message?: string }>;
  reportContent: (
    target: ReportTarget, targetId: string, reason: ReportReason, note: string,
  ) => Promise<{ ok: boolean; duplicate: boolean; message?: string }>;
  setConsent: (analytics: boolean) => Promise<{ ok: boolean; analytics: boolean; locked: boolean }>;
  exportMyData: () => Promise<{ ok: boolean; json?: string; message?: string }>;
  deleteAccount: () => Promise<{ ok: boolean; message?: string }>;
  restorePurchases: () => Promise<{ ok: boolean; plan: string | null; message?: string }>;
  /* Engagement surfaces (Agent L) */
  loadNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  markNotificationsRead: (ids: string[] | null) => Promise<void>;
  loadStreak: () => Promise<Streak | null>;
  dismissStreak: () => void;
  loadAchievements: () => Promise<void>;
  markAchievementsSeen: (keys: string[]) => Promise<void>;
  celebrate: (c: Celebration) => void;
  dismissCelebration: () => void;
};

const StateCtx = createContext<AppState>(initialState);
const ActionsCtx = createContext<Actions | null>(null);

const idemKeys = new Map<string, string>();
function idempotencyKey(seed: string): string {
  const existing = idemKeys.get(seed);
  if (existing) return existing;
  const key = `${seed}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  idemKeys.set(seed, key);
  return key;
}

const dedupe = (posts: Post[]): Post[] => {
  const seen = new Set<string>();
  const out: Post[] = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);
  // `ref` is the authoritative, synchronously-updated copy: async actions run several
  // awaits apart from React's render cycle and must never read a stale wallet/session.
  const ref = useRef(state);
  const streamRef = useRef<StreamSub | null>(null);
  const toastTimers = useRef<Partial<Record<ToastKind, ReturnType<typeof setTimeout>>>>({});

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    const partial = typeof p === "function" ? p(ref.current) : p;
    ref.current = { ...ref.current, ...partial };
    setState(ref.current);
  }, []);

  const clearToast = useCallback(
    (kind?: ToastKind) => {
      const kinds: ToastKind[] = kind ? [kind] : ["stat", "fallback", "error"];
      for (const k of kinds) {
        const timer = toastTimers.current[k];
        if (timer) clearTimeout(timer);
        delete toastTimers.current[k];
      }
      patch((s) => {
        const next = { ...s.toasts };
        for (const k of kinds) delete next[k];
        return { toasts: next };
      });
    },
    [patch],
  );

  const showToast = useCallback(
    (kind: ToastKind, text: string) => {
      const existing = toastTimers.current[kind];
      if (existing) clearTimeout(existing);
      patch((s) => ({ toasts: { ...s.toasts, [kind]: text } }));
      toastTimers.current[kind] = setTimeout(() => {
        delete toastTimers.current[kind];
        patch((s) => {
          const next = { ...s.toasts };
          delete next[kind];
          return { toasts: next };
        });
      }, kind === "stat" ? 3000 : 6000);
    },
    [patch],
  );

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const before = ref.current.me?.persona ?? null;
      const me = await api.me();
      patch({ me, locale: me.user.locale, needsAgeGate: me.user.birthYear === null, analyticsConsent: me.user.analyticsConsent });
      // Agent P: the store must know who is buying — the app-user id is the account id, which is
      // what the RevenueCat webhook and POST /v1/billing/restore match on server-side.
      void getBilling().identify(me.user.id).catch(() => undefined);
      // SCR-045 (Agent L): progression the player earned between two reads gets its moment.
      const after = me.persona;
      if (before && after) {
        if (after.level > before.level) {
          patch({ celebration: { kind: "level", value: after.level } });
        } else {
          const crossed = FOLLOWER_MILESTONES.filter((m) => before.followers < m && after.followers >= m);
          const top = crossed[crossed.length - 1];
          if (top !== undefined) patch({ celebration: { kind: "milestone", value: top } });
        }
      }
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) patch({ me: null, token: null });
      return null;
    }
  }, [patch]);

  /** Global side effects the typed client drives (402 → energy modal, network → toast). */
  useEffect(() => {
    setApiHandlers({
      onEnergyRequired: () => {
        router.push("/energy");
      },
      onUnauthorized: () => {
        void saveToken(null);
        patch({ token: null, me: null });
      },
      onNetworkError: (e) => {
        showToast("error", e.isNetwork ? t(ref.current.locale, "notSent") : t(ref.current.locale, "fallbackNotice"));
      },
    });
  }, [patch, showToast]);

  // Boot: restore the session.
  useEffect(() => {
    void (async () => {
      const token = await loadToken();
      if (!token) {
        patch({ booted: true, token: null });
        return;
      }
      patch({ token });
      await refreshMe();
      patch({ booted: true });
    })();
  }, [patch, refreshMe]);

  const stopStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    patch({ streaming: false });
  }, [patch]);

  const insertPost = useCallback(
    (post: Post) => {
      patch((s) => ({ feed: dedupe([post, ...s.feed]) }));
    },
    [patch],
  );

  const replacePost = useCallback(
    (post: Post) => {
      patch((s) => ({
        feed: s.feed.map((p) => (p.id === post.id ? post : p)),
        liveReplies: Object.fromEntries(
          Object.entries(s.liveReplies).map(([k, v]) => [k, v.map((r) => (r.id === post.id ? post : r))]),
        ),
      }));
    },
    [patch],
  );

  const openStatCard = useCallback(
    (snapshot: StatSnapshot) => {
      patch({ lastSnapshot: snapshot, statCardOpen: true });
    },
    [patch],
  );
  const closeStatCard = useCallback(() => patch({ statCardOpen: false }), [patch]);

  const handleStreamEvent = useCallback(
    (rootPostId: string, e: StreamEvent) => {
      switch (e.type) {
        case "reply": {
          const parent = (e.post.parentId ?? rootPostId) as string;
          patch((s) => ({
            liveReplies: { ...s.liveReplies, [parent]: dedupe([...(s.liveReplies[parent] ?? []), e.post]) },
          }));
          break;
        }
        case "news":
          insertPost(e.post);
          break;
        case "stat":
          openStatCard(e.snapshot);
          showToast("stat", e.snapshot.narrative);
          break;
        case "event":
          patch({ pendingEvent: e.event });
          break;
        case "fallback":
          showToast("fallback", t(ref.current.locale, "fallbackNotice"));
          break;
        case "done":
          patch((s) => (s.me ? { me: { ...s.me, wallet: { ...s.me.wallet, energy: e.energy } } } : {}));
          void refreshMe();
          break;
        default:
          break;
      }
    },
    [insertPost, openStatCard, patch, refreshMe, showToast],
  );

  const startStream = useCallback(
    (streamUrl: string, rootPostId: string) => {
      streamRef.current?.close();
      patch({ streaming: true });
      streamRef.current = subscribe(
        streamUrl,
        "post",
        (e) => handleStreamEvent(rootPostId, e),
        () => {
          streamRef.current = null;
          patch({ streaming: false });
          void refreshMe();
        },
      );
    },
    [handleStreamEvent, patch, refreshMe],
  );

  useEffect(() => () => streamRef.current?.close(), []);

  const actions = useMemo<Actions>(() => {
    const setLocale = (locale: Locale) => patch({ locale });

    const signIn: Actions["signIn"] = async (email, code) => {
      try {
        await api.authStart(email);
        const res = await api.authVerify(email, code);
        await saveToken(res.jwt);
        patch({ token: res.jwt, needsAgeGate: res.needsAgeGate, ageBlocked: false });
        if (!res.needsAgeGate) await refreshMe();
        return { ok: true, needsAgeGate: res.needsAgeGate };
      } catch (e) {
        const message = e instanceof Error ? e.message : "sign-in failed";
        return { ok: false, needsAgeGate: false, message };
      }
    };

    const submitAgeGate: Actions["submitAgeGate"] = async (birthYear) => {
      try {
        await api.ageGate(birthYear, ref.current.locale);
        patch({ needsAgeGate: false, ageBlocked: false });
        await refreshMe();
        return { ok: true, blocked: false };
      } catch (e) {
        const blocked = e instanceof ApiError && (e.code === "UNDER_13" || e.status === 403);
        if (blocked) {
          // Registration is refused: drop the session so /me stays 401 (E2E-001).
          await saveToken(null);
          patch({ ageBlocked: true, token: null, me: null });
        }
        return { ok: false, blocked };
      }
    };

    const signOut = async () => {
      // Agent P: the store SDK keeps its own session — a shared device must not keep the old one.
      await getBilling().identify(null).catch(() => undefined);
      await saveToken(null);
      patch({ ...initialState, booted: true, locale: ref.current.locale });
    };

    const loadWorlds = async () => {
      patch({ worldsStatus: "loading" });
      try {
        const worlds = await api.worlds();
        patch({ worlds, worldsStatus: "ready" });
      } catch {
        patch({ worldsStatus: "error" });
      }
    };

    const loadWorld = async (worldId: string) => {
      if (ref.current.world?.world.id === worldId && ref.current.worldStatus === "ready") return;
      patch({ worldStatus: "loading" });
      try {
        const world = await api.world(worldId);
        patch({ world, worldStatus: "ready" });
      } catch {
        patch({ worldStatus: "error" });
      }
    };

    const setDraft = (draft: PersonaDraft | null) => patch({ draft });
    const patchDraft = (p: Partial<PersonaDraft>) =>
      patch((s) => (s.draft ? { draft: { ...s.draft, ...p } } : {}));

    const createPersona: Actions["createPersona"] = async (firstFollowerId) => {
      const draft = ref.current.draft;
      if (!draft) return { ok: false, message: "no draft" };
      try {
        await api.createPersona({
          worldId: draft.worldId,
          handle: draft.handle,
          displayName: draft.displayName,
          bio: draft.bio,
          avatarUrl: draft.avatarUrl,
          voiceNotes: draft.voiceNotes,
          firstFollowerId,
          idempotencyKey: idempotencyKey(`${draft.worldId}:${draft.handle}:${firstFollowerId}`),
        });
        await refreshMe();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const loadFeed = async () => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return;
      patch({ feedStatus: ref.current.feed.length ? ref.current.feedStatus : "loading" });
      try {
        const res = await api.feed(personaId, null);
        patch((s) => ({
          feed: dedupe([...res.posts, ...s.feed.filter((p) => !res.posts.some((n) => n.id === p.id))]),
          feedCursor: res.nextCursor,
          feedStatus: "ready",
          pendingEvent: res.pendingEvent ?? s.pendingEvent,
          lastSnapshot: res.lastSnapshot ?? s.lastSnapshot,
        }));
      } catch {
        patch({ feedStatus: "error" });
      }
    };

    const loadMoreFeed = async () => {
      const personaId = ref.current.me?.persona?.id;
      const cursor = ref.current.feedCursor;
      if (!personaId || !cursor) return;
      try {
        const res = await api.feed(personaId, cursor);
        patch((s) => ({ feed: dedupe([...s.feed, ...res.posts]), feedCursor: res.nextCursor }));
      } catch {
        /* keep what we have */
      }
    };

    const submitPost: Actions["submitPost"] = async (text, parentId) => {
      const me = ref.current.me;
      const personaId = me?.persona?.id;
      if (!personaId) return { status: "error", message: "no persona" };
      if ((me?.wallet.energy ?? 0) < 1) {
        patch({ pendingPost: { text, parentId } });
        router.push("/energy");
        return { status: "energy" };
      }
      try {
        const res = await api.createPost(personaId, text, parentId);
        patch((s) => ({
          feed: dedupe([res.post, ...s.feed]),
          pendingPost: null,
          liveReplies: parentId
            ? { ...s.liveReplies, [parentId]: dedupe([...(s.liveReplies[parentId] ?? []), res.post]) }
            : s.liveReplies,
        }));
        startStream(res.streamUrl, res.post.id);
        void refreshMe();
        // Agent P: the app has now done something worth a notification — this is where the push
        // permission prompt is unlocked (asking on launch is what gets an app permanently denied).
        pushAfterFirstPost();
        return { status: "ok", post: res.post };
      } catch (e) {
        if (e instanceof ApiError && e.isEnergy) {
          patch({ pendingPost: { text, parentId } });
          return { status: "energy" };
        }
        if (e instanceof ApiError && e.isSafety) {
          return { status: "safety", message: t(ref.current.locale, "safetyBlocked") };
        }
        return { status: "error", message: e instanceof Error ? e.message : "failed" };
      }
    };

    const flushPendingPost: Actions["flushPendingPost"] = async () => {
      const pending = ref.current.pendingPost;
      if (!pending) return null;
      patch({ pendingPost: null });
      return submitPost(pending.text, pending.parentId);
    };

    const clearPendingPost = () => patch({ pendingPost: null });

    const chooseEvent: Actions["chooseEvent"] = async (eventId, choiceId) => {
      try {
        const res = await api.chooseEvent(eventId, choiceId);
        patch((s) => ({
          pendingEvent: null,
          lastSnapshot: res.snapshot,
          statCardOpen: true,
          feed: res.newsPost ? dedupe([res.newsPost, ...s.feed]) : s.feed,
          me: s.me ? { ...s.me, wallet: { ...s.me.wallet, energy: res.energy } } : s.me,
        }));
        void refreshMe();
        return { ok: true, energy: false };
      } catch (e) {
        const energy = e instanceof ApiError && e.isEnergy;
        return { ok: false, energy, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const watchAd: Actions["watchAd"] = async () => {
      const me = ref.current.me;
      const personalized = Boolean(me?.wallet.adPersonalized) && !me?.user.isMinor;
      try {
        const adToken = await getAds().showRewarded({ personalized });
        await api.adReward(adToken);
        await refreshMe();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "ad failed" };
      }
    };

    const useCoffee: Actions["useCoffee"] = async () => {
      try {
        await api.coffee();
        await refreshMe();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const purchase: Actions["purchase"] = async (plan) => {
      try {
        await getBilling().purchase(plan);
        await refreshMe();
        return { ok: true };
      } catch (e) {
        // Agent P: backing out of the store sheet is not a failure — the paywall must not shout.
        if (isPurchaseCancelled(e)) return { ok: false, cancelled: true };
        return { ok: false, message: e instanceof Error ? e.message : "purchase failed" };
      }
    };

    /* ---------------- S1 store compliance (Agent G) ---------------- */

    const bare = (h: string) => h.replace(/^@+/, "").toLowerCase();

    const loadBlocked: Actions["loadBlocked"] = async () => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return;
      try {
        const res = await api.blocked(personaId);
        patch({ blocked: res.blocked.map((b) => ({ characterId: b.characterId, handle: b.handle, displayName: b.displayName })) });
      } catch {
        /* keep the last known list */
      }
    };

    /** Feed cells only know the author's handle, so the character id is resolved from the world. */
    const characterIdForHandle = async (handle: string): Promise<string | null> => {
      const persona = ref.current.me?.persona;
      if (!persona) return null;
      const known = ref.current.blocked.find((b) => bare(b.handle) === bare(handle));
      if (known) return known.characterId;
      const world = ref.current.world?.world.id === persona.worldId ? ref.current.world : await api.world(persona.worldId);
      if (!ref.current.world) patch({ world, worldStatus: "ready" });
      return world.characters.find((ch) => bare(ch.handle) === bare(handle))?.id ?? null;
    };

    const blockByHandle: Actions["blockByHandle"] = async (handle) => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return { ok: false, message: "no persona" };
      try {
        const characterId = await characterIdForHandle(handle);
        if (!characterId) return { ok: false, message: "unknown character" };
        await api.block(personaId, characterId);
        // Drop what is already on screen; the server filters every later read.
        patch((s2) => ({
          feed: s2.feed.filter((p) => bare(p.author.handle) !== bare(handle)),
          liveReplies: Object.fromEntries(
            Object.entries(s2.liveReplies).map(([k, v]) => [k, v.filter((r) => bare(r.author.handle) !== bare(handle))]),
          ),
        }));
        await loadBlocked();
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError && e.code === "BLOCKED") {
          await loadBlocked();
          return { ok: true };
        }
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const unblockCharacter: Actions["unblockCharacter"] = async (characterId) => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return { ok: false, message: "no persona" };
      try {
        await api.unblock(personaId, characterId);
        patch((s2) => ({ blocked: s2.blocked.filter((b) => b.characterId !== characterId) }));
        await loadFeed();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const reportContent: Actions["reportContent"] = async (target, targetId, reason, note) => {
      try {
        await api.report({ target, targetId, reason, note });
        return { ok: true, duplicate: false };
      } catch (e) {
        // A second report of the same thing is already recorded — the user has nothing to fix.
        if (e instanceof ApiError && e.code === "ALREADY_DONE") return { ok: true, duplicate: true };
        return { ok: false, duplicate: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const setConsent: Actions["setConsent"] = async (analytics) => {
      try {
        const res = await api.setConsent(analytics);
        patch({ analyticsConsent: res.analytics });
        return { ok: true, analytics: res.analytics, locked: res.locked };
      } catch {
        return { ok: false, analytics: ref.current.analyticsConsent, locked: false };
      }
    };

    const exportMyData: Actions["exportMyData"] = async () => {
      try {
        const data = await api.exportData();
        return { ok: true, json: JSON.stringify(data, null, 2) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const deleteAccount: Actions["deleteAccount"] = async () => {
      try {
        await api.deleteAccount();
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "failed" };
      }
    };

    const restorePurchases: Actions["restorePurchases"] = async () => {
      try {
        const res = await api.restorePurchases(ref.current.me?.user.id ?? "anonymous");
        await refreshMe();
        const plan = res.subscription && res.subscription.active ? res.subscription.plan : null;
        return { ok: true, plan };
      } catch (e) {
        return { ok: false, plan: null, message: e instanceof Error ? e.message : "failed" };
      }
    };

    /* ---------------- Engagement surfaces (Agent L) ---------------- */

    const loadNotifications: Actions["loadNotifications"] = async () => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return;
      patch({ notifStatus: ref.current.notifications.length ? ref.current.notifStatus : "loading" });
      try {
        const res = await api.notifications(personaId, null);
        patch({
          notifications: res.notifications,
          notifUnread: res.unread,
          notifCursor: res.nextCursor,
          notifStatus: "ready",
        });
      } catch {
        patch({ notifStatus: "error" });
      }
    };

    const loadMoreNotifications: Actions["loadMoreNotifications"] = async () => {
      const personaId = ref.current.me?.persona?.id;
      const cursor = ref.current.notifCursor;
      if (!personaId || !cursor) return;
      try {
        const res = await api.notifications(personaId, cursor);
        const seen = new Set(ref.current.notifications.map((n) => n.id));
        patch((s2) => ({
          notifications: [...s2.notifications, ...res.notifications.filter((n) => !seen.has(n.id))],
          notifUnread: res.unread,
          notifCursor: res.nextCursor,
        }));
      } catch {
        /* keep what we have */
      }
    };

    const markNotificationsRead: Actions["markNotificationsRead"] = async (ids) => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return;
      const at = new Date().toISOString();
      // Optimistic: the badge has to clear on the tap, not on the round trip.
      patch((s2) => ({
        notifications: s2.notifications.map((n) =>
          n.readAt === null && (ids === null || ids.includes(n.id)) ? { ...n, readAt: at } : n,
        ),
        notifUnread: ids === null ? 0 : Math.max(0, s2.notifUnread - ids.length),
      }));
      try {
        const res = await api.markNotificationsRead(personaId, ids);
        patch({ notifUnread: res.unread });
      } catch {
        void loadNotifications();
      }
    };

    const loadStreak: Actions["loadStreak"] = async () => {
      if (!ref.current.me) return null;
      try {
        const streak = await api.streak();
        patch({ streak });
        return streak;
      } catch {
        return null;
      }
    };

    const dismissStreak: Actions["dismissStreak"] = () => {
      patch({ streakShownFor: new Date().toISOString().slice(0, 10) });
    };

    const loadAchievements: Actions["loadAchievements"] = async () => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId) return;
      patch({ achievementsStatus: ref.current.achievements ? ref.current.achievementsStatus : "loading" });
      try {
        const achievements = await api.achievements(personaId);
        patch({ achievements, achievementsStatus: "ready" });
        // Anything unlocked but never shown gets its moment, then is marked seen.
        const next: Achievement | undefined = achievements.pending[0];
        if (next && !ref.current.celebration) {
          patch({
            celebration: {
              kind: "achievement", key: next.key, icon: next.icon, title: next.title, value: next.value,
            },
          });
          void markAchievementsSeen(achievements.pending.map((a) => a.key));
        }
      } catch {
        patch({ achievementsStatus: "error" });
      }
    };

    const markAchievementsSeen: Actions["markAchievementsSeen"] = async (keys) => {
      const personaId = ref.current.me?.persona?.id;
      if (!personaId || keys.length === 0) return;
      const at = new Date().toISOString();
      patch((s2) => ({
        achievements: s2.achievements
          ? {
            ...s2.achievements,
            achievements: s2.achievements.achievements.map((a) =>
              keys.includes(a.key) && a.seenAt === null ? { ...a, seenAt: at } : a,
            ),
            pending: s2.achievements.pending.filter((a) => !keys.includes(a.key)),
          }
          : s2.achievements,
      }));
      try {
        await api.markAchievementsSeen(personaId, keys);
      } catch {
        /* the next read reports them again */
      }
    };

    const celebrate: Actions["celebrate"] = (c) => patch({ celebration: c });
    const dismissCelebration: Actions["dismissCelebration"] = () => patch({ celebration: null });

    return {
      setLocale,
      signIn,
      submitAgeGate,
      refreshMe,
      signOut,
      loadWorlds,
      loadWorld,
      setDraft,
      patchDraft,
      createPersona,
      loadFeed,
      loadMoreFeed,
      submitPost,
      flushPendingPost,
      clearPendingPost,
      insertPost,
      replacePost,
      startStream,
      stopStream,
      chooseEvent,
      openStatCard,
      closeStatCard,
      watchAd,
      useCoffee,
      purchase,
      showToast,
      clearToast,
      loadBlocked,
      blockByHandle,
      unblockCharacter,
      reportContent,
      setConsent,
      exportMyData,
      deleteAccount,
      restorePurchases,
      loadNotifications,
      loadMoreNotifications,
      markNotificationsRead,
      loadStreak,
      dismissStreak,
      loadAchievements,
      markAchievementsSeen,
      celebrate,
      dismissCelebration,
    };
  }, [clearToast, insertPost, openStatCard, closeStatCard, patch, refreshMe, replacePost, showToast, startStream, stopStream]);

  return (
    <StateCtx.Provider value={state}>
      <ActionsCtx.Provider value={actions}>{children}</ActionsCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  return useContext(StateCtx);
}

export function useActions(): Actions {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error("useActions must be used inside <AppProvider>");
  return a;
}

/** Session + refetch-after-mutation helper. */
export function useMe(): { me: Me | null; refresh: () => Promise<Me | null> } {
  const { me } = useAppState();
  const { refreshMe } = useActions();
  return { me, refresh: refreshMe };
}

/** Locale-bound translator. */
export function useT(): { t: (key: StringKey) => string; locale: Locale } {
  const { locale } = useAppState();
  return useMemo(() => ({ t: (key: StringKey) => t(locale, key), locale }), [locale]);
}
