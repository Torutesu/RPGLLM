import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, PACING } from "@rpgllm/shared";
import {
  call,
  getWallet,
  makeHarness,
  prisma,
  resetDatabase,
  signup,
  signupWithPersona,
  type Harness,
} from "./helpers";

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});
beforeEach(async () => {
  await resetDatabase();
});

describe("persona creation seeds the feed (E2E-002)", () => {
  it("creates relationships for the whole cast and a 6-item starting feed", async () => {
    const fx = await signupWithPersona(h);
    const feed = await call<{ posts: { kind: string; author: { handle: string } }[] }>(
      h,
      "GET",
      `/v1/feed?personaId=${fx.personaId}`,
      { token: fx.token },
    );

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
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
      h,
      "GET",
      `/v1/worlds/${world.id}`,
      { token },
    );
    const first = detail.data.characters.find((ch) => ch.canBeFirstFollower)!;
    const body = {
      worldId: world.id,
      handle: "taytay19",
      displayName: "Tay",
      bio: "",
      avatarUrl: null,
      voiceNotes: "",
      firstFollowerId: first.id,
      idempotencyKey: "same-key",
    };
    const a = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", { token, body });
    const b = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", { token, body });
    expect(b.data.persona.id).toBe(a.data.persona.id);
    expect(await prisma.persona.count()).toBe(1);
  });

  it("reports a handle this player already holds as unavailable", async () => {
    const fx = await signupWithPersona(h, { handle: "taytay19" });
    const check = await call<{ available: boolean }>(
      h,
      "GET",
      `/v1/personas/check?worldId=${fx.worldId}&handle=taytay19`,
      { token: fx.token },
    );
    expect(check.data.available).toBe(false);
  });
});

/* ----------------------------------------------------------- handles ---- */

/**
 * A handle belongs to a **player within a world**, not to the world.
 *
 * `status` is single-player: a `Persona` is per (user, world), every post and DM is scoped by
 * `personaId`, and two players in the same world never see each other. The old
 * `Persona @@unique([worldId, handle])` therefore made strangers compete for names in a world they
 * do not share — and got worse the more a world was played, which is backwards for a product whose
 * strategy is one world played by many people. `GET /v1/worlds/:id` hands every player the same
 * `presetPersonas` to choose from, so the most likely first pick was the most likely collision.
 */
describe("persona handles are per player, not per world", () => {
  const createPersona = (token: string, worldId: string, firstFollowerId: string, handle: string, key: string) =>
    call<{ persona: { id: string; handle: string } }>(h, "POST", "/v1/personas", {
      token,
      body: {
        worldId,
        handle,
        displayName: "Rina",
        bio: "",
        avatarUrl: null,
        voiceNotes: "",
        firstFollowerId,
        idempotencyKey: key,
      },
    });

  it("lets two players take the same handle in one world, and gives each only their own", async () => {
    const first = await signupWithPersona(h, { handle: "rina" });
    const second = await signup(h);

    // The second player is *offered* the name, not refused it.
    const check = await call<{ available: boolean }>(
      h,
      "GET",
      `/v1/personas/check?worldId=${first.worldId}&handle=rina`,
      { token: second.token },
    );
    expect(check.data.available).toBe(true);

    const res = await createPersona(second.token, first.worldId, first.firstFollowerId, "rina", "second-rina");
    expect(res.status).toBe(201);
    expect(res.data.persona.handle).toBe("rina");
    expect(res.data.persona.id).not.toBe(first.personaId);

    // Two @rina in one world, one each, and neither can see the other's story.
    const rows = await prisma.persona.findMany({ where: { worldId: first.worldId, handle: "rina" } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(2);

    const mine = await call<{ posts: { id: string }[] }>(h, "GET", "/v1/feed", { token: second.token });
    const theirs = await call<{ posts: { id: string }[] }>(h, "GET", "/v1/feed", { token: first.token });
    expect(mine.data.posts.length).toBeGreaterThan(0);
    expect(theirs.data.posts.length).toBeGreaterThan(0);
    const overlap = mine.data.posts.filter((p) => theirs.data.posts.some((q) => q.id === p.id));
    expect(overlap, "two players in one world share no feed").toHaveLength(0);
  });

  /**
   * The one collision that is still a collision: `WorldCharacter` is a different table, so no index
   * can express this — two `@rina` in one feed would make `story.ts`'s reply targeting ambiguous.
   */
  it("still refuses a handle the world's own cast uses", async () => {
    const fx = await signupWithPersona(h);
    const castHandle = "hivequeenbea";

    const check = await call<{ available: boolean }>(
      h,
      "GET",
      `/v1/personas/check?worldId=${fx.worldId}&handle=HiveQueenBea`,
      { token: fx.token },
    );
    expect(check.data.available, "case and the stored leading @ must not smuggle it past").toBe(false);

    const other = await signup(h);
    const res = await createPersona(other.token, fx.worldId, fx.firstFollowerId, castHandle, "cast-clash");
    expect(res.status).toBe(409);
    expect(res.error?.code).toBe("HANDLE_TAKEN");
    expect(await prisma.persona.count({ where: { worldId: fx.worldId, handle: castHandle } })).toBe(0);
  });

  it("will not give one player two personas under the same handle in a world", async () => {
    const fx = await signupWithPersona(h, { handle: "rina" });
    const again = await createPersona(fx.token, fx.worldId, fx.firstFollowerId, "rina", "a-different-key");

    // Not an error — it is the same persona, handed back. What must not happen is a second row.
    expect(again.status).toBe(201);
    expect(again.data.persona.id).toBe(fx.personaId);
    expect(await prisma.persona.count({ where: { worldId: fx.worldId, userId: fx.userId } })).toBe(1);
  });

  it("uses the ja locale for ambient text and the welcome post", async () => {
    const fx = await signupWithPersona(h, { locale: "ja" });
    const feed = await call<{ posts: { kind: string; text: string }[] }>(
      h,
      "GET",
      `/v1/feed?personaId=${fx.personaId}`,
      { token: fx.token },
    );
    const texts = feed.data.posts.map((p) => p.text).join(" ");
    expect(/[ぁ-んァ-ヶ一-龠]/.test(texts)).toBe(true);
  });
});
