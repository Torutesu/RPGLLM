import { Hono } from "hono";
import { RegisterPushReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { ok, parseBody } from "../http";
import type { AppEnv } from "../types";

/**
 * S2-2 — Expo push token registration.
 *
 * `PushToken.token` is unique across accounts: re-registering the same device under a new account
 * moves it (a shared phone must not keep receiving the previous user's digests).
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

  return app;
}
