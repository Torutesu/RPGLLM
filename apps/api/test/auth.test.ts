import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEV_EMAIL_CODE, ENERGY } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

describe("auth + age gate (E2E-001, E2E-016)", () => {
  it("starts an email login and issues a JWT for the dev code", async () => {
    const start = await call(h, "POST", "/v1/auth/email/start", { body: { email: "a@example.com" } });
    expect(start.status).toBe(200);

    const bad = await call(h, "POST", "/v1/auth/email/verify", { body: { email: "a@example.com", code: "123456" } });
    expect(bad.status).toBe(401);

    const res = await call<{ jwt: string; isNew: boolean; needsAgeGate: boolean }>(h, "POST", "/v1/auth/email/verify", {
      body: { email: "a@example.com", code: DEV_EMAIL_CODE },
    });
    expect(res.status).toBe(200);
    expect(res.data.isNew).toBe(true);
    expect(res.data.needsAgeGate).toBe(true);
    expect(res.data.jwt.length).toBeGreaterThan(20);

    const wallet = await getWallet(h, res.data.jwt);
    expect(wallet.data.energy).toBe(ENERGY.FREE_DAILY);
  });

  it("rejects validation errors with 400 VALIDATION", async () => {
    const res = await call(h, "POST", "/v1/auth/email/verify", { body: { email: "not-an-email", code: "0" } });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe("VALIDATION");
  });

  it("blocks under-13 with 403 UNDER_13 and leaves /me at 401", async () => {
    const year = new Date().getUTCFullYear();
    const auth = await call<{ jwt: string }>(h, "POST", "/v1/auth/email/verify", {
      body: { email: "kid@example.com", code: DEV_EMAIL_CODE },
    });
    const token = auth.data.jwt;

    const gate = await call(h, "POST", "/v1/auth/age-gate", { token, body: { birthYear: year - 12, locale: "en" } });
    expect(gate.status).toBe(403);
    expect(gate.error?.code).toBe("UNDER_13");

    const me = await call(h, "GET", "/v1/me", { token });
    expect(me.status).toBe(401);

    // The user row is kept for audit, but no persona-capable session exists.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "kid@example.com" } });
    expect(user.birthYear).toBe(year - 12);
    expect(await prisma.persona.count()).toBe(0);
  });

  it("marks 13..17 as minors (non-personalized ads) and 18+ as adults", async () => {
    const year = new Date().getUTCFullYear();
    const minor = await signup(h, { birthYear: year - 16 });
    expect(minor.ageGateStatus).toBe(200);
    const minorMe = await call<{ user: { isMinor: boolean }; wallet: { adPersonalized: boolean } }>(h, "GET", "/v1/me", { token: minor.token });
    expect(minorMe.data.user.isMinor).toBe(true);
    expect(minorMe.data.wallet.adPersonalized).toBe(false);

    const adult = await signup(h, { birthYear: year - 30 });
    const adultMe = await call<{ user: { isMinor: boolean }; wallet: { adPersonalized: boolean; dailyMax: number } }>(h, "GET", "/v1/me", { token: adult.token });
    expect(adultMe.data.user.isMinor).toBe(false);
    expect(adultMe.data.wallet.adPersonalized).toBe(true);
    expect(adultMe.data.wallet.dailyMax).toBe(ENERGY.FREE_DAILY);
  });

  it("health reports the gateway mode and champion map", async () => {
    const res = await call<{ ok: boolean; llmMode: string; champion: Record<string, string> }>(h, "GET", "/v1/health");
    expect(res.data.ok).toBe(true);
    expect(res.data.llmMode).toBe("replay");
    expect(res.data.champion["G1"]).toBeDefined();
  });
});
