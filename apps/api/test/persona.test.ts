import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, PACING } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

describe("persona creation seeds the feed (E2E-002)", () => {
  it("creates relationships for the whole cast and a 6-item starting feed", async () => {
    const fx = await signupWithPersona(h);
    const feed = await call<{ posts: { kind: string; author: { handle: string } }[] }>(h, "GET", `/v1/feed?personaId=${fx.personaId}`, { token: fx.token });

    expect(feed.status).toBe(200);
    const ambient = feed.data.posts.filter((p) => p.kind === "ambient");
    const character = feed.data.posts.filter((p) => p.kind === "character");
    expect(ambient).toHaveLength(PACING.AMBIENT_SEED_COUNT);
    expect(character).toHaveLength(1);
    expect(character[0]?.author.handle).toBe("hivequeenbea");

    const rels = await prisma.relationshipState.findMany({ where: { personaId: fx.personaId } });
    expect(rels).toHaveLength(fx.characters.length);
    const follower = rels.find((r) => r.characterId === fx.firstFollowerId);
    expect(follower?.isFollower).toBe(true);
    expect(follower?.affinity).toBe(20);

    // creating a persona costs no energy
    const wallet = await getWallet(h, fx.token);
    expect(wallet.data.energy).toBe(ENERGY.FREE_DAILY);
  });

  it("is idempotent for a repeated idempotencyKey", async () => {
    const { token } = await signup(h);
    const worlds = await call<{ id: string; slug: string }[]>(h, "GET", "/v1/worlds", { token });
    const world = worlds.data[0]!;
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(h, "GET", `/v1/worlds/${world.id}`, { token });
    const first = detail.data.characters.find((ch) => ch.canBeFirstFollower)!;
    const body = {
      worldId: world.id, handle: "taytay19", displayName: "Tay", bio: "", avatarUrl: null,
      voiceNotes: "", firstFollowerId: first.id, idempotencyKey: "same-key",
    };
    const a = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", { token, body });
    const b = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", { token, body });
    expect(b.data.persona.id).toBe(a.data.persona.id);
    expect(await prisma.persona.count()).toBe(1);
  });

  it("reports handle availability and rejects a taken handle for another user", async () => {
    const fx = await signupWithPersona(h, { handle: "taytay19" });
    const check = await call<{ available: boolean }>(h, "GET", `/v1/personas/check?worldId=${fx.worldId}&handle=taytay19`, { token: fx.token });
    expect(check.data.available).toBe(false);

    const other = await signup(h);
    const res = await call(h, "POST", "/v1/personas", {
      token: other.token,
      body: {
        worldId: fx.worldId, handle: "taytay19", displayName: "Copycat", bio: "", avatarUrl: null,
        voiceNotes: "", firstFollowerId: fx.firstFollowerId, idempotencyKey: "other",
      },
    });
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("HANDLE_TAKEN");
  });

  it("uses the ja locale for ambient text and the welcome post", async () => {
    const fx = await signupWithPersona(h, { locale: "ja" });
    const feed = await call<{ posts: { kind: string; text: string }[] }>(h, "GET", `/v1/feed?personaId=${fx.personaId}`, { token: fx.token });
    const texts = feed.data.posts.map((p) => p.text).join(" ");
    expect(/[ぁ-んァ-ヶ一-龠]/.test(texts)).toBe(true);
  });
});
