import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REFERRAL } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

interface ReferralBody { code: string; link: string; invited: number; coffeeEarned: number; canRedeem: boolean }
interface RedeemBody { coffee: number; energy: number }

const referral = (token: string) => call<ReferralBody>(h, "GET", "/v1/referral", { token });
const redeem = (token: string, code: string) =>
  call<RedeemBody>(h, "POST", "/v1/referral/redeem", { token, body: { code } });

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

describe("referral (S2-5)", () => {
  it("issues a stable code and a link that carries it", async () => {
    const inviter = await signup(h);
    const first = await referral(inviter.token);
    expect(first.status).toBe(200);
    expect(first.data.code).toHaveLength(REFERRAL.CODE_LENGTH);
    expect(first.data.code).toMatch(/^[A-Z0-9]+$/);
    expect(first.data.code, "unambiguous alphabet: no O/I/L/U/0/1").not.toMatch(/[OILU01]/);
    expect(first.data.link).toContain(first.data.code);
    expect(first.data.invited).toBe(0);
    expect(first.data.coffeeEarned).toBe(0);

    const second = await referral(inviter.token);
    expect(second.data.code).toBe(first.data.code);
  });

  it("grants both sides a coffee, and refuses self-referral, reuse and a stale account", async () => {
    const inviter = await signup(h);
    const code = (await referral(inviter.token)).data.code;

    // self-referral
    const mine = await redeem(inviter.token, code);
    expect(mine.status).toBe(400);
    expect(mine.error?.code).toBe("VALIDATION");

    // unknown code
    const invitee = await signup(h);
    const nonsense = await redeem(invitee.token, "ZZZZZZZZ");
    expect(nonsense.status).toBe(404);

    const ok = await redeem(invitee.token, code.toLowerCase());  // case-insensitive
    expect(ok.status).toBe(200);
    expect(ok.data.coffee).toBe(REFERRAL.INVITEE_COFFEE);

    const inviterWallet = await prisma.wallet.findFirstOrThrow({ where: { userId: inviter.userId } });
    expect(inviterWallet.coffee).toBe(REFERRAL.INVITER_COFFEE);
    const entries = await prisma.ledgerEntry.findMany({ where: { source: "referral" } });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.currency === "coffee")).toBe(true);

    const stats = await referral(inviter.token);
    expect(stats.data.invited).toBe(1);
    expect(stats.data.coffeeEarned).toBe(REFERRAL.INVITER_COFFEE);

    // double redemption (Referral.inviteeId is unique)
    const twice = await redeem(invitee.token, code);
    expect(twice.status).toBe(409);
    expect(twice.error?.code).toBe("ALREADY_DONE");
    expect(await prisma.referral.count()).toBe(1);
  });

  it("only lets a new account redeem: with a persona, the window closes after a day", async () => {
    const inviter = await signup(h);
    const code = (await referral(inviter.token)).data.code;

    const established = await signupWithPersona(h);
    // still inside its first day, even with a persona
    expect((await referral(established.token)).data.canRedeem).toBe(true);

    await prisma.user.update({
      where: { id: established.userId },
      data: { createdAt: new Date(h.clock.now().getTime() - 3 * 24 * 3_600_000) },
    });
    const stale = await referral(established.token);
    expect(stale.data.canRedeem).toBe(false);

    const res = await redeem(established.token, code);
    expect(res.status).toBe(400);
    expect(await prisma.referral.count()).toBe(0);

    // A fresh account with no persona at all is still welcome.
    const brandNew = await signup(h);
    expect((await redeem(brandNew.token, code)).status).toBe(200);
  });
});
