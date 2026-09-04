import { Hono } from "hono";
import { cors } from "hono/cors";
import { corsAllowAll, corsOrigins, testHooksEnabled } from "./env";
import { fail } from "./http";
import { rateLimit, type RateLimitStore } from "./middleware/rate-limit";
import { logError, requestLog } from "./middleware/request-log";
import { accountRoutes } from "./routes/account";
import { authRoutes } from "./routes/auth";
import { billingRoutes } from "./routes/billing";
import { costRoutes } from "./routes/cost";
import { jobRoutes } from "./jobs";
import { digestRoutes } from "./routes/digest";
import { dmRoutes } from "./routes/dms";
import { memoryRoutes } from "./routes/memory";
import { momentRoutes } from "./routes/moments";
import { profileRoutes } from "./routes/profile";
import { pushRoutes } from "./routes/push";
import { referralRoutes } from "./routes/referral";
import { eventRoutes } from "./routes/events";
import { experimentRoutes } from "./routes/experiments";
import { feedRoutes } from "./routes/feed";
import { generationRoutes } from "./routes/generations";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { moderationRoutes } from "./routes/moderation";
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
    emailCodes: new Map(),
  };
  /** Rate-limit buckets live for the lifetime of one app instance (see middleware/rate-limit.ts). */
  const buckets: RateLimitStore = new Map();

  const app = new Hono<AppEnv>();
  app.use("*", requestLog);
  /**
   * CORS allow-list (S0-5). This API is cookie-less but bearer-authenticated, so `*` was not a
   * catastrophe on its own — it did however let any origin read authenticated JSON from a browser
   * that had the token in `localStorage` and a script that leaked it. `TEST_HOOKS=1` keeps `*`
   * so the E2E harness can serve the web export from any port.
   */
  app.use("*", cors({
    // Evaluated per request so the flags stay late-bound (tests flip them between app instances).
    origin: (origin: string) => (corsAllowAll() ? (origin || "*") : (corsOrigins().includes(origin) ? origin : null)),
    allowHeaders: ["authorization", "content-type", "x-request-id", "accept", "last-event-id"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    exposeHeaders: ["x-request-id", "retry-after"],
    maxAge: 600,
  }));
  app.use("*", async (c, next) => {
    c.set("deps", deps);
    c.set("state", state);
    await next();
  });
  app.use("*", rateLimit(buckets, () => deps.clock.now().getTime()));

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
  v1.route("/cost", costRoutes());
  // Agent G (S1): account deletion/export/consent and report/block.
  v1.route("/account", accountRoutes());
  v1.route("/moderation", moderationRoutes());
  // Agent H (S2): retention & growth.
  v1.route("/digest", digestRoutes());
  v1.route("/memory", memoryRoutes());
  v1.route("/moments", momentRoutes());
  v1.route("/referral", referralRoutes());
  v1.route("/profile", profileRoutes());
  v1.route("/push", pushRoutes());
  v1.route("/health", healthRoutes());
  if (testHooksEnabled()) v1.route("/__test", testHookRoutes());
  // `POST /__test/run-job` — the manual scheduler; guards itself with testHooksEnabled().
  v1.route("/__test", jobRoutes());
  app.route("/v1", v1);

  // Unversioned aliases so probes and the E2E harness can reach them either way.
  app.route("/health", healthRoutes());
  if (testHooksEnabled()) app.route("/__test", testHookRoutes());

  app.notFound(() => fail("NOT_FOUND", "No such route", 404));
  app.onError((err, c) => {
    logError(c, err);
    return fail("INTERNAL", "Something went wrong", 500);
  });

  return app;
}
