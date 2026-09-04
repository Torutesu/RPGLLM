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
 * TODO(P1): fetch + cache that key set (refresh on unknown key_id, keep the last good copy) and
 * record `transaction_id` in the database so a callback can never be replayed. Until the key
 * fetch exists this function fails closed: no key ⇒ no reward.
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
export const setAdMobVerifierKeys = (next: AdMobVerifierKeys): void => { keys = next; };

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
  // TODO(P1): reject a transaction_id already redeemed (needs a table; schema is orchestrator-owned).
  return { ok: true, reason: "verified", ...(transactionId !== null ? { transactionId } : {}) };
}
