import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CharacterProfileResZ } from "@rpgllm/shared";
import { bioFrom } from "../src/routes/characters";
import { call, makeHarness, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

type Profile = ReturnType<typeof CharacterProfileResZ.parse>;

const profile = (token: string, handle: string, personaId: string) =>
  call<Profile>(h, "GET", `/v1/characters/${encodeURIComponent(handle)}?personaId=${personaId}`, { token });

async function postAndSettle(token: string, personaId: string, text: string): Promise<void> {
  const res = await call<{ streamUrl: string }>(h, "POST", "/v1/posts", { token, body: { personaId, text, parentId: null } });
  await readSSE(h, res.data.streamUrl, token);
}

describe("Agent K — bio extraction", () => {
  it("drops the generator's steering and keeps the person", () => {
    expect(bioFrom("Voice: all-caps hype, crowns and bees. Values loyalty. NG: never insults the user."))
      .toBe("All-caps hype, crowns and bees. Values loyalty.");
    expect(bioFrom("Role: the press account of this world. NG: never fabricates crimes."))
      .toBe("The press account of this world.");
    expect(bioFrom("")).toBe("");
  });
});

describe("GET /v1/characters/:handle (SCR-047)", () => {
  it("returns the character, their read on you and their posts", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    await postAndSettle(fx.token, fx.personaId, "studio all night again");

    const res = await profile(fx.token, follower.handle, fx.personaId);
    expect(res.status).toBe(200);
    expect(() => CharacterProfileResZ.parse(res.data)).not.toThrow();

    expect(res.data.character.handle).toBe(follower.handle.replace(/^@+/, ""));
    expect(res.data.bio.length).toBeGreaterThan(0);
    // The first follower follows you by definition (SCR-006).
    expect(res.data.relationship.isFollower).toBe(true);
    expect(res.data.relationship.affinity).toBeGreaterThan(0);
    expect(res.data.blocked).toBe(false);
    expect(res.data.posts.length).toBeGreaterThan(0);
    for (const p of res.data.posts) expect(p.author.handle).toBe(res.data.character.handle);
  });

  it("accepts a leading @ and the character id, and is case-insensitive", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    const bare = await profile(fx.token, follower.handle, fx.personaId);

    for (const key of [`@${follower.handle}`, follower.handle.toUpperCase(), follower.id]) {
      const res = await profile(fx.token, key, fx.personaId);
      expect(res.status, `"${key}" must resolve to the same page`).toBe(200);
      expect(res.data.character.id).toBe(bare.data.character.id);
    }
  });

  it("keeps a blocked character's page reachable but empties their posts", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    await postAndSettle(fx.token, fx.personaId, "studio all night again");

    await call(h, "POST", "/v1/moderation/block", {
      token: fx.token, body: { personaId: fx.personaId, characterId: follower.id },
    });

    const res = await profile(fx.token, follower.handle, fx.personaId);
    expect(res.status).toBe(200);
    expect(res.data.blocked).toBe(true);
    expect(res.data.posts).toEqual([]);
  });

  it("counts the memories the ledger shows", async () => {
    const fx = await signupWithPersona(h);
    const follower = fx.characters.find((ch) => ch.id === fx.firstFollowerId)!;
    await postAndSettle(fx.token, fx.personaId, "the tour announcement is real this time");

    const page = await profile(fx.token, follower.handle, fx.personaId);
    const ledger = await call<{ memories: unknown[] }>(
      h, "GET", `/v1/memory/${follower.handle}?personaId=${fx.personaId}`, { token: fx.token },
    );
    expect(page.data.relationship.memoryCount).toBe(ledger.data.memories.length);
  });

  it("404s for a stranger, another user's persona and an unknown handle", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    const follower = mine.characters.find((ch) => ch.id === mine.firstFollowerId)!;

    expect((await profile(mine.token, "nobody-here", mine.personaId)).status).toBe(404);
    expect((await profile(mine.token, follower.handle, theirs.personaId)).status).toBe(404);
    expect((await call(h, "GET", `/v1/characters/${follower.handle}`)).status).toBe(401);
  });
});
