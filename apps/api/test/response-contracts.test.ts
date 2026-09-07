import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CreatorProfileResZ, MeResZ, ModerationMetricsResZ, MomentReelResZ, MyWorldsResZ, PublicWorldsResZ,
  PublishWorldResZ, WORLD_MODERATION, WorldDetailResZ, WorldReviewQueueResZ, WorldsResZ,
} from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import {
  call, grantShelfGems, makeHarness, prisma, readSSE, resetDatabase, signup, signupWithPersona,
  type Harness,
} from "./helpers";

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
let deps: JobDeps;

beforeAll(() => {
  h = makeHarness();
  deps = { prisma: h.prisma, gateway: h.gateway, clock: h.clock };
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

  /**
   * The three exits of gtm.md §2 added four shapes between them: `charged` on a publish, `trust` on
   * a creator's own profile, and `digest` + `creatorTrust` on a queue card. Each one is nullable or
   * defaulted in the contract, so a client that never sees one is fine — which is exactly why a
   * test that only asserts behaviour would never notice one of them going out malformed.
   */
  it("the publish response, the queue card and the creator's own profile, once a world is submitted", async () => {
    const { token, userId } = await signup(h);
    const created = await call<{ world: { id: string } }>(h, "POST", "/v1/worlds", {
      token,
      body: {
        premise: "Seven rookies, one debut slot, and a leaked group chat",
        genre: "idol", locale: "en", visibility: "private",
      },
    });
    expect(created.status).toBe(201);
    expect((await runJobOnce(deps, "world-build", { trigger: "test" })).error).toBeNull();
    const worldId = created.data.world.id;
    await grantShelfGems(userId);

    // `PublishWorldResZ.charged` — what the shelf cost.
    const published = await call<unknown>(h, "POST", `/v1/worlds/${worldId}/publish`, {
      token, body: { visibility: "public" },
    });
    expect(published.status).toBe(202);
    const publishRes = PublishWorldResZ.parse(published.data);
    expect(publishRes.needsReview).toBe(true);
    expect(publishRes.charged.gems).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);

    // `WorldReviewQueueResZ` with `digest` and `creatorTrust` on the card.
    const queue = await call<unknown>(h, "GET", "/v1/admin/worlds/review");
    expect(queue.status).toBe(200);
    const parsedQueue = WorldReviewQueueResZ.parse(queue.data);
    const card = parsedQueue.worlds.find((w) => w.id === worldId);
    expect(card).toBeDefined();
    expect(card?.creatorTrust, "the reviewer sees the creator's standing").not.toBeNull();
    expect(card?.creatorTrust?.trusted).toBe(false);
    // The digest is advice and may be absent; when present it parses as `ReviewDigestZ`.
    expect(card?.digest === null || Array.isArray(card?.digest?.points)).toBe(true);
    expect(card?.digest?.sampled ?? false).toBe(false);

    // `CreatorProfileResZ.trust` — present for the creator themselves…
    const me = MeResZ.parse((await call<unknown>(h, "GET", "/v1/me", { token })).data);
    const mine = await call<unknown>(h, "GET", `/v1/creators/${me.user.creatorHandle}`, { token });
    const own = CreatorProfileResZ.parse(mine.data);
    expect(own.trust).toEqual({ approvals: 0, trusted: false, toTrusted: WORLD_MODERATION.TRUST_APPROVALS });

    // …and null on anybody else's view of them.
    const stranger = await signup(h);
    const theirs = await call<unknown>(h, "GET", `/v1/creators/${me.user.creatorHandle}`, { token: stranger.token });
    expect(CreatorProfileResZ.parse(theirs.data).trust).toBeNull();
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
