import { Hono } from "hono";
import { SetCreatorHandleReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, ok, parseBody } from "../http";
import { requireActiveAccount } from "../services/account";
import { renameCreatorHandle } from "../services/creator-rename";
import { checkIn } from "../services/streak";
import { adFreeFor, ensureWallet } from "../services/wallet";
import { toApiPersona, toApiSubscription, toApiWallet } from "../services/serialize";
import type { AppEnv } from "../types";

export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    // Agent L: the daily check-in runs on the first `/v1/me` of a UTC day and pays the streak
    // ladder into the wallet, so the wallet read below already includes it.
    const streak = await checkIn(deps.prisma, deps.clock, user.id);
    const { wallet, subscription, dailyMax } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const persona = await deps.prisma.persona.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { world: true },
    });
    return ok({
      user: {
        id: user.id, locale: user.locale, isMinor: user.isMinor,
        birthYear: user.birthYear > 0 ? user.birthYear : null,
        email: user.email, analyticsConsent: user.analyticsConsent,
        // 勝ち筋 A ②: the name this account's worlds are credited to. The client needs it to know
        // whether a creator page is its own, and to show what the rename would be changing.
        creatorHandle: user.creatorHandle,
      },
      wallet: toApiWallet(wallet, { dailyMax, adsEnabled: !adFreeFor(subscription, deps.clock.now()), adPersonalized: !user.isMinor }),
      subscription: toApiSubscription(subscription),
      persona: persona ? toApiPersona(persona, persona.world.slug) : null,
      // Additive: `MeResZ` strips it on the client, which reads `GET /v1/streak` instead.
      streak,
    });
  });

  /**
   * SCR-051 → rename. **The way out of a minted placeholder.**
   *
   * Most creators never make a persona, so most creators are `quietheron42` — a name they never
   * chose, on a page other people are meant to link to. Everything about what this is allowed to do
   * (the free graduation, the cooldown after it, and why a released name is not immediately
   * somebody else's) is in `services/creator-rename.ts`; this handler turns the outcome into HTTP.
   */
  app.post("/creator-handle", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, SetCreatorHandleReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");

    const outcome = await renameCreatorHandle(deps.prisma, user, body.value.handle, deps.clock.now());
    if (outcome.ok) return ok({ creatorHandle: outcome.handle });

    switch (outcome.reason) {
      case "invalid":
        return fail("VALIDATION", "That name can't be used", 400);
      // 409, like every other "somebody already has this" in the product: it is a fact about the
      // world, not a malformed request, and the client's answer is to offer another name.
      case "taken":
      case "reserved":
      case "cast":
        return fail("HANDLE_TAKEN", "That name is taken", 409);
      case "too_soon": {
        const days = Math.max(1, Math.ceil((outcome.availableAt.getTime() - deps.clock.now().getTime()) / 86_400_000));
        return fail("RATE_LIMITED", `You can change your creator name again in ${days} ${days === 1 ? "day" : "days"}.`, 429);
      }
    }
  });

  return app;
}
