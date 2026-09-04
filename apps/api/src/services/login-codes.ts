/**
 * One-time email login codes, stored in Postgres (`LoginCode`).
 *
 * Agent F shipped the code lifecycle as an in-process `Map` on `AppState` (`auth-codes.ts`), which
 * is only correct for a single API instance: a restart or a second replica loses every pending
 * code. The table makes the flow instance-independent — the API can now run behind more than one
 * process — while keeping the exact same security properties:
 *
 *   - only a **salted sha256** of the code is ever stored (per-code 16-byte salt), never the digits;
 *   - 10-minute expiry (`AUTH_CODE_TTL_MS`), at most 5 verify attempts (`AUTH_CODE_MAX_ATTEMPTS`);
 *   - single use — a correct code is marked `consumedAt` in a conditional update, so two racing
 *     verifies cannot both win;
 *   - constant-time digest comparison;
 *   - **one active code per email**: issuing a new one consumes every older pending row, so an
 *     attacker cannot keep an old code alive by asking for a new one.
 *
 * Every time read comes from the injected clock (`deps.clock.now()`), so `/__test/time-travel`
 * expires codes exactly like wall-clock time would.
 */
import type { PrismaClient } from "@prisma/client";
import { constantTimeEqual, generateCode, hashCode, newSalt, normalizeEmail, type VerifyResult } from "../auth-codes";

export type { VerifyResult };

/** Issues a code, stores only its hash, and returns the plaintext for the mail sender. */
export async function issueLoginCode(
  prisma: PrismaClient,
  email: string,
  now: Date,
  ttlMs: number,
): Promise<string> {
  const key = normalizeEmail(email);
  const code = generateCode();
  const salt = newSalt();
  await prisma.$transaction([
    // One active code per email: whatever was pending is dead the moment a new one is issued.
    prisma.loginCode.updateMany({ where: { email: key, consumedAt: null }, data: { consumedAt: now } }),
    prisma.loginCode.create({
      data: { email: key, salt, codeHash: hashCode(code, salt), expiresAt: new Date(now.getTime() + ttlMs), createdAt: now },
    }),
  ]);
  return code;
}

/**
 * Verifies a code. A correct code is consumed; a wrong one burns one of `maxAttempts`.
 * Never throws — every failure mode is a verdict the caller turns into the same 401.
 */
export async function consumeLoginCode(
  prisma: PrismaClient,
  email: string,
  code: string,
  now: Date,
  maxAttempts: number,
): Promise<VerifyResult> {
  const key = normalizeEmail(email);
  const row = await prisma.loginCode.findFirst({
    where: { email: key, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return "no_code";
  if (row.expiresAt <= now) {
    await prisma.loginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
    return "expired";
  }
  if (row.attempts >= maxAttempts) return "too_many_attempts";

  // Burn the attempt *before* comparing, so a crash mid-verify can only ever cost the attacker.
  const attempted = await prisma.loginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  if (!constantTimeEqual(hashCode(code, row.salt), row.codeHash)) {
    return attempted.attempts >= maxAttempts ? "too_many_attempts" : "mismatch";
  }

  // Single use: only the update that flips a still-null `consumedAt` wins.
  const claimed = await prisma.loginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: now } });
  return claimed.count === 1 ? "ok" : "no_code";
}

/**
 * Housekeeping for the `purge-login-codes` job: drop everything that can no longer be used —
 * expired rows and rows already consumed. Returns how many were deleted.
 */
export async function purgeLoginCodes(prisma: PrismaClient, now: Date): Promise<number> {
  const { count } = await prisma.loginCode.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
  });
  return count;
}
