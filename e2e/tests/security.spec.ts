import { expect, test } from "@playwright/test";
import { DEV_EMAIL_CODE } from "@rpgllm/shared";
import {
  apiUrl, bearer, browserToken, errorOf, randomEmail, resetDb, uiAgeGate, uiEmailLogin, yearsAgo,
} from "../fixtures";

test.beforeEach(async ({ request }) => {
  await resetDb(request);
});

/**
 * Agent F (security). The login code is now a real one-time code; the constant dev code is only
 * accepted because the E2E API runs with TEST_HOOKS=1 (which implies AUTH_DEV_CODE=1 — production
 * refuses to boot with either). This case proves the browser sign-in still works end to end, and
 * that the two hardened doors stay shut: a wrong code, and `?token=` on a mutating route.
 */
test("SEC-001: dev-code sign-in works end to end and the hardened doors stay shut", async ({ page, request }) => {
  const email = randomEmail();
  await uiEmailLogin(page, email);
  await uiAgeGate(page, yearsAgo(25));

  const jwt = await browserToken(page);
  expect(jwt, "the browser holds a session JWT after the code + age gate").toBeTruthy();

  const me = await request.get(apiUrl("/v1/me"), { headers: bearer(jwt!), failOnStatusCode: false });
  expect(me.status(), "/v1/me with the session from the UI sign-in").toBe(200);

  // A wrong code is rejected (the dev code is one specific constant, not "any code").
  const wrong = await request.post(apiUrl("/v1/auth/email/verify"), {
    data: { email: randomEmail(), code: "123456" }, failOnStatusCode: false,
  });
  expect(wrong.status(), "a code that was never issued").toBe(401);
  expect((await errorOf(wrong))?.code).toBe("UNAUTHORIZED");

  // `?token=` is for EventSource on /stream only — never for a mutating route (S0-7).
  const forged = await request.post(apiUrl(`/v1/posts?token=${jwt!}`), {
    data: { text: "query-token should not authenticate this", idempotencyKey: `sec-${Date.now()}` },
    failOnStatusCode: false,
  });
  expect(forged.status(), "POST /v1/posts?token= must not authenticate").toBe(401);

  // Sanity: the dev code constant is what the harness relies on.
  expect(DEV_EMAIL_CODE).toHaveLength(6);
});
