import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { AdRewardReqZ, CoffeeReqZ, ENERGY, TEST_AD_TOKEN } from "@rpgllm/shared";
import { adsMode } from "../env";
import { requireAuth } from "../auth";
import { constantTimeEqual } from "../auth-codes";
import { verifyAdMobSSV } from "../services/ad-verify";
import { fail, ok, parseBody } from "../http";
import { toApiWallet } from "../services/serialize";
import { adFreeFor, ensureWallet } from "../services/wallet";
import type { AppEnv } from "../types";

export function walletRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const { wallet, subscription, dailyMax } = await ensureWallet(deps.prisma, deps.clock, user.id);
    return ok(
      toApiWallet(wallet, {
        dailyMax,
        adsEnabled: !adFreeFor(subscription, deps.clock.now()),
        adPersonalized: !user.isMinor,
      }),
    );
  });

  /** SCR-032. With ADS_MODE=test only the mock SSV token is accepted. Daily cap → 429 AD_LIMIT. */
  app.post("/ad-reward", requireAuth, async (c) => {
    const body = await parseBody(c.req, AdRewardReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    // S0-6: the constant mock token is ONLY valid in ADS_MODE=test; anything else must carry a
    // real AdMob server-side-verification callback (services/ad-verify.ts).
    /**
     * `transactionId` is what makes this grant single-use. It is null only in `ADS_MODE=test`,
     * where the token is a constant and the daily cap is the only limit that means anything —
     * a real callback with no transaction id is refused inside `verifyAdMobSSV`.
     */
    let transactionId: string | null = null;
    if (adsMode() === "test") {
      if (!constantTimeEqual(body.value.adToken, TEST_AD_TOKEN)) return fail("VALIDATION", "Invalid ad token", 400);
    } else {
      const verdict = await verifyAdMobSSV(body.value.adToken, {
        expectedUserId: user.id,
        nowMs: deps.clock.now().getTime(),
      });
      if (!verdict.ok) return fail("VALIDATION", `Ad reward could not be verified (${verdict.reason})`, 400);
      transactionId = verdict.transactionId ?? null;
    }

    const { wallet, subscription } = await ensureWallet(deps.prisma, deps.clock, user.id);
    if (adFreeFor(subscription, deps.clock.now())) return fail("VALIDATION", "Ads are disabled for this account", 400);
    if (wallet.adRewardsToday >= ENERGY.AD_DAILY_MAX) return fail("AD_LIMIT", "Daily ad reward limit reached", 429);

    /*
     * The redemption is written **inside** the grant, so the unique index is what decides — not a
     * read-then-write, which two concurrent replays of the same callback would both pass. The
     * loser gets P2002 and the whole transaction rolls back, energy included.
     */
    let updated: { energy: number; adRewardsToday: number };
    try {
      updated = await deps.prisma.$transaction(async (tx) => {
        if (transactionId !== null) {
          await tx.adRedemption.create({ data: { transactionId, userId: user.id, createdAt: deps.clock.now() } });
        }
        const w = await tx.wallet.update({
          where: { id: wallet.id },
          data: { energy: { increment: ENERGY.AD_REWARD }, adRewardsToday: { increment: 1 } },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            currency: "energy",
            delta: ENERGY.AD_REWARD,
            source: "ad_reward",
            ref: `ad:${w.adRewardsToday}`,
          },
        });
        return w;
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return fail("ALREADY_DONE", "That ad reward has already been claimed", 409);
      }
      throw err;
    }
    return ok({ energy: updated.energy, adRewardsToday: updated.adRewardsToday });
  });

  app.post("/coffee", requireAuth, async (c) => {
    const body = await parseBody(c.req, CoffeeReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    if (wallet.coffee < 1) return fail("VALIDATION", "No coffee left", 400);

    const updated = await deps.prisma.$transaction(async (tx) => {
      const w = await tx.wallet.update({
        where: { id: wallet.id },
        data: { coffee: { decrement: 1 }, energy: { increment: ENERGY.COFFEE_ENERGY } },
      });
      await tx.ledgerEntry.create({
        data: { walletId: wallet.id, currency: "coffee", delta: -1, source: "spend", ref: "coffee" },
      });
      await tx.ledgerEntry.create({
        data: { walletId: wallet.id, currency: "energy", delta: ENERGY.COFFEE_ENERGY, source: "admin", ref: "coffee" },
      });
      return w;
    });
    return ok({ energy: updated.energy, coffee: updated.coffee });
  });

  return app;
}
