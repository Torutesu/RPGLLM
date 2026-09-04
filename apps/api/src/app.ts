import { Hono } from "hono";
import { cors } from "hono/cors";
import { testHooksEnabled } from "./env";
import { fail } from "./http";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { dmRoutes } from "./routes/dms";
import { eventRoutes } from "./routes/events";
import { experimentRoutes } from "./routes/experiments";
import { feedRoutes } from "./routes/feed";
import { generationRoutes } from "./routes/generations";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { personaRoutes } from "./routes/personas";
import { postRoutes } from "./routes/posts";
import { statRoutes } from "./routes/stats";
import { testHookRoutes } from "./routes/test-hooks";
import { walletRoutes } from "./routes/wallet";
import { worldRoutes } from "./routes/worlds";
import type { AppEnv, AppState, Deps } from "./types";

/**
 * Dependency-injected app factory: vitest passes a FakeGateway and a controllable clock,
 * `index.ts` passes the real `@rpgllm/llm` gateway.
 */
export function createApp(deps: Deps): Hono<AppEnv> {
  const state: AppState = {
    softenedPosts: new Map(),
    softenedThreads: new Map(),
    personaIdempotency: new Map(),
  };

  const app = new Hono<AppEnv>();
  app.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    c.set("state", state);
    await next();
  });

  const v1 = new Hono<AppEnv>();
  v1.route("/auth", authRoutes());
  v1.route("/me", meRoutes());
  v1.route("/worlds", worldRoutes());
  v1.route("/personas", personaRoutes());
  v1.route("/feed", feedRoutes());
  v1.route("/posts", postRoutes());
  v1.route("/events", eventRoutes());
  v1.route("/stats", statRoutes());
  v1.route("/dms", dmRoutes());
  v1.route("/wallet", walletRoutes());
  v1.route("/billing", billingRoutes());
  v1.route("/generations", generationRoutes());
  v1.route("/experiments", experimentRoutes());
  v1.route("/health", healthRoutes());
  if (testHooksEnabled()) v1.route("/__test", testHookRoutes());
  app.route("/v1", v1);

  // Unversioned aliases so probes and the E2E harness can reach them either way.
  app.route("/health", healthRoutes());
  if (testHooksEnabled()) app.route("/__test", testHookRoutes());

  app.notFound(() => fail("NOT_FOUND", "No such route", 404));
  app.onError((err) => {
    console.error("[api] unhandled error", err);
    return fail("INTERNAL", "Something went wrong", 500);
  });

  return app;
}
