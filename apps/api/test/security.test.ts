/**
 * Agent F — security & ops regression suite.
 *
 * Covers the S0 findings: one-time login codes (S0-1), the production config guard (S0-2),
 * rate limiting (S0-4), the CORS allow-list (S0-5), forgeable ad rewards (S0-6) and the
 * narrowed `?token=` query auth (S0-7).
 */
import { generateKeyPairSync, createSign } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEV_EMAIL_CODE, TEST_AD_TOKEN } from "@rpgllm/shared";
import { consumeCode, issueCode, setMailSender, type EmailCodeStore, type MailSender } from "../src/auth-codes";
import { productionConfigProblems, assertProductionConfig } from "../src/config-guard";
import { budgetFor, take, type RateLimitStore } from "../src/middleware/rate-limit";
import {
  GoogleVerifierKeys,
  setAdMobVerifierKeys,
  StaticVerifierKeys,
  verifyAdMobSSV,
} from "../src/services/ad-verify";
import { call, makeHarness, resetDatabase, signup, type Harness } from "./helpers";

let h: Harness;

/** Records the codes the API "mails" so the test can use a real one. */
class RecordingMailSender implements MailSender {
  readonly sent: { email: string; code: string }[] = [];
  sendLoginCode(email: string, code: string): Promise<void> {
    this.sent.push({ email, code });
    return Promise.resolve();
  }
}
const mail = new RecordingMailSender();

/** Restores every env key a test touched. */
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

let restore: (() => void) | null = null;

beforeAll(() => {
  h = makeHarness();
  setMailSender(mail);
});
beforeEach(async () => {
  mail.sent.length = 0;
  h.clock.reset();
  await resetDatabase();
});
afterEach(() => {
  restore?.();
  restore = null;
  h.clock.reset();
});

const MINUTE_IN_DAYS = 1 / (24 * 60);

/* ------------------------------------------------- S0-1 one-time login codes ---- */

describe("S0-1 one-time email codes", () => {
  it("issues a code, accepts it once, and never stores the plaintext", async () => {
    restore = withEnv({ AUTH_DEV_CODE: "0", TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0" });
    const email = "otc1@example.com";
    const start = await call(h, "POST", "/v1/auth/email/start", { body: { email } });
    expect(start.status).toBe(200);
    expect(mail.sent).toHaveLength(1);
    const code = mail.sent[0]!.code;
    expect(code).toMatch(/^\d{6}$/);

    const wrong = await call(h, "POST", "/v1/auth/email/verify", { body: { email, code: "111111" } });
    expect(wrong.status).toBe(401);

    const good = await call<{ jwt: string }>(h, "POST", "/v1/auth/email/verify", { body: { email, code } });
    expect(good.status).toBe(200);
    expect(good.data.jwt.length).toBeGreaterThan(20);

    // single use
    const replay = await call(h, "POST", "/v1/auth/email/verify", { body: { email, code } });
    expect(replay.status).toBe(401);
  });

  it("expires a code after the TTL", async () => {
    restore = withEnv({ AUTH_DEV_CODE: "0", TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0" });
    const email = "otc2@example.com";
    await call(h, "POST", "/v1/auth/email/start", { body: { email } });
    const code = mail.sent[0]!.code;
    h.clock.offsetDays(11 * MINUTE_IN_DAYS); // TTL is 10 minutes

    const res = await call(h, "POST", "/v1/auth/email/verify", { body: { email, code } });
    expect(res.status).toBe(401);
    expect(res.error?.message).toMatch(/expired/i);
  });

  it("burns the code after 5 wrong attempts", async () => {
    restore = withEnv({ AUTH_DEV_CODE: "0", TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0" });
    const email = "otc3@example.com";
    await call(h, "POST", "/v1/auth/email/start", { body: { email } });
    const code = mail.sent[0]!.code;
    for (let i = 0; i < 5; i += 1) {
      const bad = await call(h, "POST", "/v1/auth/email/verify", { body: { email, code: "000001" } });
      expect(bad.status).toBe(401);
    }
    const good = await call(h, "POST", "/v1/auth/email/verify", { body: { email, code } });
    expect(good.status).toBe(401);
  });

  it("rejects the constant dev code unless AUTH_DEV_CODE=1", async () => {
    restore = withEnv({ AUTH_DEV_CODE: "0", TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0" });
    const denied = await call(h, "POST", "/v1/auth/email/verify", {
      body: { email: "devcode@example.com", code: DEV_EMAIL_CODE },
    });
    expect(denied.status).toBe(401);

    restore();
    restore = null;
    const allowed = await call<{ jwt: string }>(h, "POST", "/v1/auth/email/verify", {
      body: { email: "devcode@example.com", code: DEV_EMAIL_CODE },
    });
    expect(allowed.status).toBe(200); // TEST_HOOKS=1 in vitest ⇒ dev code on
  });

  it("stores only a salted hash and enforces attempts at the store level", () => {
    const store: EmailCodeStore = new Map();
    const code = issueCode(store, "Store@Example.com ", 1_000, 60_000);
    const rec = store.get("store@example.com");
    expect(rec).toBeDefined();
    expect(JSON.stringify(rec)).not.toContain(code);
    expect(rec!.hash).toHaveLength(64);

    expect(consumeCode(store, "store@example.com", "999999", 1_000, 5)).toBe("mismatch");
    expect(consumeCode(store, "store@example.com", code, 1_000, 5)).toBe("ok");
    expect(consumeCode(store, "store@example.com", code, 1_000, 5)).toBe("no_code");
  });
});

/* ------------------------------------------------------- S0-2 config guard ---- */

describe("S0-2 production config guard", () => {
  /**
   * A deployment that would actually be safe to boot. It grew in the production-readiness pass:
   * the four original settings were never enough to *run* the product, only enough to stop it
   * being trivially exploitable — a service with all four right could still serve fixtures to
   * paying users, mail nobody a login code and give no reviewer a way in.
   */
  const prod = {
    NODE_ENV: "production",
    JWT_SECRET: "x".repeat(48),
    BILLING_MODE: "revenuecat",
    ADS_MODE: "admob",
    LLM_MODE: "live",
    ANTHROPIC_API_KEY: "sk-ant-xxx",
    CORS_ORIGINS: "https://app.example.com",
    ADMIN_TOKEN: "y".repeat(32),
    PUBLIC_APP_URL: "https://app.example.com",
    REVENUECAT_WEBHOOK_SECRET: "z".repeat(32),
    MAIL_PROVIDER: "resend",
    MAIL_API_KEY: "re_xxx",
    MAIL_FROM: "hello@example.com",
    LLM_DAILY_BUDGET_USD: "250",
    RATE_LIMIT_STORE: "shared",
  };

  it("accepts a hardened production env", () => {
    expect(productionConfigProblems(prod)).toEqual([]);
    expect(() => {
      assertProductionConfig(prod);
    }).not.toThrow();
  });

  it("ignores non-production environments", () => {
    expect(productionConfigProblems({ NODE_ENV: "development", TEST_HOOKS: "1", JWT_SECRET: "" })).toEqual([]);
  });

  it("refuses every insecure production setting", () => {
    const cases: [Record<string, string | undefined>, RegExp][] = [
      [{ JWT_SECRET: undefined }, /JWT_SECRET is not set/],
      [{ JWT_SECRET: "dev-secret-change-me" }, /development default/],
      [{ JWT_SECRET: "short" }, /shorter than 32/],
      [{ AUTH_DEV_CODE: "1" }, /AUTH_DEV_CODE/],
      [{ TEST_HOOKS: "1" }, /TEST_HOOKS/],
      [{ BILLING_MODE: "test" }, /BILLING_MODE/],
      [{ ADS_MODE: "test" }, /ADS_MODE/],
      [{ BILLING_MODE: undefined }, /BILLING_MODE is not set/],
      [{ ADS_MODE: undefined }, /ADS_MODE is not set/],
      // Broken rather than exploitable, and every one of them boots silently without this guard.
      [{ LLM_MODE: "replay" }, /canned fixtures/],
      [{ LLM_MODE: undefined }, /canned fixtures/],
      [{ ANTHROPIC_API_KEY: undefined }, /without ANTHROPIC_API_KEY/],
      [{ CORS_ORIGINS: "https://app.example.com,*" }, /CORS_ORIGINS contains \*/],
      [{ CORS_ORIGINS: undefined }, /CORS_ORIGINS is not set/],
      [{ ADMIN_TOKEN: undefined }, /no reviewer can reach the moderation queue/],
      [{ PUBLIC_APP_URL: undefined }, /placeholder host/],
      [{ REVENUECAT_WEBHOOK_SECRET: undefined }, /forged webhook/],
      [{ MAIL_PROVIDER: undefined }, /nobody can sign in/],
      [{ MAIL_PROVIDER: "console" }, /nobody can sign in/],
      [{ MAIL_PROVIDER: "sendmail" }, /not a provider this build can talk to/],
      [{ MAIL_API_KEY: undefined }, /MAIL_API_KEY is not set/],
      [{ MAIL_FROM: undefined }, /MAIL_FROM is not set/],
      [{ LLM_DAILY_BUDGET_USD: undefined }, /LLM_DAILY_BUDGET_USD is not set/],
      [{ LLM_DAILY_BUDGET_USD: "0" }, /neither a positive number nor/],
      [{ LLM_DAILY_BUDGET_USD: "lots" }, /neither a positive number nor/],
      [{ RATE_LIMIT_STORE: undefined }, /RATE_LIMIT_STORE is not set/],
      [{ RATE_LIMIT_STORE: "redis" }, /neither "memory" nor "shared"/],
    ];
    for (const [patch, matcher] of cases) {
      const env = { ...prod, ...patch };
      expect(productionConfigProblems(env).join("\n"), JSON.stringify(patch)).toMatch(matcher);
      expect(() => {
        assertProductionConfig(env);
      }, JSON.stringify(patch)).toThrow(/insecure configuration/);
    }
  });

  /** One instance is a legitimate deployment; not having thought about it is not. */
  it("accepts an explicitly single-instance limiter", () => {
    expect(productionConfigProblems({ ...prod, RATE_LIMIT_STORE: "memory" })).toEqual([]);
  });

  /** Saying "no ceiling" out loud is allowed; leaving the question unanswered is not. */
  it("accepts an explicitly unlimited budget", () => {
    expect(productionConfigProblems({ ...prod, LLM_DAILY_BUDGET_USD: "unlimited" })).toEqual([]);
  });

  /** `ADMIN_TOKENS` (per-reviewer secrets) satisfies the same requirement as the shared one. */
  it("accepts per-reviewer admin tokens in place of the shared one", () => {
    const { ADMIN_TOKEN: _drop, ...rest } = prod;
    expect(productionConfigProblems({ ...rest, ADMIN_TOKENS: `rina:${"y".repeat(32)}` })).toEqual([]);
  });

  it("also treats APP_ENV=production as production", () => {
    expect(
      productionConfigProblems({ APP_ENV: "production", JWT_SECRET: "dev-secret-change-me" }).length,
    ).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------- S0-4 rate limiting ---- */

describe("S0-4 rate limiting", () => {
  it("classifies routes into the documented budgets", () => {
    // The store webhook carries its own HMAC and is idempotent; throttling it would only feed
    // RevenueCat's retry queue.
    expect(budgetFor("POST", "/v1/billing/webhook")).toBe("exempt");
    expect(budgetFor("POST", "/v1/auth/email/start")).toBe("auth");
    expect(budgetFor("POST", "/v1/auth/email/verify")).toBe("auth");
    expect(budgetFor("POST", "/v1/auth/age-gate")).toBe("default");
    expect(budgetFor("POST", "/v1/posts")).toBe("write");
    expect(budgetFor("POST", "/v1/posts/abc/more-replies")).toBe("write");
    expect(budgetFor("POST", "/v1/dms/abc/messages")).toBe("write");
    expect(budgetFor("POST", "/v1/wallet/ad-reward")).toBe("ad");
    expect(budgetFor("GET", "/v1/feed")).toBe("default");
    expect(budgetFor("POST", "/v1/__test/reset")).toBe("exempt");
    expect(budgetFor("GET", "/v1/health")).toBe("exempt");
  });

  it("token bucket refills over time", () => {
    const store: RateLimitStore = new Map();
    for (let i = 0; i < 3; i += 1) expect(take(store, "k", 3, 0).allowed).toBe(true);
    const blocked = take(store, "k", 3, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(take(store, "k", 3, 60_000).allowed).toBe(true);
  });

  it("answers 429 RATE_LIMITED with Retry-After, then recovers", async () => {
    const rl = makeHarness();
    restore = withEnv({ RATE_LIMIT_ENABLED: "1", RATE_LIMIT_DEFAULT_PER_MIN: "3" });

    for (let i = 0; i < 3; i += 1) {
      const res = await rl.app.request("/v1/me");
      expect(res.status).toBe(401); // limiter runs before auth; the budget is what we assert
    }
    const limited = await rl.app.request("/v1/me");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    const body = (await limited.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.requestId).toBeTruthy(); // request id is injected into every error body

    rl.clock.offsetDays(MINUTE_IN_DAYS); // buckets refill on the injected clock
    expect((await rl.app.request("/v1/me")).status).toBe(401);
  });

  it("never rate-limits the test hooks", async () => {
    const rl = makeHarness();
    restore = withEnv({ RATE_LIMIT_ENABLED: "1", RATE_LIMIT_DEFAULT_PER_MIN: "1" });
    for (let i = 0; i < 4; i += 1) {
      const res = await rl.app.request("/v1/__test/reset", { method: "POST" });
      expect(res.status).toBe(200);
    }
  });
});

/* ------------------------------------------------------------- S0-5 CORS ---- */

describe("S0-5 CORS allow-list", () => {
  it("answers only allow-listed origins when TEST_HOOKS is off", async () => {
    const cors = makeHarness();
    restore = withEnv({ TEST_HOOKS: "0", RATE_LIMIT_ENABLED: "0", CORS_ORIGINS: "http://localhost:8082" });

    const allowed = await cors.app.request("/v1/health", { headers: { origin: "http://localhost:8082" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:8082");

    const denied = await cors.app.request("/v1/health", { headers: { origin: "https://evil.example" } });
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("keeps the wildcard while TEST_HOOKS=1 (E2E harness)", async () => {
    const res = await h.app.request("/v1/health", { headers: { origin: "http://localhost:9999" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:9999");
  });
});

/* ------------------------------------------------------- S0-6 ad rewards ---- */

describe("S0-6 ad reward verification", () => {
  it("rejects the constant TEST_AD_TOKEN when ADS_MODE is not test", async () => {
    const account = await signup(h);
    restore = withEnv({ ADS_MODE: "admob" });
    const res = await call(h, "POST", "/v1/wallet/ad-reward", {
      token: account.token,
      body: { adToken: TEST_AD_TOKEN },
    });
    expect(res.status).toBe(400);
    expect(res.error?.message).toMatch(/could not be verified/i);
  });

  it("still grants the reward in ADS_MODE=test", async () => {
    const account = await signup(h);
    const res = await call<{ energy: number }>(h, "POST", "/v1/wallet/ad-reward", {
      token: account.token,
      body: { adToken: TEST_AD_TOKEN },
    });
    expect(res.status).toBe(200);
  });

  it("verifies a real SSV signature and refuses an unknown key id", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const now = Date.now();
    const signed = `ad_network=5450213213286189855&reward_amount=1&reward_item=energy&timestamp=${now}&transaction_id=tx1&user_id=u1&key_id=1`;
    const sig = createSign("SHA256").update(signed, "utf8").sign(privateKey).toString("base64url");
    const callback = `https://api.example.com/ssv?${signed}&signature=${sig}`;

    expect((await verifyAdMobSSV(callback, { nowMs: now })).reason).toBe("unknown_key_id");

    setAdMobVerifierKeys(new StaticVerifierKeys({ "1": publicKey.export({ type: "spki", format: "pem" }).toString() }));
    try {
      const good = await verifyAdMobSSV(callback, { expectedUserId: "u1", nowMs: now });
      expect(good.ok).toBe(true);
      expect(good.transactionId).toBe("tx1");

      expect((await verifyAdMobSSV(callback, { expectedUserId: "someone-else", nowMs: now })).reason).toBe(
        "user_mismatch",
      );
      expect((await verifyAdMobSSV(callback, { nowMs: now + 10 * 60 * 1000 })).reason).toBe("stale_callback");
      const tampered = callback.replace("reward_amount=1", "reward_amount=9");
      expect((await verifyAdMobSSV(tampered, { nowMs: now })).ok).toBe(false);
      expect((await verifyAdMobSSV("https://api.example.com/ssv?no_signature=1", { nowMs: now })).reason).toBe(
        "no_signature",
      );
    } finally {
      setAdMobVerifierKeys(
        new (class {
          get() {
            return Promise.resolve(null);
          }
        })(),
      );
    }
  });

  /**
   * The replay hole. A signature proves a callback was genuine *once*; nothing in it says this is
   * not the fourth time we have seen it. Before `AdRedemption`, one captured callback from your
   * own device minted energy to the daily cap, every day, forever.
   */
  it("grants a verified callback once and refuses the replay", async () => {
    const account = await signup(h);
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const now = Date.now();
    const signed =
      `ad_network=1&reward_amount=1&reward_item=energy&timestamp=${now}` +
      `&transaction_id=tx-replay&user_id=${account.userId}&key_id=1`;
    const sig = createSign("SHA256").update(signed, "utf8").sign(privateKey).toString("base64url");
    const callback = `https://api.example.com/ssv?${signed}&signature=${sig}`;

    restore = withEnv({ ADS_MODE: "admob" });
    setAdMobVerifierKeys(new StaticVerifierKeys({ "1": publicKey.export({ type: "spki", format: "pem" }).toString() }));
    try {
      const first = await call<{ energy: number }>(h, "POST", "/v1/wallet/ad-reward", {
        token: account.token,
        body: { adToken: callback },
      });
      expect(first.status, "the genuine callback pays out").toBe(200);

      const second = await call(h, "POST", "/v1/wallet/ad-reward", {
        token: account.token,
        body: { adToken: callback },
      });
      expect(second.status, "and the identical one does not").toBe(409);
      expect(second.error?.code).toBe("ALREADY_DONE");

      // The rollback matters as much as the refusal: no energy, and no phantom ad against the cap.
      const wallet = await call<{ energy: number; adRewardsToday: number }>(h, "GET", "/v1/wallet", {
        token: account.token,
      });
      expect(wallet.data.adRewardsToday, "a refused replay is not an ad watched").toBe(1);
    } finally {
      setAdMobVerifierKeys(
        new (class {
          get() {
            return Promise.resolve(null);
          }
        })(),
      );
    }
  });

  /** A callback that cannot be deduplicated is refused rather than granted once and hoped about. */
  it("refuses a verified callback that carries no transaction id", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const now = Date.now();
    const signed = `ad_network=1&reward_amount=1&reward_item=energy&timestamp=${now}&user_id=u1&key_id=1`;
    const sig = createSign("SHA256").update(signed, "utf8").sign(privateKey).toString("base64url");
    setAdMobVerifierKeys(new StaticVerifierKeys({ "1": publicKey.export({ type: "spki", format: "pem" }).toString() }));
    try {
      const verdict = await verifyAdMobSSV(`https://x/ssv?${signed}&signature=${sig}`, {
        expectedUserId: "u1",
        nowMs: now,
      });
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe("no_transaction_id");
    } finally {
      setAdMobVerifierKeys(
        new (class {
          get() {
            return Promise.resolve(null);
          }
        })(),
      );
    }
  });

  /**
   * The key set. Fetched on a miss rather than on a timer, because a rotation is only ever visible
   * as a `key_id` we do not have — and rate-limited, so an unknown id cannot be turned into an
   * outbound request amplifier.
   */
  describe("the published verifier key set", () => {
    const keyBody = (): { keys: { keyId: string; pem: string }[] } => {
      const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      return { keys: [{ keyId: "77", pem: publicKey.export({ type: "spki", format: "pem" }).toString() }] };
    };

    it("fetches on a miss, caches the hit, and does not refetch inside the floor", async () => {
      let fetches = 0;
      let now = 1_000_000;
      const fetchImpl = (async () => {
        fetches += 1;
        return new Response(JSON.stringify(keyBody()), { status: 200 });
      }) as unknown as typeof fetch;
      const keys = new GoogleVerifierKeys({ fetchImpl, minRefreshMs: 60_000, nowMs: () => now });

      expect(await keys.get("77")).not.toBeNull();
      expect(fetches).toBe(1);
      expect(await keys.get("77"), "a hit never touches the network").not.toBeNull();
      expect(fetches).toBe(1);

      // An unknown id inside the floor must not become a request per attempt.
      expect(await keys.get("nope")).toBeNull();
      expect(await keys.get("nope")).toBeNull();
      expect(fetches, "the refresh floor holds").toBe(1);

      now += 61_000;
      expect(await keys.get("nope")).toBeNull();
      expect(fetches, "and lifts").toBe(2);
    });

    it("keeps the last good copy when the fetch fails", async () => {
      let now = 1_000_000;
      let fail = false;
      const fetchImpl = (async () => {
        if (fail) throw new Error("gstatic is down");
        return new Response(JSON.stringify(keyBody()), { status: 200 });
      }) as unknown as typeof fetch;
      const keys = new GoogleVerifierKeys({ fetchImpl, minRefreshMs: 1, nowMs: () => now });

      expect(await keys.get("77")).not.toBeNull();
      fail = true;
      now += 10_000;
      // A blip at Google must not stop every ad reward in the product.
      expect(await keys.get("77"), "the cached key still verifies").not.toBeNull();
    });
  });
});

/* --------------------------------------------------- S0-7 ?token= narrowing ---- */

describe("S0-7 query-string token", () => {
  it("is accepted on an SSE stream route", async () => {
    const account = await signup(h);
    const res = await h.app.request(`/v1/posts/does-not-exist/stream?token=${account.token}`);
    expect(res.status).not.toBe(401); // auth passed; the post simply does not exist
    expect(res.status).toBe(404);
  });

  it("is refused on a mutating route", async () => {
    const account = await signup(h);
    const res = await h.app.request(`/v1/posts?token=${account.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello world", idempotencyKey: "qs-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("still refuses a bogus token on the stream route", async () => {
    const res = await h.app.request("/v1/posts/does-not-exist/stream?token=not-a-jwt");
    expect(res.status).toBe(401);
  });
});

/* --------------------------------------------------------------- ops ---- */

describe("ops", () => {
  it("echoes an inbound request id and reports db health", async () => {
    const res = await h.app.request("/v1/health", { headers: { "x-request-id": "req-abc-123" } });
    expect(res.headers.get("x-request-id")).toBe("req-abc-123");
    const body = (await res.json()) as { data: { ok: boolean; db: string; llmMode: string } };
    expect(body.data.db).toBe("ok");
    expect(body.data.ok).toBe(true);
    expect(body.data.llmMode).toBe("replay");
  });

  it("generates a request id and puts it in the error body", async () => {
    const res = await h.app.request("/v1/me");
    expect(res.status).toBe(401);
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    const body = (await res.json()) as { error: { code: string; requestId?: string } };
    expect(body.error.requestId).toBe(id);
  });
});
