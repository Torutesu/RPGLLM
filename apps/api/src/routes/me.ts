import { Hono } from "hono";
import { requireAuth } from "../auth";
import { ok } from "../http";
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
      },
      wallet: toApiWallet(wallet, { dailyMax, adsEnabled: !adFreeFor(subscription, deps.clock.now()), adPersonalized: !user.isMinor }),
      subscription: toApiSubscription(subscription),
      persona: persona ? toApiPersona(persona, persona.world.slug) : null,
      // Additive: `MeResZ` strips it on the client, which reads `GET /v1/streak` instead.
      streak,
    });
  });

  return app;
}
