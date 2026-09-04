import type { Prisma } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { xpForNextLevel, XP_PER_LEVEL } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness, type PersonaFixture } from "./helpers";

let h: Harness;

interface MomentRow {
  id: string; shareSlug: string; headline: string; body: string;
  payload: { deltas?: { followers: number; aura: number; humor: number }; reactions?: unknown[] };
  createdAt: string;
}

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

async function snapshot(
  p: PersonaFixture,
  opts: { followersDelta: number; auraDelta: number; humorDelta?: number; cause?: string; narrative?: string },
) {
  const persona = await prisma.persona.findUniqueOrThrow({ where: { id: p.personaId } });
  return await prisma.statSnapshot.create({
    data: {
      personaId: p.personaId,
      cause: opts.cause ?? `post:manual-${Math.random().toString(36).slice(2)}`,
      narrative: opts.narrative ?? "The timeline turned its head. Everyone had an opinion by morning.",
      followersDelta: opts.followersDelta,
      auraDelta: opts.auraDelta,
      humorDelta: opts.humorDelta ?? 0,
      relDeltas: {
        deltas: {},
        after: {
          followers: persona.followers + opts.followersDelta,
          aura: persona.aura + opts.auraDelta,
          humor: persona.humor + (opts.humorDelta ?? 0),
        },
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

describe("shareable moment (S2-4, AIF-005)", () => {
  it("creates exactly one moment for a qualifying swing and serves it publicly by slug", async () => {
    const p = await signupWithPersona(h);
    await snapshot(p, { followersDelta: 2, auraDelta: 6 });   // aura ±5 qualifies

    const list = await call<{ moments: MomentRow[] }>(h, "GET", `/v1/moments?personaId=${p.personaId}`, { token: p.token });
    expect(list.status).toBe(200);
    expect(list.data.moments).toHaveLength(1);
    const moment = list.data.moments[0]!;
    expect(moment.headline.length).toBeGreaterThan(0);
    expect(moment.payload.deltas?.aura).toBe(6);
    expect(Array.isArray(moment.payload.reactions)).toBe(true);

    // A second read must not mint a duplicate card for the same snapshot.
    const again = await call<{ moments: MomentRow[] }>(h, "GET", `/v1/moments?personaId=${p.personaId}`, { token: p.token });
    expect(again.data.moments).toHaveLength(1);
    expect(await prisma.moment.count()).toBe(1);

    // The share target is public: no bearer at all.
    const shared = await call<{ moment: MomentRow }>(h, "GET", `/v1/moments/${moment.shareSlug}`);
    expect(shared.status).toBe(200);
    expect(shared.data.moment.headline).toBe(moment.headline);
    expect(shared.data.moment.shareSlug).toBe(moment.shareSlug);

    const missing = await call(h, "GET", "/v1/moments/not-a-real-slug");
    expect(missing.status).toBe(404);
  });

  it("ignores an ordinary action and cards a follower spike or an event resolution", async () => {
    const p = await signupWithPersona(h);
    await snapshot(p, { followersDelta: 3, auraDelta: 1 });   // 3 of 120 followers, aura 1 → not a moment
    const quiet = await call<{ moments: MomentRow[] }>(h, "GET", `/v1/moments?personaId=${p.personaId}`, { token: p.token });
    expect(quiet.data.moments).toHaveLength(0);

    await snapshot(p, { followersDelta: 40, auraDelta: 0 });                    // >= 25% of 120
    await snapshot(p, { followersDelta: 1, auraDelta: 1, cause: "event:x1" });  // event resolution
    const loud = await call<{ moments: MomentRow[] }>(h, "GET", `/v1/moments?personaId=${p.personaId}`, { token: p.token });
    expect(loud.data.moments).toHaveLength(2);
  });
});

/**
 * SCR-026 lives here rather than in a fifth test file (the brief named four); the profile is the
 * other half of "progression the player can see", next to the moment card.
 */
describe("profile (SCR-026, S2-6)", () => {
  it("reports the level/XP maths the shared curve defines, the persona's posts and its cast", async () => {
    const p = await signupWithPersona(h);

    const fresh = await call<{
      persona: { handle: string; level: number; xp: number };
      levelProgress: { level: number; xp: number; xpForNext: number };
      posts: { id: string; author: { isYou: boolean } }[];
      relationships: { handle: string; affinity: number; isFollower: boolean; memoryCount: number }[];
      recentSnapshots: unknown[];
    }>(h, "GET", `/v1/profile?personaId=${p.personaId}`, { token: p.token });

    expect(fresh.status).toBe(200);
    expect(fresh.data.levelProgress).toEqual({ level: 1, xp: 0, xpForNext: xpForNextLevel(1) });
    expect(fresh.data.posts, "a new persona has posted nothing yet").toHaveLength(0);
    expect(fresh.data.relationships.length).toBe(p.characters.length);
    expect(fresh.data.relationships[0]?.isFollower, "the first follower sorts first").toBe(true);
    expect(fresh.data.relationships[0]?.memoryCount).toBe(0);

    // Level 3 at 250 XP (level = floor(xp/100) + 1); the bar's target is `level * XP_PER_LEVEL`.
    await prisma.persona.update({ where: { id: p.personaId }, data: { xp: 250, level: 3 } });
    const post = await call<{ post: { id: string } }>(h, "POST", "/v1/posts", {
      token: p.token, body: { personaId: p.personaId, text: "back from the studio", parentId: null },
    });
    expect(post.status).toBe(201);

    const grown = await call<{
      levelProgress: { level: number; xp: number; xpForNext: number };
      posts: { id: string; text: string; author: { isYou: boolean } }[];
      relationships: { memoryCount: number }[];
    }>(h, "GET", `/v1/profile?personaId=${p.personaId}`, { token: p.token });

    expect(grown.data.levelProgress).toEqual({ level: 3, xp: 250, xpForNext: xpForNextLevel(3) });
    expect(grown.data.levelProgress.xpForNext).toBe(3 * XP_PER_LEVEL);
    expect(grown.data.posts).toHaveLength(1);
    expect(grown.data.posts[0]?.text).toBe("back from the studio");
    expect(grown.data.posts[0]?.author.isYou).toBe(true);
  });

  it("never serves another account's persona", async () => {
    const p = await signupWithPersona(h);
    const other = await signupWithPersona(h);
    const res = await call(h, "GET", `/v1/profile?personaId=${p.personaId}`, { token: other.token });
    expect(res.status).toBe(404);
  });
});
