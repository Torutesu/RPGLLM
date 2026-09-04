/**
 * Primitives for the one-time email login codes (Agent F, S0-1; persisted by Agent O).
 *
 * `POST /auth/email/verify` used to accept the constant `DEV_EMAIL_CODE` for ANY email, which is a
 * full authentication bypass. A code is now generated per request, only its **salted sha256 hash**
 * is stored, it expires after 10 minutes, survives at most 5 verify attempts and is single-use.
 *
 * This file owns the cryptography and the mail transport. The **store** is
 * `services/login-codes.ts` (the `LoginCode` table) — the in-process `Map` that used to hang off
 * `AppState.emailCodes` is gone, because it only ever worked for one API process. The Map
 * implementation is kept below as the dependency-free reference used by `test/security.test.ts`
 * (and usable in a database-less dev harness); nothing in the request path calls it.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export interface EmailCodeRecord {
  /** per-code random salt — hashes of the same code for two emails never match */
  salt: string;
  hash: string;
  /** epoch ms */
  expiresAt: number;
  attempts: number;
}

export type EmailCodeStore = Map<string, EmailCodeRecord>;

/** Where the code is actually delivered. TODO(P1): implement a real provider (SES/Postmark/Resend). */
export interface MailSender {
  sendLoginCode(email: string, code: string): Promise<void>;
}

/** Default sender: prints to the server log. Fine for dev, never acceptable in production. */
export class ConsoleMailSender implements MailSender {
  async sendLoginCode(email: string, code: string): Promise<void> {
    console.log(JSON.stringify({ msg: "auth.code.sent", transport: "console", email, code }));
    return Promise.resolve();
  }
}

let sender: MailSender = new ConsoleMailSender();
export const mailSender = (): MailSender => sender;
/** Swap the sender (tests, or a real provider wired in `index.ts`). */
export const setMailSender = (next: MailSender): void => { sender = next; };

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const generateCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

export const hashCode = (code: string, salt: string): string =>
  createHash("sha256").update(`${salt}:${code}`, "utf8").digest("hex");

/** Per-code salt: two accounts with the same digits never share a digest. */
export const newSalt = (): string => randomBytes(16).toString("hex");

/** Length-safe constant-time comparison (both arguments here are fixed-length hex digests). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still burn a comparison so the failure mode does not leak the length difference by timing.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function prune(store: EmailCodeStore, nowMs: number): void {
  for (const [key, rec] of store) if (rec.expiresAt <= nowMs) store.delete(key);
}

/**
 * In-memory reference store — **not** the request path (that is `services/login-codes.ts`).
 * Kept because it is the dependency-free way to unit-test the lifecycle rules.
 * Generates a code, stores its hash, and returns the plaintext for the mail sender only.
 */
export function issueCode(store: EmailCodeStore, email: string, nowMs: number, ttlMs: number): string {
  prune(store, nowMs);
  const code = generateCode();
  const salt = newSalt();
  store.set(normalizeEmail(email), { salt, hash: hashCode(code, salt), expiresAt: nowMs + ttlMs, attempts: 0 });
  return code;
}

export type VerifyResult = "ok" | "no_code" | "expired" | "too_many_attempts" | "mismatch";

/** In-memory counterpart of `consumeLoginCode`. Single-use: a correct code is deleted; a wrong one burns an attempt. */
export function consumeCode(
  store: EmailCodeStore,
  email: string,
  code: string,
  nowMs: number,
  maxAttempts: number,
): VerifyResult {
  const key = normalizeEmail(email);
  const rec = store.get(key);
  if (!rec) return "no_code";
  if (rec.expiresAt <= nowMs) { store.delete(key); return "expired"; }
  if (rec.attempts >= maxAttempts) { store.delete(key); return "too_many_attempts"; }
  rec.attempts += 1;
  if (!constantTimeEqual(hashCode(code, rec.salt), rec.hash)) {
    if (rec.attempts >= maxAttempts) store.delete(key);
    return "mismatch";
  }
  store.delete(key);
  return "ok";
}
