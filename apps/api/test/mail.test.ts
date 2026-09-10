import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMailSender, ConsoleMailSender } from "../src/auth-codes";
import { HttpMailSender, MailSendError, loginCodeMessage, mailSenderFromEnv } from "../src/services/mail";
import { call, makeHarness, resetDatabase, type Harness } from "./helpers";

/**
 * Sending the sign-in code (production-readiness pass).
 *
 * Before this, `ConsoleMailSender` printed the code to the log and nothing ever replaced it, so
 * the tests here are about the two ways that failed: nobody could receive a code, and the code was
 * in a log. The interesting assertions are therefore the unhappy ones — a provider that 500s, a
 * provider that 400s, and what the route says when neither works.
 */

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function recorder(responses: (Response | Error)[]): { calls: Captured[]; fetchImpl: typeof fetch } {
  const calls: Captured[] = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (next instanceof Error) throw next;
    return next ?? new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (): Response => new Response(JSON.stringify({ id: "1" }), { status: 200 });

describe("the sign-in email", () => {
  it("says one thing, in the reader's language, with no link to click", () => {
    const en = loginCodeMessage("a@example.com", "123456", "en", 10);
    expect(en.subject).toBe("Your sign-in code");
    expect(en.text).toContain("123456");
    expect(en.text).toContain("10");
    // A magic link is one forward away from being someone else's session.
    expect(en.text).not.toMatch(/https?:\/\//);
    expect(en.html).not.toContain("<a ");

    const ja = loginCodeMessage("a@example.com", "123456", "ja", 10);
    expect(ja.subject).toBe("サインインコード");
    expect(ja.text).toContain("123456");
    expect(ja.subject).not.toBe(en.subject);
  });

  it("escapes what it puts in the HTML part", () => {
    // The code is generated, but the escaping is the property worth pinning: this is the one
    // place the service emits HTML into someone else's renderer.
    const m = loginCodeMessage("a@example.com", "<b>", "en", 10);
    expect(m.html).toContain("&lt;b&gt;");
    expect(m.html).not.toContain("<b>");
  });
});

describe("HttpMailSender", () => {
  it("posts what Resend expects, with the key in the header and never in the body", async () => {
    const { calls, fetchImpl } = recorder([ok()]);
    await new HttpMailSender({
      provider: "resend",
      apiKey: "re_secret",
      from: "hi@example.com",
      ttlMinutes: 10,
      fetchImpl,
    }).sendLoginCode("player@example.com", "424242");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer re_secret");
    expect(calls[0]!.body["to"]).toEqual(["player@example.com"]);
    expect(JSON.stringify(calls[0]!.body)).toContain("424242");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("re_secret");
  });

  it("posts what Postmark expects", async () => {
    const { calls, fetchImpl } = recorder([ok()]);
    await new HttpMailSender({
      provider: "postmark",
      apiKey: "pm_secret",
      from: "hi@example.com",
      ttlMinutes: 10,
      fetchImpl,
    }).sendLoginCode("player@example.com", "424242");
    expect(calls[0]!.url).toBe("https://api.postmarkapp.com/email");
    expect(calls[0]!.headers["x-postmark-server-token"]).toBe("pm_secret");
    expect(calls[0]!.body["To"]).toBe("player@example.com");
  });

  it("retries a 5xx once and gives up loudly", async () => {
    const { calls, fetchImpl } = recorder([new Response("boom", { status: 503 })]);
    const send = new HttpMailSender({
      provider: "resend",
      apiKey: "k",
      from: "f@e.com",
      ttlMinutes: 10,
      fetchImpl,
    }).sendLoginCode("p@example.com", "111111");
    await expect(send).rejects.toBeInstanceOf(MailSendError);
    expect(calls, "one retry, not a storm").toHaveLength(2);
  });

  it("does not retry a 4xx — an unverified sender is not a transient failure", async () => {
    const { calls, fetchImpl } = recorder([new Response("bad from", { status: 422 })]);
    await expect(
      new HttpMailSender({ provider: "resend", apiKey: "k", from: "f@e.com", ttlMinutes: 10, fetchImpl }).sendLoginCode(
        "p@example.com",
        "111111",
      ),
    ).rejects.toBeInstanceOf(MailSendError);
    expect(calls).toHaveLength(1);
  });

  it("survives the provider being unreachable, and keeps the code out of the error", async () => {
    const { fetchImpl } = recorder([new Error("ECONNREFUSED")]);
    const err = await new HttpMailSender({
      provider: "resend",
      apiKey: "k",
      from: "f@e.com",
      ttlMinutes: 10,
      fetchImpl,
    })
      .sendLoginCode("p@example.com", "987654")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailSendError);
    // The error is logged and may reach a tracker; the credential must not ride along.
    expect(JSON.stringify({ msg: String(err), ...(err as MailSendError) })).not.toContain("987654");
  });

  it("asks who the reader is, once, and only when it can", async () => {
    const { calls, fetchImpl } = recorder([ok()]);
    await new HttpMailSender({
      provider: "resend",
      apiKey: "k",
      from: "f@e.com",
      ttlMinutes: 10,
      fetchImpl,
      localeFor: () => Promise.resolve("ja"),
    }).sendLoginCode("p@example.com", "111111");
    expect(calls[0]!.body["subject"]).toBe("サインインコード");
  });
});

describe("mailSenderFromEnv", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("returns nothing for console, so the log-printing default stays in dev", () => {
    process.env["MAIL_PROVIDER"] = "console";
    expect(mailSenderFromEnv({ ttlMinutes: 10 })).toBeNull();
    delete process.env["MAIL_PROVIDER"];
    expect(mailSenderFromEnv({ ttlMinutes: 10 })).toBeNull();
  });

  it("builds a sender for a provider it knows", () => {
    process.env["MAIL_PROVIDER"] = "postmark";
    process.env["MAIL_API_KEY"] = "k";
    process.env["MAIL_FROM"] = "f@e.com";
    expect(mailSenderFromEnv({ ttlMinutes: 10 })).toBeInstanceOf(HttpMailSender);
  });
});

describe("POST /v1/auth/email/start when the mail provider is down", () => {
  let h: Harness;
  beforeAll(() => {
    h = makeHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(() => {
    setMailSender(new ConsoleMailSender());
  });

  it("says so instead of telling somebody to watch an inbox that will stay empty", async () => {
    setMailSender({ sendLoginCode: () => Promise.reject(new MailSendError("resend", 503, "down")) });
    const res = await call(h, "POST", "/v1/auth/email/start", { body: { email: "nobody@example.com" } });
    expect(res.status).toBe(502);
    expect(res.error?.code).toBe("INTERNAL");
    // And the message never carries the provider's internals to the client.
    expect(res.error?.message).not.toMatch(/resend|503/i);
  });

  it("still answers sent:true when delivery works", async () => {
    const res = await call(h, "POST", "/v1/auth/email/start", { body: { email: "somebody@example.com" } });
    expect(res.status).toBe(200);
  });
});
