import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CreatorProfileResZ, MeResZ, ModerationMetricsResZ, MomentReelResZ, MyWorldsResZ, PublicWorldsResZ,
  WorldDetailResZ, WorldsResZ,
} from "@rpgllm/shared";
import { call, makeHarness, prisma, readSSE, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

/**
 * The responses this service returns, parsed against the schemas `packages/shared` publishes.
 *
 * This file exists because of a bug that got through: `WorldDetailResZ` gained
 * `genre: WorldGenreZ.nullable()`, and `World.genre` is a plain column defaulting to `""` — which
 * the presets have, and which is not a member of the enum. **Every API test passed.** The client
 * validates its responses, so the world detail threw on every preset world, the persona picker
 * rendered nothing, and forty E2E cases went red at once.
 *
 * The gap is structural: `call()` returns `unknown` shaped by a type parameter the test writer
 * chooses, so a test asserting `res.data.world.slug` never notices that a *different* field is a
 * shape the contract forbids. Nothing here asserts behaviour — each case parses a real response
 * through the real schema, which is exactly the check the type parameter cannot perform.
 */

let h: Harness;

beforeAll(() => {
  h = makeHarness();
});

beforeEach(async () => {
  await resetDatabase();
});

describe("responses parse against the schemas packages/shared publishes", () => {
  it("GET /v1/worlds and the detail of a preset", async () => {
    const { token } = await signup(h);

    const list = await call<unknown>(h, "GET", "/v1/worlds", { token });
    expect(list.status).toBe(200);
    const worlds = WorldsResZ.parse(list.data);
    expect(worlds.length, "the presets are seeded").toBeGreaterThan(0);

    // The preset has no genre — it was authored, not generated — and "" is not a WorldGenre.
    const detail = await call<unknown>(h, "GET", `/v1/worlds/${worlds[0]!.slug}`, { token });
    expect(detail.status).toBe(200);
    const parsed = WorldDetailResZ.parse(detail.data);
    expect(parsed.world.genre, "no genre is null on the wire, never an empty string").toBeNull();
    expect(parsed.world.isPreset).toBe(true);
    expect(parsed.characters.length).toBeGreaterThan(0);
  });

  it("GET /v1/me", async () => {
    const { token } = await signup(h);
    const res = await call<unknown>(h, "GET", "/v1/me", { token });
    expect(res.status).toBe(200);
    const me = MeResZ.parse(res.data);
    expect(me.user.creatorHandle, "every account is credited under some name").not.toBe("");
  });

  it("the world shelves, empty", async () => {
    const { token } = await signup(h);

    const mine = await call<unknown>(h, "GET", "/v1/worlds/mine", { token });
    expect(mine.status).toBe(200);
    expect(MyWorldsResZ.parse(mine.data).worlds).toHaveLength(0);

    const shelf = await call<unknown>(h, "GET", "/v1/worlds/public", { token });
    expect(shelf.status).toBe(200);
    const parsed = PublicWorldsResZ.parse(shelf.data);
    expect(parsed.worlds).toHaveLength(0);
    expect(parsed.fresh).toHaveLength(0);
  });

  it("GET /v1/creators/:handle for an account with nothing published", async () => {
    const { token } = await signup(h);
    const me = MeResZ.parse((await call<unknown>(h, "GET", "/v1/me", { token })).data);

    const res = await call<unknown>(h, "GET", `/v1/creators/${me.user.creatorHandle}`, { token });
    expect(res.status).toBe(200);
    const profile = CreatorProfileResZ.parse(res.data);
    expect(profile.handle).toBe(me.user.creatorHandle);
    expect(profile.isYou).toBe(true);
    expect(profile.worlds).toHaveLength(0);
    expect(profile.totalPlays).toBe(0);
  });

  it("GET /v1/moments/:slug/reel — the share target a recording is made from", async () => {
    const fx = await signupWithPersona(h);
    const created = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
      token: fx.token, body: { personaId: fx.personaId, text: "the album leaked", parentId: null },
    });
    await readSSE(h, created.data.streamUrl, fx.token);
    const snapshot = await prisma.statSnapshot.findFirstOrThrow({ where: { cause: `post:${created.data.post.id}` } });
    await prisma.statSnapshot.update({ where: { id: snapshot.id }, data: { auraDelta: 6 } });
    const list = await call<{ moments: { shareSlug: string }[] }>(
      h, "GET", `/v1/moments?personaId=${fx.personaId}`, { token: fx.token },
    );

    // No bearer: the reel is public exactly like the card it comes from.
    const res = await call<unknown>(h, "GET", `/v1/moments/${list.data.moments[0]!.shareSlug}/reel`);
    expect(res.status).toBe(200);
    const reel = MomentReelResZ.parse(res.data);
    expect(reel.beats.length).toBeGreaterThan(2);
    expect(reel.durationMs).toBe(reel.beats.reduce((sum, b) => sum + b.holdMs, 0));
    // `delta` is present on the stat beat and null everywhere else — the contract allows both, and
    // a client that counts the number up depends on which is which.
    expect(reel.beats.filter((b) => b.delta !== null).map((b) => b.kind)).toEqual(["stat"]);
  });

  it("GET /v1/admin/moderation/metrics, on a deployment nobody has used yet", async () => {
    const res = await call<unknown>(h, "GET", "/v1/admin/moderation/metrics");
    expect(res.status).toBe(200);
    const parsed = ModerationMetricsResZ.parse(res.data);
    // The nullable halves of the contract are exercised by the case that matters: the empty window.
    expect(parsed.decisions.medianLatencyHours).toBeNull();
    expect(parsed.decisions.p90LatencyHours).toBeNull();
    expect(parsed.thresholds.reportsToPull).toBeGreaterThan(0);
  });
});
