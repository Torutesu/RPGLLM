import AsyncStorage from "@react-native-async-storage/async-storage";
import { WORLD_MODERATION, type Locale, type StringKey } from "@rpgllm/shared";
import type { CreatorProfile } from "../api/client";

/**
 * Exit 2 — trust, read as progress rather than as a badge.
 *
 * gtm.md §2: a human reads every world that asks for Explore, at roughly fifteen times what
 * generating one costs. The only lever that changes the *shape* of that cost is trust — after
 * `TRUST_APPROVALS` clean approvals a creator's submissions are sampled instead of read end to
 * end, so review load grows with the number of new creators rather than with the number of worlds.
 *
 * That is a thing being earned, so it is rendered as a meter with a number of approvals still to
 * go — never as a badge. It is also only ever sent to the creator themselves (`CreatorProfileResZ`
 * marks it so), and the page must not render it for anybody else even if the field arrives.
 */

export type CreatorTrust = NonNullable<CreatorProfile["trust"]>;

export type TrustView = {
  /** 0..1, for the meter. Full once trusted. */
  progress: number;
  /** The line under the heading. `trustProgress` is a *suffix* — see `countLine`. */
  line: StringKey;
  /** Approvals still to go, prefixed to `line`; null when the line takes no number. */
  count: number | null;
  /** Trusted right now. */
  earned: boolean;
  /**
   * Trusted before, and not now. The payload cannot say this on its own — a reset returns
   * `approvals` to zero, which is also what a brand-new creator looks like — so it comes from
   * having *seen* `trusted: true` for this handle before (see `rememberTrusted`).
   */
  lost: boolean;
};

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function trustView(trust: CreatorTrust, wasTrusted: boolean): TrustView {
  const target = Math.max(1, WORLD_MODERATION.TRUST_APPROVALS);
  if (trust.trusted) {
    return { progress: 1, line: "trustEarned", count: null, earned: true, lost: false };
  }
  /*
   * `toTrusted` is the server's number and wins; the constant is only the fallback for a payload
   * that omitted it. Either way a creator who is not trusted needs at least one more approval —
   * a "0 approvals until…" line would be a contradiction, not a fact.
   */
  const remaining = Math.max(1, trust.toTrusted ?? target - trust.approvals);
  return {
    progress: clamp01(trust.approvals / target),
    line: "trustProgress",
    count: remaining,
    earned: false,
    lost: wasTrusted,
  };
}

/**
 * A count and the string it belongs to, joined the way each language joins them.
 *
 * `trustProgress` is written as a suffix in both locales — EN "approvals until…" takes a space,
 * JA "回の承認で…" opens with the counter itself and must not. The rest of the app joins with a
 * space in both (`3 left today`), which is passable for a standalone noun and wrong for a counter.
 */
export const countLine = (locale: Locale, n: number, text: string): string =>
  locale === "ja" ? `${n}${text}` : `${n} ${text}`;

/* ---------------------------------------------------------------- was this creator trusted? ---- */

const MEM_PREFIX = "rpgllm.trusted.";
/** Reads are on a render path; the store is async, so answered values are kept. */
const cache = new Map<string, boolean>();
const keyFor = (handle: string): string => `${MEM_PREFIX}${handle.replace(/^@/, "").toLowerCase()}`;

/** Records that this creator has been trusted at least once. Failure is silent: it is a nicety. */
export async function rememberTrusted(handle: string): Promise<void> {
  if (!handle) return;
  const key = keyFor(handle);
  if (cache.get(key) === true) return;
  cache.set(key, true);
  try {
    await AsyncStorage.setItem(key, "1");
  } catch {
    /* no store on this device — the flag lives for this session only */
  }
}

/**
 * Whether this device has ever seen this creator trusted. False on a device that has not, which is
 * the honest degrade: the page then shows the progress it can prove instead of a state it cannot.
 */
export async function wasEverTrusted(handle: string): Promise<boolean> {
  if (!handle) return false;
  const key = keyFor(handle);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  try {
    const raw = await AsyncStorage.getItem(key);
    const seen = raw === "1";
    cache.set(key, seen);
    return seen;
  } catch {
    return false;
  }
}
