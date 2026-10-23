import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signSession } from "../src/auth";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

/**
 * Taking a session back (12th pass).
 *
 * A session JWT lasts 30 days and `verifySession` checked only the signature, so a token that
 * leaked could not be revoked by the user or by us: the client's "Sign out" dropped its own copy
 * and the stolen one kept working for a month. These cases pin the three moments that matter —
 * signing out everywhere, deleting the account, and the deploy that introduced the column.
 */

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});
beforeEach(async () => {
  await resetDatabase();
});

const me = async (token: string): Promise<number> => (await call(h, "GET", "/v1/me", { token })).status;

describe("signing out", () => {
  it("does nothing to other devices unless asked", async () => {
    const a = await signup(h);
    const phone = await signSession(a.userId, 0);

    expect((await call(h, "POST", "/v1/auth/sign-out", { token: a.token, body: {} })).status).toBe(200);
    // Signing out of this device is the client forgetting its own token. Kicking every other
    // device the person is quietly still using would be a different, unasked-for action.
    expect(await me(phone), "the other device stays signed in").toBe(200);
    expect(await me(a.token), "and so does this one, server-side").toBe(200);
  });

  it("kills every token ever issued when asked for all devices", async () => {
    const a = await signup(h);
    const phone = await signSession(a.userId, 0);
    const laptop = await signSession(a.userId, 0);

    const res = await call<{ revoked: boolean }>(h, "POST", "/v1/auth/sign-out", {
      token: a.token,
      body: { allDevices: true },
    });
    expect(res.status).toBe(200);
    expect(res.data.revoked).toBe(true);

    for (const [label, token] of [
      ["phone", phone],
      ["laptop", laptop],
      ["this one", a.token],
    ] as const) {
      expect(await me(token), `${label} must be signed out`).toBe(401);
    }
  });

  it("lets the user back in, and the old tokens stay dead", async () => {
    const a = await signup(h);
    await call(h, "POST", "/v1/auth/sign-out", { token: a.token, body: { allDevices: true } });

    const again = await signup(h, { email: a.email });
    expect(await me(again.token), "a fresh sign-in works").toBe(200);
    expect(await me(a.token), "the revoked one does not come back").toBe(401);
  });

  it("can be done twice without the second one letting anything back in", async () => {
    const a = await signup(h);
    await call(h, "POST", "/v1/auth/sign-out", { token: a.token, body: { allDevices: true } });
    const stale = a.token;
    const again = await signup(h, { email: a.email });
    await call(h, "POST", "/v1/auth/sign-out", { token: again.token, body: { allDevices: true } });
    expect(await me(stale)).toBe(401);
    expect(await me(again.token)).toBe(401);
  });

  it("needs a session of its own — it is not an anonymous kick", async () => {
    expect((await call(h, "POST", "/v1/auth/sign-out", { body: { allDevices: true } })).status).toBe(401);
  });

  it("cannot be aimed at somebody else", async () => {
    const victim = await signup(h);
    const attacker = await signup(h);
    // There is no user id in the request by design: the only account you can sign out is your own.
    await call(h, "POST", "/v1/auth/sign-out", { token: attacker.token, body: { allDevices: true } });
    expect(await me(victim.token), "the other account is untouched").toBe(200);
  });
});

describe("a token from before the column existed", () => {
  it("still works, until the first revocation", async () => {
    const a = await signup(h);
    // What an already-issued token looks like: signed with no `v` claim at all.
    const legacy = await signSession(a.userId);
    expect(await me(legacy), "deploy day must not sign everybody out").toBe(200);

    await call(h, "POST", "/v1/auth/sign-out", { token: a.token, body: { allDevices: true } });
    expect(await me(legacy), "and then it is revoked like any other").toBe(401);
  });
});

describe("deleting the account", () => {
  /**
   * The reason deletion revokes: `requireAuth` lets a soft-deleted account through to exactly one
   * route, `/account/restore`. Somebody holding the stolen token could otherwise **undo the
   * deletion** — on the account the theft is the reason for deleting.
   */
  it("revokes the sessions it is being used to escape", async () => {
    const a = await signup(h);
    const thief = await signSession(a.userId, 0);

    expect((await call(h, "POST", "/v1/account/delete", { token: a.token, body: { confirm: "DELETE" } })).status).toBe(
      200,
    );
    expect(
      (await call(h, "POST", "/v1/account/restore", { token: thief })).status,
      "the stolen token must not be able to undo this",
    ).toBe(401);
  });

  it("still lets the owner cancel it after signing in again", async () => {
    const a = await signup(h);
    await call(h, "POST", "/v1/account/delete", { token: a.token, body: { confirm: "DELETE" } });

    const back = await signup(h, { email: a.email });
    const restored = await call(h, "POST", "/v1/account/restore", { token: back.token });
    expect(restored.status, "proving the address is yours is the price of undoing a deletion").toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(user.deletedAt).toBeNull();
  });
});
