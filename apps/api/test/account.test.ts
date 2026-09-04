import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETION_GRACE_DAYS } from "@rpgllm/shared";
import { EXPORT_LIMIT, purgeDeletedAccounts } from "../src/services/account";
import { call, makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

const deleteAccount = (token: string) =>
  call<{ deletedAt: string; purgeAt: string }>(h, "POST", "/v1/account/delete", { token, body: { confirm: "DELETE" } });

describe("S1-1 account deletion (App Store 5.1.1(v))", () => {
  it("soft-deletes the user and revokes access to the account routes", async () => {
    const { token, userId } = await signup(h);

    const res = await deleteAccount(token);
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.deletedAt).not.toBeNull();
    expect(Date.parse(res.data.purgeAt) - Date.parse(res.data.deletedAt)).toBe(DELETION_GRACE_DAYS * DAY_MS);

    const after = await call(h, "GET", "/v1/account/export", { token });
    expect(after.status).toBe(410);
    expect(after.error?.code).toBe("ACCOUNT_DELETED");

    const moderation = await call(h, "GET", "/v1/moderation/blocked", { token });
    expect(moderation.status).toBe(410);
  });

  it("rejects a body that does not spell DELETE", async () => {
    const { token } = await signup(h);
    const res = await call(h, "POST", "/v1/account/delete", { token, body: { confirm: "delete" } });
    expect(res.status).toBe(400);
    expect((await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).deletedAt).toBeNull();
  });

  it("restores the account inside the grace window", async () => {
    const { token, userId } = await signup(h);
    await deleteAccount(token);

    const restored = await call<{ restored: boolean }>(h, "POST", "/v1/account/restore", { token });
    expect(restored.status).toBe(200);
    expect(restored.data.restored).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).deletedAt).toBeNull();

    // and the account works again
    expect((await call(h, "GET", "/v1/account/export", { token })).status).toBe(200);
  });

  it("refuses to restore once the grace window has passed", async () => {
    const { token, userId } = await signup(h);
    await deleteAccount(token);
    await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(Date.now() - (DELETION_GRACE_DAYS + 1) * DAY_MS) },
    });
    const res = await call(h, "POST", "/v1/account/restore", { token });
    expect(res.status).toBe(410);
    expect(res.error?.code).toBe("ACCOUNT_DELETED");
  });

  it("purges every dependent row once the window elapses, and leaves other users alone", async () => {
    const victim = await signupWithPersona(h);
    const bystander = await signupWithPersona(h);

    // a DM thread + message, a report, a rating-free generation log and a ledger entry
    const thread = await call<{ thread: { id: string } }>(h, "POST", "/v1/dms", {
      token: victim.token, body: { personaId: victim.personaId, characterId: victim.firstFollowerId },
    });
    await prisma.dMMessage.create({ data: { threadId: thread.data.thread.id, fromCharacter: false, text: "hi" } });
    const post = await prisma.post.create({
      data: { worldId: victim.worldId, personaId: victim.personaId, kind: "user", text: "mine" },
    });
    await call(h, "POST", "/v1/moderation/report", {
      token: victim.token, body: { target: "post", targetId: post.id, reason: "other", note: "" },
    });
    await prisma.generationLog.create({
      data: {
        userId: victim.userId, generator: "G1", variantId: "v", model: "m", promptHash: "h",
        inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1, costUsd: 0, latencyMs: 1, stopReason: "end_turn",
      },
    });

    await deleteAccount(victim.token);
    await prisma.user.update({
      where: { id: victim.userId },
      data: { deletedAt: new Date(Date.now() - (DELETION_GRACE_DAYS + 1) * DAY_MS) },
    });

    const result = await purgeDeletedAccounts(prisma, new Date());
    expect(result.users).toBe(1);
    expect(result.personas).toBe(1);
    expect(result.posts).toBeGreaterThan(0);
    expect(result.messages).toBeGreaterThan(0);

    expect(await prisma.user.findUnique({ where: { id: victim.userId } })).toBeNull();
    for (const [what, count] of [
      ["persona", await prisma.persona.count({ where: { userId: victim.userId } })],
      ["post", await prisma.post.count({ where: { personaId: victim.personaId } })],
      ["thread", await prisma.dMThread.count({ where: { personaId: victim.personaId } })],
      ["message", await prisma.dMMessage.count({ where: { threadId: thread.data.thread.id } })],
      ["relationship", await prisma.relationshipState.count({ where: { personaId: victim.personaId } })],
      ["wallet", await prisma.wallet.count({ where: { userId: victim.userId } })],
      ["report", await prisma.report.count({ where: { userId: victim.userId } })],
      ["generation", await prisma.generationLog.count({ where: { userId: victim.userId } })],
    ] as const) {
      expect(count, `${what} rows must be gone`).toBe(0);
    }

    // the other account is untouched
    expect(await prisma.user.findUnique({ where: { id: bystander.userId } })).not.toBeNull();
    expect(await prisma.persona.count({ where: { userId: bystander.userId } })).toBe(1);
  });

  it("leaves accounts still inside the window alone (test hook)", async () => {
    const { token, userId } = await signup(h);
    await deleteAccount(token);
    const res = await call<{ users: number }>(h, "POST", "/v1/account/__test/purge-deleted", {});
    expect(res.status).toBe(200);
    expect(res.data.users).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
  });
});

describe("S1-1 data export (GDPR / APPI)", () => {
  it("exports only the caller's own rows", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    await prisma.post.create({ data: { worldId: mine.worldId, personaId: mine.personaId, kind: "user", text: "mine only" } });
    await prisma.post.create({ data: { worldId: theirs.worldId, personaId: theirs.personaId, kind: "user", text: "theirs only" } });

    const res = await call<{
      user: { id: string }; personas: { id: string }[]; posts: { text: string }[]; truncated: boolean;
    }>(h, "GET", "/v1/account/export", { token: mine.token });

    expect(res.status).toBe(200);
    expect(res.data.user.id).toBe(mine.userId);
    expect(res.data.personas.map((p) => p.id)).toEqual([mine.personaId]);
    expect(res.data.posts.some((p) => p.text === "mine only")).toBe(true);
    expect(res.data.posts.some((p) => p.text === "theirs only")).toBe(false);
    expect(res.data.truncated).toBe(false);
  });

  it("caps the export and flags it as truncated", async () => {
    const mine = await signupWithPersona(h);
    await prisma.post.createMany({
      data: Array.from({ length: EXPORT_LIMIT + 5 }, (_, i) => ({
        worldId: mine.worldId, personaId: mine.personaId, kind: "user" as const, text: `p${i}`,
      })),
    });
    const res = await call<{ posts: unknown[]; truncated: boolean }>(h, "GET", "/v1/account/export", { token: mine.token });
    expect(res.data.posts.length).toBe(EXPORT_LIMIT);
    expect(res.data.truncated).toBe(true);
  });
});

describe("S1-6 analytics consent", () => {
  it("stores the choice for an adult", async () => {
    const { token, userId } = await signup(h, { birthYear: 1990 });
    const on = await call<{ analytics: boolean; locked: boolean }>(h, "POST", "/v1/account/consent", { token, body: { analytics: true } });
    expect(on.data).toEqual({ analytics: true, locked: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).analyticsConsent).toBe(true);

    const off = await call<{ analytics: boolean }>(h, "POST", "/v1/account/consent", { token, body: { analytics: false } });
    expect(off.data.analytics).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).analyticsConsent).toBe(false);
  });

  it("forces consent off and locks it for a minor", async () => {
    const minorYear = new Date().getFullYear() - 15;
    const { token, userId } = await signup(h, { birthYear: minorYear });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).isMinor).toBe(true);

    const res = await call<{ analytics: boolean; locked: boolean }>(h, "POST", "/v1/account/consent", { token, body: { analytics: true } });
    expect(res.data).toEqual({ analytics: false, locked: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).analyticsConsent).toBe(false);
  });
});
