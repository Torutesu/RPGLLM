import type { PrismaClient, User } from "@prisma/client";
import { REFERRAL } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { hashString } from "./rng";
import { ensureWallet } from "./wallet";

/**
 * S2-5 — referral codes.
 *
 * Alphabet excludes 0/O/1/I/L/U so a code can be read out loud or typed from a screenshot.
 * `LedgerEntry.source` has a `referral` value in the schema, so both grants are auditable.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** How long after signup an account may still redeem an invite (a stale account cannot). */
export const REDEEM_WINDOW_HOURS = 24;

/** Where the invite link points. No env.ts entry (Agent F owns it), so this reads the var directly. */
export const inviteLinkBase = (): string => {
  const raw = process.env.PUBLIC_APP_URL ?? "";
  return raw.length > 0 ? raw.replace(/\/+$/, "") : "https://rpgllm.example";
};

export const inviteLink = (code: string): string => `${inviteLinkBase()}/invite?code=${encodeURIComponent(code)}`;

export function codeFrom(seed: string): string {
  let h = hashString(seed);
  let out = "";
  for (let i = 0; i < REFERRAL.CODE_LENGTH; i += 1) {
    h = hashString(`${seed}:${h}:${i}`);
    out += ALPHABET[h % ALPHABET.length] ?? "A";
  }
  return out;
}

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Idempotent: returns the user's code, minting one on first read. */
export async function ensureReferralCode(prisma: PrismaClient, user: User): Promise<string> {
  if (user.referralCode) return user.referralCode;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = codeFrom(`${user.id}:${attempt}`);
    const clash = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (clash && clash.id !== user.id) continue;
    const updated = await prisma.user.update({ where: { id: user.id }, data: { referralCode: code }, select: { referralCode: true } });
    return updated.referralCode ?? code;
  }
  throw new Error("could not mint a referral code");
}

export interface RedeemEligibility {
  canRedeem: boolean;
  reason: "ok" | "already_redeemed" | "account_too_old";
}

/**
 * Only a brand-new account may redeem: no persona yet, or still inside its first day.
 * (Otherwise an established player could farm coffee by redeeming a friend's code later.)
 */
export async function redeemEligibility(prisma: PrismaClient, clock: Clock, user: User): Promise<RedeemEligibility> {
  const used = await prisma.referral.findUnique({ where: { inviteeId: user.id }, select: { id: true } });
  if (used) return { canRedeem: false, reason: "already_redeemed" };
  const personas = await prisma.persona.count({ where: { userId: user.id } });
  if (personas === 0) return { canRedeem: true, reason: "ok" };
  const ageHours = (clock.now().getTime() - user.createdAt.getTime()) / 3_600_000;
  return ageHours <= REDEEM_WINDOW_HOURS ? { canRedeem: true, reason: "ok" } : { canRedeem: false, reason: "account_too_old" };
}

export interface ReferralStats {
  code: string;
  link: string;
  invited: number;
  coffeeEarned: number;
  canRedeem: boolean;
}

export async function referralStats(prisma: PrismaClient, clock: Clock, user: User): Promise<ReferralStats> {
  const code = await ensureReferralCode(prisma, user);
  const invited = await prisma.referral.count({ where: { inviterId: user.id, rewardedAt: { not: null } } });
  const { canRedeem } = await redeemEligibility(prisma, clock, user);
  return {
    code,
    link: inviteLink(code),
    invited,
    coffeeEarned: invited * REFERRAL.INVITER_COFFEE,
    canRedeem,
  };
}

export type RedeemOutcome =
  | { ok: true; coffee: number; energy: number }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION" | "ALREADY_DONE"; message: string };

export async function redeemReferral(
  prisma: PrismaClient,
  clock: Clock,
  user: User,
  rawCode: string,
): Promise<RedeemOutcome> {
  const code = normalizeCode(rawCode);
  if (code.length === 0) return { ok: false, code: "VALIDATION", message: "Enter a code" };

  const inviter = await prisma.user.findUnique({ where: { referralCode: code } });
  if (!inviter || inviter.deletedAt) return { ok: false, code: "NOT_FOUND", message: "That code does not exist" };
  if (inviter.id === user.id) return { ok: false, code: "VALIDATION", message: "You cannot invite yourself" };

  const eligibility = await redeemEligibility(prisma, clock, user);
  if (!eligibility.canRedeem) {
    return eligibility.reason === "already_redeemed"
      ? { ok: false, code: "ALREADY_DONE", message: "This account already used an invite code" }
      : { ok: false, code: "VALIDATION", message: "Invite codes can only be redeemed by a new account" };
  }

  // Both wallets must exist before the transaction so the grants are pure updates.
  const [inviterWallet, inviteeWallet] = await Promise.all([
    ensureWallet(prisma, clock, inviter.id),
    ensureWallet(prisma, clock, user.id),
  ]);

  const wallet = await prisma.$transaction(async (tx) => {
    const referral = await tx.referral.create({
      data: { inviterId: inviter.id, inviteeId: user.id, code, rewardedAt: clock.now() },
    });
    await tx.wallet.update({
      where: { id: inviterWallet.wallet.id },
      data: { coffee: { increment: REFERRAL.INVITER_COFFEE } },
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: inviterWallet.wallet.id, currency: "coffee", delta: REFERRAL.INVITER_COFFEE,
        source: "referral", ref: `referral:${referral.id}:inviter`,
      },
    });
    const invitee = await tx.wallet.update({
      where: { id: inviteeWallet.wallet.id },
      data: { coffee: { increment: REFERRAL.INVITEE_COFFEE } },
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: inviteeWallet.wallet.id, currency: "coffee", delta: REFERRAL.INVITEE_COFFEE,
        source: "referral", ref: `referral:${referral.id}:invitee`,
      },
    });
    return invitee;
  });

  return { ok: true, coffee: wallet.coffee, energy: wallet.energy };
}
