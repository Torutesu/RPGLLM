import { Hono } from "hono";
import { requireAuth } from "../auth";
import { ok } from "../http";
import type { AppEnv } from "../types";

export function experimentRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** AIF-006. Fixed 50/50 allocation in MVP; persisted for the nightly report (E2E-013). */
  app.get("/assignments", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const assignments = deps.gateway.assignments(user.id);
    for (const [experimentKey, variantId] of Object.entries(assignments)) {
      await deps.prisma.experimentAssignment.upsert({
        where: { userId_experimentKey: { userId: user.id, experimentKey } },
        create: { userId: user.id, experimentKey, variantId },
        update: { variantId },
      });
    }
    return ok(assignments);
  });

  return app;
}
