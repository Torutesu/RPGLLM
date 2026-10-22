import { Hono } from "hono";
import { RegisterPushReqZ, UnregisterPushReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { ok, parseBody } from "../http";
import type { AppEnv } from "../types";

/**
 * S2-2 — Expo push token registration.
 *
 * `PushToken.token` is unique across accounts: re-registering the same device under a new account
 * moves it (a shared phone must not keep receiving the previous user's digests).
 *
 * **And the way back out.** For a long time this file had `register` and nothing else, which made
 * the OS notification setting the only off switch in a product whose whole retention loop is a
 * push. `enabled` was already on the row; what was missing was a door. Unregistering keeps the
 * row (deleting it would lose which device this is, and the receipt sweep still wants the token)
 * and flips the flag, so turning notifications back on is one tap rather than a re-registration
 * dance with the OS.
 */
export function pushRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/register", requireAuth, async (c) => {
    const body = await parseBody(c.req, RegisterPushReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const now = deps.clock.now();
    await deps.prisma.pushToken.upsert({
      where: { token: body.value.token },
      create: { userId: user.id, token: body.value.token, platform: body.value.platform, lastSeenAt: now },
      update: { userId: user.id, platform: body.value.platform, enabled: true, lastSeenAt: now },
    });
    return ok({ registered: true });
  });

  /** Is this account receiving pushes? What the settings toggle renders from. */
  app.get("/status", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const devices = await deps.prisma.pushToken.count({ where: { userId: user.id, enabled: true } });
    return ok({ enabled: devices > 0, devices });
  });

  app.post("/unregister", requireAuth, async (c) => {
    const body = await parseBody(c.req, UnregisterPushReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    /*
     * Scoped to this user's own tokens in both branches. `token` is a device identifier somebody
     * else could hold — a shared phone that moved accounts — and silencing a stranger's device
     * because you know its token would be a small, quiet way to attack them.
     */
    const where =
      body.value.allDevices || !body.value.token
        ? { userId: user.id, enabled: true }
        : { userId: user.id, token: body.value.token, enabled: true };
    const { count } = await deps.prisma.pushToken.updateMany({ where, data: { enabled: false } });
    return ok({ disabled: count });
  });

  return app;
}
