import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setMailSender, type MailSender } from "../src/auth-codes";
import { consumeLoginCode, issueLoginCode, purgeLoginCodes } from "../src/services/login-codes";
import { call, makeHarness, prisma, resetDatabase, type Harness } from "./helpers";

let h: Harness;
/** The codes the API "sent", captured instead of printed. */
const sent = new Map<string, string>();

const captureSender: MailSender = {
  sendLoginCode: (email: string, code: string): Promise<void> => {
    sent.set(email, code);
    return Promise.resolve();
  },
};

beforeAll(() => {
  h = makeHarness();
  setMailSender(captureSender);
});
afterAll(() => {
  // Put the console sender back for anything that runs after this file in the same process.
  setMailSender({ sendLoginCode: () => Promise.resolve() });
});
beforeEach(async () => {
  await resetDatabase();
  h.clock.reset();
  sent.clear();
  await prisma.loginCode.deleteMany({});
});

let seq = 0;
const freshEmail = (): string => `codes${++seq}.${Date.now()}@example.com`;

const start = (email: string) => call<{ sent: boolean }>(h, "POST", "/v1/auth/email/start", { body: { email } });
const verify = (email: string, code: string) =>
  call<{ jwt: string; isNew: boolean }>(h, "POST", "/v1/auth/email/verify", { body: { email, code } });

const issued = async (email: string): Promise<string> => {
  const res = await start(email);
  expect(res.status).toBe(200);
  const code = sent.get(email);
  expect(code, "the mail sender received a code").toBeDefined();
  return code!;
};

describe("one-time login codes (persisted)", () => {
  it("signs in with the issued code and stores only a salted hash", async () => {
    const email = freshEmail();
    const code = await issued(email);
    expect(code).toMatch(/^\d{6}$/);

    const rows = await prisma.loginCode.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.codeHash).not.toContain(code);
    expect(rows[0]?.codeHash).toHaveLength(64);
    expect(rows[0]?.salt).not.toBe("");

    const res = await verify(email, code);
    expect(res.status).toBe(200);
    expect(res.data.jwt).toBeTruthy();
  });

  it("rejects a wrong code, and the right one still works afterwards", async () => {
    const email = freshEmail();
    const code = await issued(email);
    const wrong = await verify(email, code === "111111" ? "222222" : "111111");
    expect(wrong.status).toBe(401);
    expect((await prisma.loginCode.findFirstOrThrow({ where: { email } })).attempts).toBe(1);
    expect((await verify(email, code)).status).toBe(200);
  });

  it("rejects a code that has expired", async () => {
    const email = freshEmail();
    const code = await issued(email);
    h.clock.offsetDays(11 / (24 * 60)); // 11 minutes: the TTL is 10
    const res = await verify(email, code);
    expect(res.status).toBe(401);
    expect(res.error?.message).toMatch(/expired/i);
  });

  it("is single use: the same code cannot be replayed", async () => {
    const email = freshEmail();
    const code = await issued(email);
    expect((await verify(email, code)).status).toBe(200);
    const replay = await verify(email, code);
    expect(replay.status).toBe(401);
  });

  it("stops at five attempts — the sixth is refused even with the right code", async () => {
    const email = freshEmail();
    const code = await issued(email);
    for (let i = 0; i < 5; i += 1) {
      const res = await verify(email, "000001");
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    const sixth = await verify(email, code);
    expect(sixth.status).toBe(401);
    expect(sixth.error?.message).toMatch(/too many|expired|invalid/i);
  });

  it("invalidates the previous code when a new one is issued", async () => {
    const email = freshEmail();
    const first = await issued(email);
    const second = await issued(email);
    expect(second).not.toBe(first);

    const stale = await verify(email, first);
    expect(stale.status).toBe(401);
    expect((await verify(email, second)).status).toBe(200);
  });

  it("works across API instances — the code lives in the database, not in a process", async () => {
    const email = freshEmail();
    const code = await issued(email);
    // A second app object is a second API instance as far as the login flow is concerned.
    const other = makeHarness();
    const res = await call<{ jwt: string }>(other, "POST", "/v1/auth/email/verify", { body: { email, code } });
    expect(res.status).toBe(200);
    expect(res.data.jwt).toBeTruthy();
  });

  it("still accepts the constant dev code while AUTH_DEV_CODE/TEST_HOOKS is on", async () => {
    const res = await verify(freshEmail(), "000000");
    expect(res.status).toBe(200);
  });
});

describe("the login-code service, directly", () => {
  const now = new Date("2026-09-04T10:00:00.000Z");
  const TTL = 10 * 60 * 1000;

  it("reports each failure mode distinctly", async () => {
    const email = freshEmail();
    expect(await consumeLoginCode(prisma, email, "123456", now, 5)).toBe("no_code");

    const code = await issueLoginCode(prisma, email, now, TTL);
    expect(await consumeLoginCode(prisma, email, "999999", now, 5)).toBe("mismatch");
    expect(await consumeLoginCode(prisma, email, code, new Date(now.getTime() + TTL + 1), 5)).toBe("expired");

    const again = await issueLoginCode(prisma, email, now, TTL);
    for (let i = 0; i < 4; i += 1) expect(await consumeLoginCode(prisma, email, "999999", now, 5)).toBe("mismatch");
    expect(await consumeLoginCode(prisma, email, "999999", now, 5)).toBe("too_many_attempts");
    expect(await consumeLoginCode(prisma, email, again, now, 5)).toBe("too_many_attempts");
  });

  it("normalises the address, so case and spacing cannot fork the code", async () => {
    const email = freshEmail();
    const code = await issueLoginCode(prisma, ` ${email.toUpperCase()} `, now, TTL);
    expect(await consumeLoginCode(prisma, email, code, now, 5)).toBe("ok");
  });

  it("purges expired and consumed rows, and keeps live ones", async () => {
    const dead = freshEmail();
    const live = freshEmail();
    const used = freshEmail();
    await issueLoginCode(prisma, dead, new Date(now.getTime() - 2 * TTL), TTL);
    await issueLoginCode(prisma, live, now, TTL);
    const usedCode = await issueLoginCode(prisma, used, now, TTL);
    expect(await consumeLoginCode(prisma, used, usedCode, now, 5)).toBe("ok");

    const deleted = await purgeLoginCodes(prisma, now);
    expect(deleted).toBe(2);
    const left = await prisma.loginCode.findMany({});
    expect(left).toHaveLength(1);
    expect(left[0]?.email).toBe(live);
  });
});
