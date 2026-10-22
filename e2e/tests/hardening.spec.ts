import { expect, test, type APIRequestContext } from "@playwright/test";
import { T } from "@rpgllm/shared";
import { apiSignup, apiUrl, bearer, gotoApp, loginInBrowser, resetDb, unwrap, type Account } from "../fixtures";

/**
 * E2E-047..050 — the 12th pass, from outside the process.
 *
 * The unit tests prove the middleware and the column behave. These prove the *deployed* service
 * does: that the headers survive a real HTTP round trip (they are set after `next()`, which is
 * exactly the kind of thing that works in a handler test and vanishes behind a framework), that a
 * revoked token is dead on the wire, and that the settings screen actually offers the two
 * controls a person needs when a device is gone or the pushes are unwanted.
 */

async function signOutEverywhere(request: APIRequestContext, account: Account): Promise<void> {
  await unwrap(
    await request.post(apiUrl("/v1/auth/sign-out"), {
      headers: bearer(account.jwt),
      data: { allDevices: true },
      failOnStatusCode: false,
    }),
    "POST /v1/auth/sign-out",
  );
}

test.describe("Hardening", () => {
  test.beforeEach(async ({ request }) => {
    await resetDb(request);
  });

  /* ---------------------------------------------------------------- E2E-047 ---- */

  test("E2E-047: every response carries the headers a browser defends itself with", async ({ request }) => {
    const res = await request.get(apiUrl("/v1/health"), { failOnStatusCode: false });
    const h = res.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy"], "a JSON API should allow a browser to render nothing").toContain(
      "default-src 'none'",
    );

    // The share page is the only HTML here, and the one a stranger opens from a link.
    const share = await request.get(apiUrl("/s/w/popstar-era"), { failOnStatusCode: false });
    const csp = share.headers()["content-security-policy"] ?? "";
    expect(csp, "clickjacking: this page is a large Open-it button").toContain("frame-ancestors 'none'");
    expect(csp, "and it runs no script at all").not.toContain("script-src");
  });

  /* ---------------------------------------------------------------- E2E-048 ---- */

  test("E2E-048: a body nobody should send is refused before it is parsed", async ({ request }) => {
    const account = await apiSignup(request);
    const res = await request.post(apiUrl("/v1/posts"), {
      headers: { ...bearer(account.jwt), "content-type": "application/json" },
      data: { text: "x".repeat(200_000) },
      failOnStatusCode: false,
    });
    // 413, not 400: the size is the reason, and saying so is what tells an operator what happened.
    expect(res.status()).toBe(413);
  });

  /* ---------------------------------------------------------------- E2E-049 ---- */

  test("E2E-049: signing out of all devices kills a session held elsewhere", async ({ request }) => {
    const account = await apiSignup(request);
    // A second client holding the same session — the phone left on a train.
    const elsewhere = account.jwt;

    const before = await request.get(apiUrl("/v1/me"), { headers: bearer(elsewhere), failOnStatusCode: false });
    expect(before.status()).toBe(200);

    await signOutEverywhere(request, account);

    const after = await request.get(apiUrl("/v1/me"), { headers: bearer(elsewhere), failOnStatusCode: false });
    expect(after.status(), "the 30-day token must stop working the moment it is revoked").toBe(401);
  });

  /* ---------------------------------------------------------------- E2E-050 ---- */

  test("E2E-050: the controls exist where a person would look for them", async ({ page, request }) => {
    const account = await apiSignup(request);
    await loginInBrowser(page, account.jwt);
    await gotoApp(page, "/settings");

    await expect(page.getByTestId(T.settings)).toBeVisible({ timeout: 20_000 });
    // An API with no button is a feature nobody has.
    await expect(page.getByTestId(T.settingsSignOutAll), "a way to end a session you cannot reach").toBeVisible();
    await expect(page.getByTestId(T.settingsPushToggle), "a way to stop the notifications").toBeVisible();

    // And the toggle tells the truth: this account has never registered a device.
    await expect(page.getByTestId(T.settingsPushToggle)).toContainText(/off|オフ/i);
  });
});
