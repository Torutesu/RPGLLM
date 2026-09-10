/**
 * AdMob server-side verification (Agent F, S0-6).
 *
 * Before this, `POST /v1/wallet/ad-reward` accepted the constant `TEST_AD_TOKEN` in every mode,
 * so any authenticated client could mint energy at will. The constant is now only honoured while
 * `ADS_MODE=test`; any other mode goes through the real SSV check below.
 *
 * How AdMob SSV works: the ad SDK gives the client an opaque completion callback URL; the client
 * forwards it here as `adToken`. It carries the reward parameters plus `signature` and `key_id`.
 * The signature is an ECDSA-SHA256 (P-256) signature over the raw query string between the first
 * character and `&signature=`, base64url encoded. The verifying public keys are published at
 * https://gstatic.com/admob/reward/verifier-keys.json, keyed by `key_id`.
 *
 * Two things that used to be TODOs and are the difference between "the shape is implemented" and
 * "this defends money":
 *
 *   - **the key set is fetched and cached** (`GoogleVerifierKeys` below): refreshed when a
 *     `key_id` we have never seen turns up, rate-limited so an unknown id cannot be used to hammer
 *     Google, and holding the last good copy so a fetch failure degrades to "verify with what we
 *     had" rather than to "reward nobody";
 *   - **`transaction_id` is a nonce, not a field.** A signature proves the callback was genuine
 *     once; it says nothing about whether this is the fourth time we have seen it. The caller
 *     records it (`AdRedemption`, unique) in the same transaction as the grant.
 *
 * With no keys configured this still fails closed: no key ⇒ no reward.
 */
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";

export interface AdVerifyResult {
  ok: boolean;
  /** machine-readable reason; safe to log, never contains the token */
  reason: string;
  transactionId?: string;
}

export interface AdMobVerifierKeys {
  /** key_id -> PEM/base64 SPKI public key */
  get(keyId: string): Promise<KeyObject | null>;
}

/** Fails closed. Replace with a cached fetch of the Google key set (see TODO above). */
export class UnconfiguredVerifierKeys implements AdMobVerifierKeys {
  get(_keyId: string): Promise<KeyObject | null> {
    return Promise.resolve(null);
  }
}

/** Wraps an operator-provided PEM (env `ADMOB_VERIFIER_KEYS_JSON`: {"<key_id>":"<pem>"}). */
export class StaticVerifierKeys implements AdMobVerifierKeys {
  #keys: Map<string, KeyObject>;
  constructor(pemByKeyId: Record<string, string>) {
    this.#keys = new Map(Object.entries(pemByKeyId).map(([id, pem]) => [id, createPublicKey(pem)]));
  }
  get(keyId: string): Promise<KeyObject | null> {
    return Promise.resolve(this.#keys.get(keyId) ?? null);
  }
}

let keys: AdMobVerifierKeys = new UnconfiguredVerifierKeys();
export const setAdMobVerifierKeys = (next: AdMobVerifierKeys): void => {
  keys = next;
};

/** Max age of an SSV callback we still accept (replay window). */
export const SSV_MAX_AGE_MS = 5 * 60 * 1000;

export interface SsvOptions {
  /** the caller's user id — must match the `user_id` the client set on the ad request */
  expectedUserId?: string;
  nowMs?: number;
}

/**
 * Verifies an AdMob SSV callback URL (or bare query string).
 * Signature shape is implemented; the key lookup is the part left to P1.
 */
export async function verifyAdMobSSV(callback: string, opts: SsvOptions = {}): Promise<AdVerifyResult> {
  const qIndex = callback.indexOf("?");
  const query = qIndex >= 0 ? callback.slice(qIndex + 1) : callback;
  const sigIndex = query.indexOf("&signature=");
  if (sigIndex < 0) return { ok: false, reason: "no_signature" };

  // Signed content is everything before "&signature=" — order matters, so slice, never re-serialize.
  const signedContent = query.slice(0, sigIndex);
  const params = new URLSearchParams(query);
  const signature = params.get("signature");
  const keyId = params.get("key_id");
  if (signature === null || keyId === null) return { ok: false, reason: "malformed_callback" };

  const timestampRaw = params.get("timestamp");
  const nowMs = opts.nowMs ?? Date.now();
  if (timestampRaw !== null) {
    const ts = Number(timestampRaw);
    // AdMob timestamps are in milliseconds.
    if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > SSV_MAX_AGE_MS) return { ok: false, reason: "stale_callback" };
  }
  if (opts.expectedUserId !== undefined && params.get("user_id") !== opts.expectedUserId) {
    return { ok: false, reason: "user_mismatch" };
  }

  const publicKey = await keys.get(keyId);
  if (publicKey === null) return { ok: false, reason: "unknown_key_id" };

  let verified = false;
  try {
    verified = createVerify("SHA256")
      .update(signedContent, "utf8")
      .verify(publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return { ok: false, reason: "bad_signature_encoding" };
  }
  if (!verified) return { ok: false, reason: "bad_signature" };

  const transactionId = params.get("transaction_id");
  /*
   * A verified callback with no `transaction_id` cannot be deduplicated, and a reward that cannot
   * be deduplicated is a reward that can be replayed — so it is refused rather than granted once
   * and hoped about. Real AdMob callbacks always carry one.
   */
  if (transactionId === null || transactionId === "") return { ok: false, reason: "no_transaction_id" };
  return { ok: true, reason: "verified", transactionId };
}

/* ------------------------------------------------------------------ keys ---- */

/** Where Google publishes the reward verifier keys. */
export const VERIFIER_KEYS_URL = "https://gstatic.com/admob/reward/verifier-keys.json";

interface PublishedKey {
  keyId: number | string;
  pem?: string;
  base64?: string;
}

/**
 * The published key set, cached in process.
 *
 * Google rotates these, and the rotation is visible only as a `key_id` we do not have — so the
 * refresh trigger is a cache miss rather than a timer, with a floor between attempts so an
 * attacker cannot turn "unknown key_id" into an outbound request amplifier. A failed refresh
 * keeps the previous copy: the alternative is that a blip at Google stops every ad reward in the
 * product, which is a worse failure than verifying against keys that are five minutes old.
 */
export class GoogleVerifierKeys implements AdMobVerifierKeys {
  #keys = new Map<string, KeyObject>();
  #lastFetchMs = 0;
  #inflight: Promise<void> | null = null;

  constructor(
    private readonly opts: { fetchImpl?: typeof fetch; minRefreshMs?: number; nowMs?: () => number; url?: string } = {},
  ) {}

  async get(keyId: string): Promise<KeyObject | null> {
    const hit = this.#keys.get(keyId);
    if (hit) return hit;
    await this.#refresh();
    return this.#keys.get(keyId) ?? null;
  }

  /** How many keys are loaded — for the boot log, so an operator can see this is configured. */
  get size(): number {
    return this.#keys.size;
  }

  async #refresh(): Promise<void> {
    const now = (this.opts.nowMs ?? Date.now)();
    const floor = this.opts.minRefreshMs ?? 60_000;
    if (now - this.#lastFetchMs < floor) return;
    if (this.#inflight) return await this.#inflight;

    this.#lastFetchMs = now;
    this.#inflight = (async () => {
      const doFetch = this.opts.fetchImpl ?? fetch;
      try {
        const res = await doFetch(this.opts.url ?? VERIFIER_KEYS_URL, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) return;
        const body = (await res.json()) as { keys?: PublishedKey[] };
        const next = new Map<string, KeyObject>();
        for (const k of body.keys ?? []) {
          const pem = k.pem ?? (k.base64 ? `-----BEGIN PUBLIC KEY-----\n${k.base64}\n-----END PUBLIC KEY-----\n` : "");
          if (!pem) continue;
          try {
            next.set(String(k.keyId), createPublicKey(pem));
          } catch {
            /* one bad key is not a bad key set */
          }
        }
        // Only replace a working set with a non-empty one.
        if (next.size > 0) this.#keys = next;
      } catch {
        // Keep the last good copy. The caller's `null` for an unknown id is the only visible effect.
      } finally {
        this.#inflight = null;
      }
    })();
    await this.#inflight;
  }
}
