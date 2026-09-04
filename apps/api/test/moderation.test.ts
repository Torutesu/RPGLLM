import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { castCards, loadStoryContext } from "../src/services/story";
import { call, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness, type PersonaFixture } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

const bare = (handle: string) => handle.replace(/^@+/, "");

async function characterPost(fx: PersonaFixture, characterId: string, text: string): Promise<string> {
  const row = await prisma.post.create({
    data: { worldId: fx.worldId, personaId: fx.personaId, authorCharacterId: characterId, kind: "character", text },
  });
  return row.id;
}

const feedTexts = async (token: string, personaId: string): Promise<string[]> => {
  const res = await call<{ posts: { text: string }[] }>(h, "GET", `/v1/feed?personaId=${personaId}`, { token });
  return res.data.posts.map((p) => p.text);
};

const cast = async (fx: PersonaFixture): Promise<string[]> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: fx.userId } });
  const ctx = await loadStoryContext(prisma, user, fx.personaId);
  return castCards(ctx!).map((c) => c.handle);
};

describe("S1-2 report (App Store Guideline 1.2)", () => {
  it("stores a server-side snapshot and the originating generation", async () => {
    const fx = await signupWithPersona(h);
    const log = await prisma.generationLog.create({
      data: {
        userId: fx.userId, generator: "G1", variantId: "v", model: "m", promptHash: "h",
        inputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 1, costUsd: 0, latencyMs: 1, stopReason: "end_turn",
      },
    });
    const post = await prisma.post.create({
      data: {
        worldId: fx.worldId, personaId: fx.personaId, authorCharacterId: fx.firstFollowerId,
        kind: "character", text: "you will never be anything", generationId: log.id,
      },
    });

    const res = await call<{ id: string; status: string }>(h, "POST", "/v1/moderation/report", {
      token: fx.token, body: { target: "post", targetId: post.id, reason: "harassment", note: "cruel" },
    });
    expect(res.status).toBe(201);
    expect(res.data.status).toBe("open");

    const row = await prisma.report.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(row.userId).toBe(fx.userId);
    expect(row.snapshot).toContain("you will never be anything");
    expect(row.snapshot).not.toBe("");
    expect(row.generationId).toBe(log.id);
    expect(row.reason).toBe("harassment");
    expect(row.note).toBe("cruel");
  });

  it("refuses a duplicate open report for the same target", async () => {
    const fx = await signupWithPersona(h);
    const postId = await characterPost(fx, fx.firstFollowerId, "again and again");
    const body = { target: "post", targetId: postId, reason: "hate", note: "" };

    expect((await call(h, "POST", "/v1/moderation/report", { token: fx.token, body })).status).toBe(201);
    const dup = await call(h, "POST", "/v1/moderation/report", { token: fx.token, body });
    expect(dup.status).toBe(409);
    expect(dup.error?.code).toBe("ALREADY_DONE");
    expect(await prisma.report.count({ where: { targetId: postId } })).toBe(1);
  });

  it("404s on a target that does not exist and validates the reason", async () => {
    const fx = await signupWithPersona(h);
    const missing = await call(h, "POST", "/v1/moderation/report", {
      token: fx.token, body: { target: "post", targetId: "nope", reason: "other", note: "" },
    });
    expect(missing.status).toBe(404);

    const bad = await call(h, "POST", "/v1/moderation/report", {
      token: fx.token, body: { target: "post", targetId: "nope", reason: "not-a-reason", note: "" },
    });
    expect(bad.status).toBe(400);
  });

  it("reports a character and exposes the queue behind the test hook", async () => {
    const fx = await signupWithPersona(h);
    const created = await call<{ id: string }>(h, "POST", "/v1/moderation/report", {
      token: fx.token, body: { target: "character", targetId: fx.firstFollowerId, reason: "off_character", note: "" },
    });
    expect(created.status).toBe(201);

    const queue = await call<{ reports: { id: string; target: string; snapshot: string }[] }>(
      h, "GET", "/v1/moderation/reports?status=open", { token: fx.token },
    );
    expect(queue.status).toBe(200);
    expect(queue.data.reports.map((r) => r.id)).toContain(created.data.id);
    expect(queue.data.reports[0]?.snapshot).not.toBe("");
  });
});

describe("S1-2 block", () => {
  it("hides the character from the feed, the DM inbox, the picker and the generator cast", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    const other = fx.characters.find((ch) => ch.id !== fx.firstFollowerId)!;
    await characterPost(fx, follower.id, "blocked-author post");
    await characterPost(fx, other.id, "other-author post");
    const thread = await call<{ thread: { id: string } }>(h, "POST", "/v1/dms", {
      token: fx.token, body: { personaId: fx.personaId, characterId: follower.id },
    });
    expect(thread.status).toBe(201);

    expect(await feedTexts(fx.token, fx.personaId)).toContain("blocked-author post");
    const before = await call<{ threads: { id: string }[]; followers: { handle: string }[] }>(
      h, "GET", `/v1/dms?personaId=${fx.personaId}`, { token: fx.token },
    );
    expect(before.data.threads.map((t) => t.id)).toContain(thread.data.thread.id);
    expect(before.data.followers.map((f) => bare(f.handle))).toContain(bare(follower.handle));
    expect(await cast(fx)).toContain(bare(follower.handle));

    const blocked = await call(h, "POST", "/v1/moderation/block", {
      token: fx.token, body: { personaId: fx.personaId, characterId: follower.id },
    });
    expect(blocked.status).toBe(201);

    const texts = await feedTexts(fx.token, fx.personaId);
    expect(texts).not.toContain("blocked-author post");
    expect(texts).toContain("other-author post");

    const after = await call<{ threads: { id: string }[]; followers: { handle: string }[] }>(
      h, "GET", `/v1/dms?personaId=${fx.personaId}`, { token: fx.token },
    );
    expect(after.data.threads.map((t) => t.id)).not.toContain(thread.data.thread.id);
    expect(after.data.followers.map((f) => bare(f.handle))).not.toContain(bare(follower.handle));
    expect(await cast(fx)).not.toContain(bare(follower.handle));
  });

  it("409s on a second block and lists what is blocked", async () => {
    const fx = await signupWithPersona(h);
    const body = { personaId: fx.personaId, characterId: fx.firstFollowerId };
    expect((await call(h, "POST", "/v1/moderation/block", { token: fx.token, body })).status).toBe(201);
    const again = await call(h, "POST", "/v1/moderation/block", { token: fx.token, body });
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe("BLOCKED");

    const list = await call<{ blocked: { characterId: string; handle: string; displayName: string }[] }>(
      h, "GET", `/v1/moderation/blocked?personaId=${fx.personaId}`, { token: fx.token },
    );
    expect(list.data.blocked.map((b) => b.characterId)).toEqual([fx.firstFollowerId]);
    expect(list.data.blocked[0]?.handle.startsWith("@")).toBe(false);
    expect(list.data.blocked[0]?.displayName).not.toBe("");
  });

  it("unblock brings the character back", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    await characterPost(fx, follower.id, "welcome back");
    const body = { personaId: fx.personaId, characterId: follower.id };

    await call(h, "POST", "/v1/moderation/block", { token: fx.token, body });
    expect(await feedTexts(fx.token, fx.personaId)).not.toContain("welcome back");

    const un = await call(h, "POST", "/v1/moderation/unblock", { token: fx.token, body });
    expect(un.status).toBe(200);
    expect(await feedTexts(fx.token, fx.personaId)).toContain("welcome back");
    expect(await cast(fx)).toContain(bare(follower.handle));

    const list = await call<{ blocked: unknown[] }>(h, "GET", `/v1/moderation/blocked?personaId=${fx.personaId}`, { token: fx.token });
    expect(list.data.blocked).toEqual([]);
  });

  it("refuses to unblock what is not blocked, and to block for someone else's persona", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    const un = await call(h, "POST", "/v1/moderation/unblock", {
      token: mine.token, body: { personaId: mine.personaId, characterId: mine.firstFollowerId },
    });
    expect(un.status).toBe(404);

    const foreign = await call(h, "POST", "/v1/moderation/block", {
      token: mine.token, body: { personaId: theirs.personaId, characterId: theirs.firstFollowerId },
    });
    expect(foreign.status).toBe(404);
    expect(await prisma.blockedCharacter.count()).toBe(0);
  });
});
