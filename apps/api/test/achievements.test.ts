import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACHIEVEMENTS, strings } from "@rpgllm/shared";
import { call, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

interface AchievementRow {
  key: string; title: string; description: string; icon: string;
  tier: string; unlockedAt: string | null; seenAt: string | null; value: number; progress: number;
}
interface AchievementsRes {
  achievements: AchievementRow[]; unlocked: number; total: number; pending: AchievementRow[];
}

const listFor = (token: string, personaId: string) =>
  call<AchievementsRes>(h, "GET", `/v1/achievements?personaId=${personaId}`, { token });

async function postAndStream(token: string, personaId: string, text: string): Promise<string> {
  const res = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
    token, body: { personaId, text, parentId: null },
  });
  await readSSE(h, res.data.streamUrl, token);
  return res.data.post.id;
}

describe("achievements (SCR-044)", () => {
  it("unlocks First words on the first post, exactly once, and notifies", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "first words");

    const unlocks = await prisma.achievementUnlock.findMany({ where: { personaId: fx.personaId, key: "first_post" } });
    expect(unlocks).toHaveLength(1);
    expect(unlocks[0]!.value).toBeGreaterThanOrEqual(1);

    const notes = await prisma.notification.findMany({
      where: { personaId: fx.personaId, kind: "unlock", target: "achievement:first_post" },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toContain(strings.en.ach_first_post_title);

    // A second post (and a second read) must not unlock or notify again.
    await postAndStream(fx.token, fx.personaId, "second words");
    await listFor(fx.token, fx.personaId);
    expect(await prisma.achievementUnlock.count({ where: { personaId: fx.personaId, key: "first_post" } })).toBe(1);
    expect(await prisma.notification.count({
      where: { personaId: fx.personaId, kind: "unlock", target: "achievement:first_post" },
    })).toBe(1);
  });

  it("returns the whole catalogue with titles from i18n and progress on locked rows", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "one post");

    const res = await listFor(fx.token, fx.personaId);
    expect(res.status).toBe(200);
    expect(res.data.total).toBe(ACHIEVEMENTS.length);
    expect(res.data.achievements).toHaveLength(ACHIEVEMENTS.length);

    const first = res.data.achievements.find((a) => a.key === "first_post")!;
    expect(first.title).toBe(strings.en.ach_first_post_title);
    expect(first.description).toBe(strings.en.ach_first_post_desc);
    expect(first.unlockedAt).not.toBeNull();
    expect(first.progress).toBe(1);

    // `posts_25` watches the same metric: 1 post out of 25 is exactly 4% of the way there.
    const locked = res.data.achievements.find((a) => a.key === "posts_25")!;
    expect(locked.unlockedAt).toBeNull();
    expect(locked.value).toBe(1);
    expect(locked.progress).toBeCloseTo(1 / 25, 6);
    expect(res.data.achievements.every((a) => a.progress >= 0 && a.progress <= 1)).toBe(true);
  });

  it("localizes titles for a JA persona", async () => {
    const fx = await signupWithPersona(h, { locale: "ja" });
    await postAndStream(fx.token, fx.personaId, "はじめての投稿");
    const res = await listFor(fx.token, fx.personaId);
    expect(res.data.achievements.find((a) => a.key === "first_post")!.title).toBe(strings.ja.ach_first_post_title);
  });

  it("reports pending unlocks until they are marked seen", async () => {
    const fx = await signupWithPersona(h);
    await postAndStream(fx.token, fx.personaId, "pending please");

    const before = await listFor(fx.token, fx.personaId);
    expect(before.data.pending.map((p) => p.key)).toContain("first_post");

    const seen = await call<{ pending: number }>(h, "POST", `/v1/achievements/seen?personaId=${fx.personaId}`, {
      token: fx.token, body: { keys: ["first_post"] },
    });
    expect(seen.status).toBe(200);

    const after = await listFor(fx.token, fx.personaId);
    expect(after.data.pending.map((p) => p.key)).not.toContain("first_post");
    expect(after.data.achievements.find((a) => a.key === "first_post")!.seenAt).not.toBeNull();
    expect(after.data.unlocked).toBe(before.data.unlocked);
  });

  it("unlocks a follower tier when the stat crosses it, and notifies once", async () => {
    const fx = await signupWithPersona(h);
    await prisma.persona.update({ where: { id: fx.personaId }, data: { followers: 5200 } });
    const res = await listFor(fx.token, fx.personaId);
    const keys = res.data.achievements.filter((a) => a.unlockedAt).map((a) => a.key);
    expect(keys).toContain("followers_500");
    expect(keys).toContain("followers_5k");
    expect(keys).not.toContain("followers_50k");
    expect(await prisma.notification.count({
      where: { personaId: fx.personaId, kind: "unlock", target: "achievement:followers_5k" },
    })).toBe(1);

    await listFor(fx.token, fx.personaId);
    expect(await prisma.notification.count({
      where: { personaId: fx.personaId, kind: "unlock", target: "achievement:followers_5k" },
    })).toBe(1);
  });

  it("scopes to the caller's persona and needs a session", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    expect((await listFor(mine.token, theirs.personaId)).status).toBe(404);
    expect((await call(h, "GET", `/v1/achievements?personaId=${mine.personaId}`)).status).toBe(401);
  });
});
