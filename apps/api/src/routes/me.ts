import { Hono } from "hono";
import { requireAuth } from "../auth";
import { ok } from "../http";
import { adFreeFor, ensureWallet } from "../services/wallet";
import { toApiPersona, toApiSubscription, toApiWallet } from "../services/serialize";
import type { AppEnv } from "../types";

export function meRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const { wallet, subscription, dailyMax } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const persona = await deps.prisma.persona.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { world: true },
    });
    return ok({
      user: { id: user.id, locale: user.locale, isMinor: user.isMinor, birthYear: user.birthYear > 0 ? user.birthYear : null },
      wallet: toApiWallet(wallet, { dailyMax, adsEnabled: !adFreeFor(subscription), adPersonalized: !user.isMinor }),
      subscription: toApiSubscription(subscription),
      persona: persona ? toApiPersona(persona, persona.world.slug) : null,
    });
  });

  return app;
}
