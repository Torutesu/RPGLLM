import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PACING } from "@rpgllm/shared";
import { call, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

interface NotificationRow {
  id: string; kind: string; text: string; target: string | null;
  actor: { handle: string; displayName: string; avatarUrl: string | null } | null;
  readAt: string | null; createdAt: string;
}
interface ListRes { notifications: NotificationRow[]; unread: number; nextCursor: string | null }

const list = (token: string, personaId: string, cursor?: string) =>
  call<ListRes>(h, "GET", `/v1/notifications?personaId=${personaId}${cursor ? `&cursor=${cursor}` : ""}`, { token });

async function postAndStream(token: string, personaId: string, text: string): Promise<string> {
  const res = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
    token, body: { personaId, text, parentId: null },
  });
  await readSSE(h, res.data.streamUrl, token);
  return res.data.post.id;
}

describe("notifications (SCR-042)", () => {
  it("writes one reply notification per character reply and at most three likes for one post", async () => {
    const fx = await signupWithPersona(h);
    const postId = await postAndStream(fx.token, fx.personaId, "new song Friday");

    const replies = await prisma.post.count({ where: { parentId: postId, kind: "character" } });
    expect(replies).toBe(PACING.K_INITIAL);

    const forPost = { personaId: fx.personaId, target: `post:${postId}` };
    expect(await prisma.notification.count({ where: { ...forPost, kind: "reply" } })).toBe(replies);
    const likes = await prisma.notification.count({ where: { ...forPost, kind: "like" } });
    expect(likes).toBeGreaterThan(0);
    expect(likes).toBeLessThanOrEqual(3);

    // Replaying the stream must not duplicate anything (the stream is idempotent).
    await readSSE(h, `/v1/posts/${postId}/stream`, fx.token);
    expect(await prisma.notification.count({ where: { ...forPost, kind: "reply" } })).toBe(replies);
    expect(await prisma.notification.count({ where: { ...forPost, kind: "like" } })).toBe(likes);
  });

  it("never lets one post produce more than three likes even after more-replies", async () => {
    const fx = await signupWithPersona(h);
    const postId = await postAndStream(fx.token, fx.personaId, "load more reactions");
    const more = await call(h, "POST", `/v1/posts/${postId}/more-replies`, { token: fx.token });
    expect(more.status).toBe(200);
    expect(await prisma.notification.count({
      where: { personaId: fx.personaId, kind: "like", target: `post:${postId}` },
    })).toBeLessThanOrEqual(3);
  });

  it("lists newest first with an unread count, a resolved actor and localized text", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "first");

    const res = await list(fx.token, fx.personaId);
    expect(res.status).toBe(200);
    expect(res.data.notifications.length).toBeGreaterThan(0);
    expect(res.data.unread).toBe(res.data.notifications.filter((n) => n.readAt === null).length);

    const reply = res.data.notifications.find((n) => n.kind === "reply")!;
    expect(reply.actor).not.toBeNull();
    expect(reply.actor!.handle.startsWith("@")).toBe(false);
    expect(reply.text).toMatch(/replied to you$/);
    expect(reply.target).toMatch(/^post:/);

    const times = res.data.notifications.map((n) => Date.parse(n.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("marks everything read with {ids:null} and clears the badge", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "clear me");
    const before = await list(fx.token, fx.personaId);
    expect(before.data.unread).toBeGreaterThan(0);

    const marked = await call<{ unread: number }>(h, "POST", `/v1/notifications/read?personaId=${fx.personaId}`, {
      token: fx.token, body: { ids: null },
    });
    expect(marked.status).toBe(200);
    expect(marked.data.unread).toBe(0);
    expect((await list(fx.token, fx.personaId)).data.unread).toBe(0);
  });

  it("marks only the ids it was given", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "partial");
    const before = await list(fx.token, fx.personaId);
    const one = before.data.notifications[0]!;

    const marked = await call<{ unread: number }>(h, "POST", `/v1/notifications/read?personaId=${fx.personaId}`, {
      token: fx.token, body: { ids: [one.id] },
    });
    expect(marked.data.unread).toBe(before.data.unread - 1);
  });

  it("scopes to the caller's persona", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    await postAndStream(theirs.token, theirs.personaId, "not yours");
    const res = await list(mine.token, theirs.personaId);
    expect(res.status).toBe(404);
  });

  it("requires a session", async () => {
    const fx = await signupWithPersona(h);
    expect((await call(h, "GET", `/v1/notifications?personaId=${fx.personaId}`)).status).toBe(401);
  });
});
