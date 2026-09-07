import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CreatorProfileResZ, MeResZ, MyWorldsResZ, PublicWorldsResZ, WorldDetailResZ, WorldsResZ,
} from "@rpgllm/shared";
import { call, makeHarness, resetDatabase, signup, type Harness } from "./helpers";

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
});
