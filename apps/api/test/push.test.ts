import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  BATCH,
  PUSH_ENDPOINT,
  PUSH_RECEIPTS_ENDPOINT,
  inQuietHours,
  localTime,
  notifyUser,
  pushForNotification,
  resetPushPolicy,
  sendPush,
  timezoneForLocale,
  tokensForUser,
} from "../src/services/push";
import { call, makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

const ENV_KEYS = [
  "PUSH_ENABLED",
  "PUSH_DAILY_CAP",
  "PUSH_QUIET_START_HOUR",
  "PUSH_QUIET_END_HOUR",
  "PUSH_MIN_GAP_MINUTES",
  "PUSH_AWAY_MINUTES",
  "PUSH_DEFAULT_TZ",
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  h = makeHarness();
});
beforeEach(async () => {
  await resetDatabase();
  resetPushPolicy();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetPushPolicy();
});

/* ------------------------------------------------------------------ helpers ---- */

interface Sent {
  url: string;
  body: unknown;
}

/** A stand-in for the Expo push service that records every call and replies as Expo does. */
function fakeExpo(
  reply: (url: string, body: unknown) => unknown = () => null,
): { fetchImpl: typeof fetch; calls: Sent[] } {
  const calls: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const body: unknown = JSON.parse(String(init?.body ?? "null"));
    calls.push({ url, body });
    const payload = reply(url, body) ?? { data: [] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

const okTickets = (body: unknown, prefix = "t"): { data: { status: string; id: string }[] } => ({
  data: (body as unknown[]).map((_, i) => ({ status: "ok", id: `${prefix}${i}` })),
});

async function addToken(userId: string, token: string): Promise<void> {
  await prisma.pushToken.create({ data: { userId, token, platform: "ios" } });
}

/* ----------------------------------------------------------------- transport ---- */

describe("Expo transport", () => {
  it("is a logged no-op unless PUSH_ENABLED=1", async () => {
    delete process.env.PUSH_ENABLED;
    const expo = fakeExpo();
    const res = await sendPush(["ExponentPushToken[a]"], { title: "t", body: "b" }, { fetchImpl: expo.fetchImpl });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("disabled");
    expect(expo.calls).toHaveLength(0);
  });

  it("chunks at 100 messages per request", async () => {
    process.env.PUSH_ENABLED = "1";
    const tokens = Array.from({ length: 250 }, (_, i) => `ExponentPushToken[${i}]`);
    const expo = fakeExpo((url, body) => (url === PUSH_ENDPOINT ? okTickets(body) : { data: {} }));

    const res = await sendPush(tokens, { title: "t", body: "b" }, { fetchImpl: expo.fetchImpl });

    const sends = expo.calls.filter((c) => c.url === PUSH_ENDPOINT);
    expect(sends).toHaveLength(3);
    expect((sends[0]?.body as unknown[]).length).toBe(BATCH);
    expect((sends[1]?.body as unknown[]).length).toBe(BATCH);
    expect((sends[2]?.body as unknown[]).length).toBe(50);
    expect(res.sent).toBe(250);
  });

  it("prunes a token the ticket reports as DeviceNotRegistered", async () => {
    process.env.PUSH_ENABLED = "1";
    const { userId } = await signup(h);
    await addToken(userId, "ExponentPushToken[alive]");
    await addToken(userId, "ExponentPushToken[gone]");

    const expo = fakeExpo((url, body) => {
      if (url !== PUSH_ENDPOINT) return { data: {} };
      return {
        data: (body as { to: string }[]).map((m) =>
          m.to.includes("gone")
            ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: "ticket-1" },
        ),
      };
    });

    const tokens = await tokensForUser(prisma, userId);
    const res = await sendPush(tokens.map((t) => t.token), { title: "t", body: "b" }, {
      prisma,
      fetchImpl: expo.fetchImpl,
    });

    expect(res.pruned).toBe(1);
    const left = await tokensForUser(prisma, userId);
    expect(left.map((t) => t.token)).toEqual(["ExponentPushToken[alive]"]);
  });

  it("also prunes a token the receipts endpoint reports as gone", async () => {
    process.env.PUSH_ENABLED = "1";
    const { userId } = await signup(h);
    await addToken(userId, "ExponentPushToken[zombie]");

    const expo = fakeExpo((url, body) => {
      if (url === PUSH_ENDPOINT) return okTickets(body, "receipt-");
      return { data: { "receipt-0": { status: "error", details: { error: "DeviceNotRegistered" } } } };
    });

    const res = await sendPush(["ExponentPushToken[zombie]"], { title: "t", body: "b" }, {
      prisma,
      fetchImpl: expo.fetchImpl,
    });

    expect(expo.calls.some((c) => c.url === PUSH_RECEIPTS_ENDPOINT)).toBe(true);
    expect(res.pruned).toBe(1);
    expect(await prisma.pushToken.count({ where: { userId } })).toBe(0);
  });

  it("survives a transport failure without throwing", async () => {
    process.env.PUSH_ENABLED = "1";
    const failing: typeof fetch = async () => {
      throw new Error("socket hang up");
    };
    const res = await sendPush(["ExponentPushToken[a]"], { title: "t", body: "b" }, { fetchImpl: failing });
    expect(res.sent).toBe(0);
    expect(res.error).toBe("socket hang up");
  });
});

/* -------------------------------------------------------------------- policy ---- */

describe("send policy", () => {
  it("infers the timezone from the locale and finds the local hour", () => {
    expect(timezoneForLocale("ja")).toBe("Asia/Tokyo");
    expect(timezoneForLocale("en")).toBe("UTC");
    // 2026-09-04T15:00Z is 2026-09-05 00:00 in Tokyo
    const jst = localTime(new Date("2026-09-04T15:00:00.000Z"), "Asia/Tokyo");
    expect(jst.hour).toBe(0);
    expect(jst.day).toBe("2026-09-05");
  });

  it("quiet hours wrap midnight", () => {
    expect(inQuietHours(23)).toBe(true);
    expect(inQuietHours(2)).toBe(true);
    expect(inQuietHours(7)).toBe(true);
    expect(inQuietHours(8)).toBe(false);
    expect(inQuietHours(12)).toBe(false);
  });

  it("suppresses a send inside the user's quiet hours", async () => {
    process.env.PUSH_ENABLED = "1";
    const { userId } = await signup(h, { locale: "ja" });
    await addToken(userId, "ExponentPushToken[jp]");
    const expo = fakeExpo((url, body) => (url === PUSH_ENDPOINT ? okTickets(body) : { data: {} }));

    // 16:00Z = 01:00 in Tokyo — the middle of the night for this user
    const night = await notifyUser(prisma, userId, { title: "t", body: "b" }, {
      now: new Date("2026-09-04T16:00:00.000Z"),
      fetchImpl: expo.fetchImpl,
    });
    expect(night.reason).toBe("quiet_hours");
    expect(expo.calls).toHaveLength(0);

    // 04:00Z = 13:00 in Tokyo — fine
    const day = await notifyUser(prisma, userId, { title: "t", body: "b" }, {
      now: new Date("2026-09-04T04:00:00.000Z"),
      fetchImpl: expo.fetchImpl,
    });
    expect(day.sent).toBe(1);
  });

  it("stops at the per-user daily cap and starts again the next local day", async () => {
    process.env.PUSH_ENABLED = "1";
    process.env.PUSH_DAILY_CAP = "2";
    const { userId } = await signup(h);
    await addToken(userId, "ExponentPushToken[cap]");
    const expo = fakeExpo((url, body) => (url === PUSH_ENDPOINT ? okTickets(body) : { data: {} }));

    const at = (iso: string) => notifyUser(prisma, userId, { title: "t", body: "b" }, { now: new Date(iso), fetchImpl: expo.fetchImpl });

    expect((await at("2026-09-04T10:00:00Z")).sent).toBe(1);
    expect((await at("2026-09-04T12:00:00Z")).sent).toBe(1);
    const third = await at("2026-09-04T14:00:00Z");
    expect(third.sent).toBe(0);
    expect(third.reason).toBe("daily_cap");
    expect(expo.calls.filter((c) => c.url === PUSH_ENDPOINT)).toHaveLength(2);

    expect((await at("2026-09-05T10:00:00Z")).sent).toBe(1);
  });

  it("does nothing for a user with no registered device", async () => {
    process.env.PUSH_ENABLED = "1";
    const { userId } = await signup(h);
    const res = await notifyUser(prisma, userId, { title: "t", body: "b" }, { now: new Date("2026-09-04T10:00:00Z") });
    expect(res.reason).toBe("no_tokens");
  });
});

/* ------------------------------------------------------- notification bridge ---- */

describe("pushForNotification", () => {
  it("only wakes a phone for the kinds worth waking it for", async () => {
    process.env.PUSH_ENABLED = "1";
    const fx = await signupWithPersona(h);
    await addToken(fx.userId, "ExponentPushToken[bridge]");
    const expo = fakeExpo((url, body) => (url === PUSH_ENDPOINT ? okTickets(body) : { data: {} }));
    const now = new Date("2026-09-04T10:00:00Z");

    const like = await pushForNotification(
      prisma,
      { personaId: fx.personaId, kind: "like", text: "x liked your post", target: "post:1" },
      { now, fetchImpl: expo.fetchImpl },
    );
    expect(like.reason).toBe("kind_not_pushable");

    const dm = await pushForNotification(
      prisma,
      { personaId: fx.personaId, kind: "dm", text: "bea sent you a DM", target: "dm:t1" },
      { now, fetchImpl: expo.fetchImpl },
    );
    expect(dm.sent).toBe(1);
    const sent = expo.calls.find((c) => c.url === PUSH_ENDPOINT)?.body as { data?: unknown }[];
    expect(sent?.[0]).toMatchObject({ data: { target: "dm:t1" } });
  });

  it("stays quiet while the user is still in the app", async () => {
    process.env.PUSH_ENABLED = "1";
    const fx = await signupWithPersona(h);
    await addToken(fx.userId, "ExponentPushToken[present]");
    // the user just posted: a push about the reaction to it would buzz the phone in their hand
    await call(h, "POST", "/v1/posts", { token: fx.token, body: { personaId: fx.personaId, text: "hello world" } });

    const res = await pushForNotification(
      prisma,
      { personaId: fx.personaId, kind: "event", text: "something happened", target: "event:1" },
      { now: new Date() },
    );
    expect(res.reason).toBe("user_present");
  });

  it("is a hard no-op while push is disabled, and never touches the database", async () => {
    delete process.env.PUSH_ENABLED;
    const res = await pushForNotification(
      prisma,
      { personaId: "does-not-exist", kind: "dm", text: "x", target: null },
      {},
    );
    expect(res).toMatchObject({ sent: 0, skipped: true, reason: "disabled" });
  });
});

/* ------------------------------------------------------------- registration ---- */

describe("POST /v1/push/register", () => {
  it("stores the token and moves it between accounts on a shared device", async () => {
    const a = await signup(h);
    const b = await signup(h);
    const token = "ExponentPushToken[shared-device]";

    expect((await call(h, "POST", "/v1/push/register", { token: a.token, body: { token, platform: "ios" } })).status).toBe(200);
    expect((await tokensForUser(prisma, a.userId)).map((t) => t.token)).toEqual([token]);

    await call(h, "POST", "/v1/push/register", { token: b.token, body: { token, platform: "ios" } });
    expect(await tokensForUser(prisma, a.userId)).toHaveLength(0);
    expect((await tokensForUser(prisma, b.userId)).map((t) => t.token)).toEqual([token]);
  });

  it("rejects an unauthenticated registration", async () => {
    const res = await call(h, "POST", "/v1/push/register", { body: { token: "ExponentPushToken[x]", platform: "ios" } });
    expect(res.status).toBe(401);
  });
});
