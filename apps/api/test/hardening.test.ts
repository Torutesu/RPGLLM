import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API_CSP, SHARE_CSP } from "../src/middleware/security-headers";
import { maxBodyBytes } from "../src/middleware/body-limit";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

/**
 * Two things a browser needs from us, and one thing a stranger should not be able to do (12th pass).
 *
 * The headers mattered least on the JSON API and most on `/s/*`, which is the only HTML this
 * product serves: a page built around a large "Open it" button, with no `frame-ancestors`, that
 * strangers reach from links. The body limit is the other half — zod validates *after* Hono has
 * already buffered whatever arrived.
 */

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});
beforeEach(async () => {
  await resetDatabase();
});

function withEnv(patch: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(patch)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

describe("security headers", () => {
  it("are on an ordinary JSON response", async () => {
    const res = await h.app.request("/v1/health");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("permissions-policy")).toContain("camera=()");
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
  });

  it("are on an error response too — a 401 is a response a browser renders", async () => {
    const res = await h.app.request("/v1/me");
    expect(res.status).toBe(401);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("give the share pages a policy that fits what they actually are", async () => {
    const world = await prisma.world.findFirstOrThrow({ where: { slug: "popstar-era" } });
    await prisma.world.update({ where: { id: world.id }, data: { status: "published", visibility: "public" } });

    const res = await h.app.request("/s/w/popstar-era");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(SHARE_CSP);
    // The page has no script, and saying so is the strongest thing it can say.
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src");
    // Clickjacking: this page is a big "Open it" button that strangers reach from a link.
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("promise HTTPS only where HTTPS is actually in front of us", async () => {
    expect((await h.app.request("/v1/health")).headers.get("strict-transport-security")).toBeNull();
    const restore = withEnv({ NODE_ENV: "production" });
    try {
      const res = await h.app.request("/v1/health");
      expect(res.headers.get("strict-transport-security")).toContain("max-age=31536000");
    } finally {
      restore();
    }
  });
});

describe("the body limit", () => {
  it("refuses a body past the ceiling before anything parses it", async () => {
    const account = await signup(h);
    const huge = "x".repeat(maxBodyBytes() + 1);
    const res = await h.app.request("/v1/posts", {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
      body: JSON.stringify({ text: huge }),
    });
    expect(res.status).toBe(413);
  });

  it("does not believe a content-length that lies", async () => {
    const account = await signup(h);
    const huge = JSON.stringify({ text: "x".repeat(maxBodyBytes() + 1) });
    // A stream with no declared length is the version of this attack that a header check misses.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(huge));
        controller.close();
      },
    });
    const req = new Request("http://local/v1/posts", {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
      body,
      // @ts-expect-error -- `duplex` is required for a streaming body and not in the DOM types here
      duplex: "half",
    });
    const res = await h.app.fetch(req);
    expect(res.status).toBe(413);
  });

  it("lets an ordinary request through untouched", async () => {
    const account = await signup(h);
    // The largest legitimate body in this API is a world premise and its options.
    const res = await call(h, "POST", "/v1/worlds", {
      token: account.token,
      body: { premise: "Seven trainees and one debut slot", genre: "idol", locale: "en", visibility: "private" },
    });
    expect(res.status).not.toBe(413);
  });

  it("leaves the store's signed webhook alone", async () => {
    // It carries its own HMAC and can legitimately be larger; a size rule would only break it.
    const res = await h.app.request("/v1/billing/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(maxBodyBytes() * 4) },
      body: JSON.stringify({ event: { type: "TEST" } }),
    });
    expect(res.status).not.toBe(413);
  });
});

describe("turning push off", () => {
  const device = (n: number): { token: string; platform: "ios" } => ({
    token: `ExponentPushToken[dev-${n}]`,
    platform: "ios",
  });

  it("reports what the toggle should show", async () => {
    const a = await signup(h);
    expect(
      (await call<{ enabled: boolean; devices: number }>(h, "GET", "/v1/push/status", { token: a.token })).data,
    ).toEqual({ enabled: false, devices: 0 });

    await call(h, "POST", "/v1/push/register", { token: a.token, body: device(1) });
    expect(
      (await call<{ enabled: boolean; devices: number }>(h, "GET", "/v1/push/status", { token: a.token })).data,
    ).toEqual({ enabled: true, devices: 1 });
  });

  it("silences this device, and then the account", async () => {
    const a = await signup(h);
    await call(h, "POST", "/v1/push/register", { token: a.token, body: device(1) });
    await call(h, "POST", "/v1/push/register", { token: a.token, body: device(2) });

    const one = await call<{ disabled: number }>(h, "POST", "/v1/push/unregister", {
      token: a.token,
      body: { token: device(1).token },
    });
    expect(one.data.disabled).toBe(1);
    expect((await call<{ devices: number }>(h, "GET", "/v1/push/status", { token: a.token })).data.devices).toBe(1);

    const all = await call<{ disabled: number }>(h, "POST", "/v1/push/unregister", {
      token: a.token,
      body: { allDevices: true },
    });
    expect(all.data.disabled).toBe(1);
    expect((await call<{ enabled: boolean }>(h, "GET", "/v1/push/status", { token: a.token })).data.enabled).toBe(
      false,
    );
  });

  it("keeps the row, so turning it back on is one tap", async () => {
    const a = await signup(h);
    await call(h, "POST", "/v1/push/register", { token: a.token, body: device(1) });
    await call(h, "POST", "/v1/push/unregister", { token: a.token, body: { allDevices: true } });
    expect(await prisma.pushToken.count({ where: { userId: a.userId } }), "not deleted, disabled").toBe(1);

    await call(h, "POST", "/v1/push/register", { token: a.token, body: device(1) });
    expect((await call<{ enabled: boolean }>(h, "GET", "/v1/push/status", { token: a.token })).data.enabled).toBe(true);
  });

  it("cannot silence somebody else's device", async () => {
    const victim = await signup(h);
    const attacker = await signup(h);
    await call(h, "POST", "/v1/push/register", { token: victim.token, body: device(9) });

    // A device token is a string an attacker might hold — a shared phone that changed hands.
    const res = await call<{ disabled: number }>(h, "POST", "/v1/push/unregister", {
      token: attacker.token,
      body: { token: device(9).token },
    });
    expect(res.data.disabled).toBe(0);
    expect((await call<{ enabled: boolean }>(h, "GET", "/v1/push/status", { token: victim.token })).data.enabled).toBe(
      true,
    );
  });
});
