import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import { LOCALES, type Locale, type PlanId, type Post, t, type StringKey } from "@rpgllm/shared";
import { api, ApiError, setApiHandlers } from "../api/client";
import { subscribe, type StreamEvent, type Subscription as StreamSub } from "../api/sse";
import { getAds } from "../adapters/ads";
import { getBilling } from "../adapters/billing";
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
};

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
  purchase: (plan: PlanId) => Promise<{ ok: boolean; message?: string }>;
  showToast: (kind: ToastKind, text: string) => void;
  clearToast: (kind?: ToastKind) => void;
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
      const me = await api.me();
      patch({ me, locale: me.user.locale, needsAgeGate: me.user.birthYear === null });
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
        return { ok: false, message: e instanceof Error ? e.message : "purchase failed" };
      }
    };

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
