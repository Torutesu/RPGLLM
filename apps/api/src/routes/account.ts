import { Hono } from "hono";
import { ConsentReqZ, DeleteAccountReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { testHooksEnabled } from "../env";
import { fail, ok, parseBody } from "../http";
import {
  buildExport, purgeAtFor, purgeDeletedAccounts, requireActiveAccount, resolveConsent, withinGraceWindow,
} from "../services/account";
import type { AppEnv } from "../types";

/**
 * S1-1 account deletion / restore / export / consent (App Store 5.1.1(v), GDPR, APPI).
 * Mounted at `/v1/account`.
 */
export function accountRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /** SCR-033 → /delete-account. Soft delete now, hard delete after the grace window. */
  app.post("/delete", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, DeleteAccountReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const deletedAt = deps.clock.now();
    await deps.prisma.user.update({ where: { id: user.id }, data: { deletedAt } });
    return ok({ deletedAt: deletedAt.toISOString(), purgeAt: purgeAtFor(deletedAt).toISOString() });
  });

  /**
   * Cancels a pending deletion. Deliberately NOT behind `requireActiveAccount` — a soft-deleted
   * user is exactly who calls this. (See the request to Agent F in build-notes.md: `requireAuth`
   * must keep letting this one path through when it starts answering 410.)
   */
  app.post("/restore", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    if (!user.deletedAt) return ok({ restored: false });
    if (!withinGraceWindow(user.deletedAt, deps.clock.now())) {
      return fail("ACCOUNT_DELETED", "The recovery window has passed", 410);
    }
    await deps.prisma.user.update({ where: { id: user.id }, data: { deletedAt: null } });
    return ok({ restored: true });
  });

  /** GDPR/APPI portability. Returned inline; the client saves it as a JSON file. */
  app.get("/export", requireAuth, requireActiveAccount, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    return ok(await buildExport(deps.prisma, user, deps.clock.now()));
  });

  /** S1-6 analytics / personalised-ads consent. Forced off (and locked) for minors. */
  app.post("/consent", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, ConsentReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const resolved = resolveConsent(user, body.value.analytics);
    await deps.prisma.user.update({ where: { id: user.id }, data: { analyticsConsent: resolved.analytics } });
    return ok(resolved);
  });

  /**
   * The purge job, exposed for tests only. Lives here rather than in `routes/test-hooks.ts`
   * (not this agent's file), so the path is `/v1/account/__test/purge-deleted`.
   */
  app.post("/__test/purge-deleted", async (c) => {
    if (!testHooksEnabled()) return fail("NOT_FOUND", "No such route", 404);
    const deps = c.get("deps");
    return ok(await purgeDeletedAccounts(deps.prisma, deps.clock.now()));
  });

  return app;
}
