import { Hono } from "hono";
import type { Context } from "hono";
import { AgeGateReqZ, AGE, AuthEmailStartReqZ, AuthEmailVerifyReqZ, DEV_EMAIL_CODE } from "@rpgllm/shared";
import { requireAuth, signSession } from "../auth";
import { constantTimeEqual, mailSender, normalizeEmail, type VerifyResult } from "../auth-codes";
import { authCodeMaxAttempts, authCodeTtlMs, authDevCodeEnabled } from "../env";
import { fail, ok, parseBody } from "../http";
import { consumeLoginCode, issueLoginCode } from "../services/login-codes";
import { createWallet } from "../services/wallet";
import type { AppEnv } from "../types";

export function authRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Issues a real one-time code (Agent F, S0-1): 6 digits, only the salted hash is stored,
   * 10-minute expiry, 5 verify attempts, single use, **persisted in the `LoginCode` table** so a
   * restart or a second API instance does not lose it (Agent O). Issuing invalidates the previous
   * pending code for the address. Delivery goes through `MailSender` (ConsoleMailSender by
   * default — TODO(P1): a real email provider).
   * The response never says whether the address exists.
   */
  app.post("/email/start", async (c) => {
    const body = await parseBody(c.req, AuthEmailStartReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const email = normalizeEmail(body.value.email);
    const code = await issueLoginCode(deps.prisma, email, deps.clock.now(), authCodeTtlMs());
    await mailSender().sendLoginCode(email, code);
    return ok({ sent: true });
  });

  const CODE_ERRORS: Record<Exclude<VerifyResult, "ok">, string> = {
    no_code: "Invalid or expired code",
    expired: "That code has expired. Request a new one.",
    too_many_attempts: "Too many attempts. Request a new code.",
    mismatch: "Invalid code",
  };

  const verify = async (c: Context<AppEnv>): Promise<Response> => {
    const body = await parseBody(c.req, AuthEmailVerifyReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const email = normalizeEmail(body.value.email);

    // The constant dev code is accepted ONLY behind AUTH_DEV_CODE=1 (implied by TEST_HOOKS=1);
    // `assertProductionConfig()` refuses to boot production with either flag on.
    const devCodeOk = authDevCodeEnabled() && constantTimeEqual(body.value.code, DEV_EMAIL_CODE);
    if (!devCodeOk) {
      const verdict = await consumeLoginCode(deps.prisma, email, body.value.code, deps.clock.now(), authCodeMaxAttempts());
      if (verdict !== "ok") return fail("UNAUTHORIZED", CODE_ERRORS[verdict], 401);
    }

    const existing = await deps.prisma.user.findUnique({ where: { email } });
    const user = existing ?? (await deps.prisma.user.create({
      data: { email, authProvider: "email", authSubject: email, birthYear: 0, isMinor: true },
    }));
    // One wallet, created once, with its opening balances and the ledger entry that records them
    // (services/wallet.ts) — including the World Studio starter gems.
    if (!existing) await createWallet(deps.prisma, user.id, deps.clock.now());
    return ok({ jwt: await signSession(user.id), isNew: !existing, needsAgeGate: user.birthYear === 0 });
  };

  app.post("/email/verify", verify);
  app.post("/email", verify);

  app.post("/age-gate", requireAuth, async (c) => {
    const body = await parseBody(c.req, AgeGateReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const age = deps.clock.now().getUTCFullYear() - body.value.birthYear;

    if (age < AGE.MIN) {
      // Keep the row (audit) but the account is permanently ineligible: requireAuth answers 401 from now on.
      await deps.prisma.user.update({
        where: { id: user.id },
        data: { birthYear: body.value.birthYear, isMinor: true, locale: body.value.locale },
      });
      return fail("UNDER_13", "You need to be 13 or older to use this app.", 403);
    }

    const isMinor = age < AGE.ADULT;
    await deps.prisma.user.update({
      where: { id: user.id },
      data: { birthYear: body.value.birthYear, isMinor, locale: body.value.locale },
    });
    return ok({ isMinor });
  });

  /** spec/03-api.md `POST /auth/:provider`. Apple/Google are adapter-only in MVP (build-plan §3). */
  app.post("/:provider", async (c) => {
    const provider = c.req.param("provider");
    if (provider === "email") return await verify(c);
    return fail("VALIDATION", `Provider "${provider}" is not enabled in this build`, 400);
  });

  return app;
}
