/**
 * One-time email login codes (Agent F, S0-1).
 *
 * Before this, `POST /auth/email/verify` accepted the constant `DEV_EMAIL_CODE` for ANY email,
 * which is a full authentication bypass in production. A code is now generated per request,
 * only its **salted sha256 hash** is stored, it expires after 10 minutes, survives at most 5
 * verify attempts and is single-use.
 *
 * TODO(P1): move the store to Redis/Postgres. It currently lives in an in-memory `Map` on
 * `AppState` because `prisma/schema.prisma` is owned by the orchestrator (see build-notes,
 * "Agent F"). Consequences of the in-memory store: codes do not survive a restart and do not
 * work across more than one API instance. A `LoginCode` table (email, salt, hash, expiresAt,
 * attempts, consumedAt) is the fix.
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

/** Generates a code, stores its hash, and returns the plaintext for the mail sender only. */
export function issueCode(store: EmailCodeStore, email: string, nowMs: number, ttlMs: number): string {
  prune(store, nowMs);
  const code = generateCode();
  const salt = randomBytes(16).toString("hex");
  store.set(normalizeEmail(email), { salt, hash: hashCode(code, salt), expiresAt: nowMs + ttlMs, attempts: 0 });
  return code;
}

export type VerifyResult = "ok" | "no_code" | "expired" | "too_many_attempts" | "mismatch";

/** Single-use: a correct code is deleted; a wrong one burns one of `maxAttempts`. */
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
