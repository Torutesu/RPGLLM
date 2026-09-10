/**
 * Claiming a world to review it (`WORLD_MODERATION.CLAIM_MINUTES`).
 *
 * Two reviewers spending the same twenty minutes on the same world is waste; a world nobody can
 * reach because the reviewer who took it closed their laptop is worse. So the thing being tested
 * here is that this is a **lease** and behaves like one from both ends: it excludes, it expires by
 * itself, the holder can extend it, a decision releases it, and a world under someone else's claim
 * is still in the queue — last, not gone.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION } from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import { call, grantShelfGems, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

let h: Harness;
let deps: JobDeps;

beforeAll(() => {
  h = makeHarness();
  deps = { prisma: h.prisma, gateway: h.gateway, clock: h.clock };
});
beforeEach(async () => {
  await resetDatabase();
  h.clock.reset();
  h.gateway.setMode("replay");
  h.gateway.calls.length = 0;
});

/* ------------------------------------------------------------------ helpers ---- */

interface WorldFull {
  id: string;
  slug: string;
  status: string;
}
interface ClaimRes {
  worldId: string;
  claimedUntil: string;
  claimedByYou: boolean;
}
interface QueueRow extends WorldFull {
  claimedBy: string | null;
  claimedUntil: string | null;
}
interface QueueRes {
  worlds: QueueRow[];
  total: number;
  overdueCount: number;
  appealCount: number;
}

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";
const MINUTE_DAYS = 1 / (24 * 60);

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });

const claim = (worldId: string, reviewer: string) =>
  call<ClaimRes>(h, "POST", `/v1/admin/worlds/${worldId}/claim`, { headers: { "x-reviewer": reviewer } });

const queueFor = (reviewer: string) =>
  call<QueueRes>(h, "GET", "/v1/admin/worlds/review", { headers: { "x-reviewer": reviewer } });

const decide = (worldId: string, decision: "approve" | "reject", reason = "") =>
  call<{ world: WorldFull }>(h, "POST", `/v1/admin/worlds/${worldId}/review`, { body: { decision, reason } });

/** A world in the queue, waiting for a person. */
async function submittedWorld(premise: string) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token,
    body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
  // The shelf costs gems on top of the world (gtm.md §2 exit 1); a fresh account has none left.
  await grantShelfGems(userId, 4);
  const worldId = created.data.world.id;
  expect(
    (await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } })).status,
  ).toBe(202);
  return { token, userId, worldId };
}

/* ---------------------------------------------------------------- exclusion ---- */

describe("POST /v1/admin/worlds/:id/claim", () => {
  it("holds the world for one reviewer and tells the next one who has it", async () => {
    const { worldId } = await submittedWorld(PREMISE);

    const kim = await claim(worldId, "kim");
    expect(kim.status).toBe(200);
    expect(kim.data.claimedByYou).toBe(true);
    const held = Date.parse(kim.data.claimedUntil) - h.clock.now().getTime();
    expect(held).toBeGreaterThan((WORLD_MODERATION.CLAIM_MINUTES - 1) * 60_000);
    expect(held).toBeLessThanOrEqual(WORLD_MODERATION.CLAIM_MINUTES * 60_000);

    const ada = await claim(worldId, "ada");
    expect(ada.status).toBe(409);
    // The loser has to *find out* — who has it, and how long before it frees up.
    expect(ada.error?.message).toContain("kim");
    expect(ada.error?.message).toMatch(/\d+ minutes?/);
    expect((await worldRow(worldId)).claimedBy).toBe("kim");
  });

  it("expires on its own — nobody has to release a world for the queue to keep working", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    expect((await claim(worldId, "kim")).status).toBe(200);
    expect((await claim(worldId, "ada")).status).toBe(409);

    // Kim closed her laptop. No sweep runs, no endpoint is called; the lease simply lapses.
    h.clock.offsetDays((WORLD_MODERATION.CLAIM_MINUTES + 1) * MINUTE_DAYS);
    const ada = await claim(worldId, "ada");
    expect(ada.status).toBe(200);
    expect((await worldRow(worldId)).claimedBy).toBe("ada");
  });

  it("extends the lease when the same reviewer claims again", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    const first = await claim(worldId, "kim");
    h.clock.offsetDays(10 * MINUTE_DAYS);

    const again = await claim(worldId, "kim");
    expect(again.status).toBe(200);
    // A long read does not lose the world halfway through it.
    expect(Date.parse(again.data.claimedUntil)).toBeGreaterThan(Date.parse(first.data.claimedUntil));
    expect((await claim(worldId, "ada")).status).toBe(409);
  });

  it("releases the claim when the world is decided", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    expect((await claim(worldId, "kim")).status).toBe(200);

    await decide(worldId, "approve");
    const row = await worldRow(worldId);
    expect(row.claimedBy).toBeNull();
    expect(row.claimedUntil).toBeNull();

    // And there is nothing left to claim: it is not in the queue any more.
    const late = await claim(worldId, "ada");
    expect(late.status).toBe(409);
    expect(late.error?.message).toContain("not awaiting review");
  });

  it("404s a world that does not exist", async () => {
    expect((await claim("no-such-world", "kim")).status).toBe(404);
  });

  it("produces exactly one winner when four reviewers claim at the same instant", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    const names = ["kim", "ada", "rin", "sam"];

    const results = await Promise.all(names.map((name) => claim(worldId, name)));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    // Everyone else is told no, rather than told yes about a world they do not hold.
    expect(results.filter((r) => r.status === 409)).toHaveLength(names.length - 1);

    const row = await worldRow(worldId);
    expect(names).toContain(row.claimedBy);
    for (const loser of results.filter((r) => r.status === 409)) {
      expect(loser.error?.message).toContain(row.claimedBy!);
    }
  });
});

/* -------------------------------------------------------------- in the queue ---- */

describe("a claimed world in the queue", () => {
  it("sorts last for everybody else and stays exactly where it was for its holder", async () => {
    const first = await submittedWorld(`${PREMISE} waiting longest`);
    await prisma.world.update({
      where: { id: first.worldId },
      data: { reviewRequestedAt: new Date(h.clock.now().getTime() - 3 * 3600_000) },
    });
    const second = await submittedWorld(`${PREMISE} waiting less`);

    expect((await queueFor("ada")).data.worlds.map((w) => w.id)).toEqual([first.worldId, second.worldId]);
    expect((await claim(first.worldId, "kim")).status).toBe(200);

    const ada = await queueFor("ada");
    // Last, not hidden: a queue whose length depends on who is looking is not a queue, and a stale
    // claim has to stay visible to whoever might need to override it.
    expect(ada.data.worlds.map((w) => w.id)).toEqual([second.worldId, first.worldId]);
    expect(ada.data.total).toBe(2);
    const claimed = ada.data.worlds.find((w) => w.id === first.worldId);
    expect(claimed?.claimedBy).toBe("kim");
    expect(Date.parse(claimed?.claimedUntil ?? "")).toBeGreaterThan(h.clock.now().getTime());
    expect(ada.data.worlds.find((w) => w.id === second.worldId)?.claimedBy).toBeNull();

    // Kim's own claim does not push her own world down her own queue.
    expect((await queueFor("kim")).data.worlds.map((w) => w.id)).toEqual([first.worldId, second.worldId]);

    // Once the lease lapses it is nobody's again, for everyone.
    h.clock.offsetDays((WORLD_MODERATION.CLAIM_MINUTES + 1) * MINUTE_DAYS);
    const after = await queueFor("ada");
    expect(after.data.worlds.map((w) => w.id)).toEqual([first.worldId, second.worldId]);
    expect(after.data.worlds.find((w) => w.id === first.worldId)?.claimedBy).toBeNull();
  });

  it("counts as claimed on the ops surface only while the lease is live", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    interface Ops {
      inReview: number;
      claimedWorlds: number;
      claimMinutes: number;
    }
    const before = await call<{ moderation: Ops }>(h, "GET", "/v1/cost/live");
    expect(before.data.moderation.claimedWorlds).toBe(0);
    expect(before.data.moderation.claimMinutes).toBe(WORLD_MODERATION.CLAIM_MINUTES);

    await claim(worldId, "kim");
    expect((await call<{ moderation: Ops }>(h, "GET", "/v1/cost/live")).data.moderation.claimedWorlds).toBe(1);

    h.clock.offsetDays((WORLD_MODERATION.CLAIM_MINUTES + 1) * MINUTE_DAYS);
    expect((await call<{ moderation: Ops }>(h, "GET", "/v1/cost/live")).data.moderation.claimedWorlds).toBe(0);
  });
});
