/**
 * What happens to a world **after** it is approved (WORLD_MODERATION).
 *
 * A person approving a world once is not the same as it staying fine. These cases are the ones
 * where getting it wrong costs trust in both directions: a world nobody can get taken down (one
 * angry player, or one player with two reports), and a world anybody can get taken down (a world
 * pulled off the shelf that its own creator can no longer play, or a preset a brigade can pull).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION, WORLD_STUDIO } from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import { budgetFor } from "../src/middleware/rate-limit";
import { pullWorldIfBrigaded } from "../src/services/world-moderation";
import { call, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

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
  id: string; slug: string; status: string; visibility: string; premise: string; isPreset: boolean;
  isMine: boolean; playCount: number; createdAt: string; reason: string | null; pulled: boolean;
}
interface PublicRes { worlds: WorldFull[]; nextCursor: string | null }
interface MineRes { worlds: WorldFull[]; remainingToday: number }
interface PublishRes { world: WorldFull; needsReview: boolean }
interface QueueRow extends WorldFull {
  bibleExcerpt: string;
  cast: { handle: string }[];
  reportCount: number;
  waitingHours: number;
  overdue: boolean;
  reports: { reason: string; note: string; createdAt: string }[];
}
interface QueueRes { worlds: QueueRow[]; overdueCount: number; total: number; nextCursor: string | null }

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";

const buildOnce = async (): Promise<void> => {
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
};

/** A world that made it all the way onto the shelf: built, submitted, approved by a person. */
async function shelvedWorld(premise = PREMISE) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token, body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  await buildOnce();
  const id = created.data.world.id;
  expect((await call(h, "POST", `/v1/worlds/${id}/publish`, { token, body: { visibility: "public" } })).status).toBe(202);
  const approved = await call<PublishRes>(h, "POST", `/v1/admin/worlds/${id}/review`, {
    body: { decision: "approve", reason: "" },
  });
  expect(approved.data.world.status).toBe("published");
  return { token, userId, worldId: id };
}

/** A world that asked to go public and is still waiting for a person. */
async function submittedWorld(premise: string) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token, body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  await buildOnce();
  const id = created.data.world.id;
  await call(h, "POST", `/v1/worlds/${id}/publish`, { token, body: { visibility: "public" } });
  return { token, userId, worldId: id };
}

const reportWorld = async (token: string, worldId: string, note = "this is not okay") =>
  await call<{ id: string; status: string }>(h, "POST", "/v1/moderation/report", {
    token, body: { target: "world", targetId: worldId, reason: "harassment", note },
  });

/** `n` different accounts, each reporting the world once. Returns their tokens. */
async function reporters(worldId: string, n: number): Promise<string[]> {
  const tokens: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const who = await signup(h);
    expect((await reportWorld(who.token, worldId, `complaint ${i}`)).status).toBe(201);
    tokens.push(who.token);
  }
  return tokens;
}

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });

const shelfIds = async (token: string): Promise<string[]> =>
  (await call<PublicRes>(h, "GET", "/v1/worlds/public", { token })).data.worlds.map((w) => w.id);

/* ------------------------------------------------------------------ the pull ---- */

describe("reports have consequences", () => {
  it("takes a world off the shelf at the threshold, and not one reporter before it", async () => {
    const { worldId } = await shelvedWorld();
    const reader = await signup(h);

    // Two people is a disagreement, not a signal. One person can never pull a world down.
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL - 1);
    expect((await worldRow(worldId)).status).toBe("published");
    expect((await worldRow(worldId)).pulledAt).toBeNull();
    expect(await shelfIds(reader.token)).toContain(worldId);

    // The one that crosses it pulls the world in its own transaction — nobody has to notice.
    const last = await signup(h);
    expect((await reportWorld(last.token, worldId)).status).toBe(201);

    const pulled = await worldRow(worldId);
    expect(pulled.status).toBe("review");
    expect(pulled.pulledAt).not.toBeNull();
    expect(pulled.reviewRequestedAt).not.toBeNull();
    // Still public: what changed is "has a person looked at it lately", not "may it be listed".
    expect(pulled.visibility).toBe("public");
    expect(await shelfIds(reader.token)).not.toContain(worldId);
  });

  it("counts distinct reporters, so one account cannot manufacture a takedown", async () => {
    const { worldId } = await shelvedWorld();
    const loud = await signup(h);

    expect((await reportWorld(loud.token, worldId, "first")).status).toBe(201);
    // The duplicate guard refuses the obvious path…
    const again = await reportWorld(loud.token, worldId, "again");
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe("ALREADY_DONE");

    // …and the takedown does not depend on that being the only path to a second row.
    await prisma.report.create({
      data: { userId: loud.userId, target: "world", targetId: worldId, reason: "other", note: "smuggled duplicate" },
    });
    const second = await signup(h);
    await reportWorld(second.token, worldId, "second person");

    // Three open reports, two people: still on the shelf.
    expect(await prisma.report.count({ where: { target: "world", targetId: worldId, status: "open" } }))
      .toBeGreaterThanOrEqual(WORLD_MODERATION.REPORTS_TO_PULL);
    expect((await worldRow(worldId)).status).toBe("published");

    const third = await signup(h);
    await reportWorld(third.token, worldId, "third person");
    expect((await worldRow(worldId)).status).toBe("review");
  });

  it("is idempotent: a world already back in review is not pulled again, and keeps its history", async () => {
    const { token, worldId } = await shelvedWorld();

    // Somebody is mid-game in it before anything happens.
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
      h, "GET", `/v1/worlds/${worldId}`, { token },
    );
    const firstFollowerId = detail.data.characters.find((ch) => ch.canBeFirstFollower)?.id ?? null;
    const player = await signup(h);
    const persona = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", {
      token: player.token,
      body: {
        worldId, handle: "midgame1", displayName: "Mid", bio: "", avatarUrl: null, voiceNotes: "",
        firstFollowerId, idempotencyKey: "idem-midgame-1",
      },
    });
    expect(persona.status).toBe(201);
    const playsBefore = (await worldRow(worldId)).playCount;
    expect(playsBefore).toBeGreaterThan(0);

    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);
    const first = await worldRow(worldId);
    expect(first.pulledAt).not.toBeNull();

    // A fourth reporter, and a direct second call to the pull itself: neither changes anything.
    const fourth = await signup(h);
    await reportWorld(fourth.token, worldId, "piling on");
    const outcome = await prisma.$transaction((tx) => pullWorldIfBrigaded(tx, worldId, h.clock.now()));
    expect(outcome.pulled).toBe(false);

    const after = await worldRow(worldId);
    expect(after.status).toBe("review");
    expect(after.pulledAt?.getTime()).toBe(first.pulledAt?.getTime());
    // Pulling is not deleting: the play count, the cast and the personas are all still there.
    expect(after.playCount).toBe(playsBefore);
    expect(await prisma.worldCharacter.count({ where: { worldId } })).toBe(WORLD_STUDIO.CAST_SIZE);
    expect(await prisma.persona.count({ where: { worldId } })).toBe(1);
  });

  it("leaves a pulled world playable by its creator and by anyone mid-game, and gone from Explore", async () => {
    const { token, worldId } = await shelvedWorld();
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
      h, "GET", `/v1/worlds/${worldId}`, { token },
    );
    const firstFollowerId = detail.data.characters.find((ch) => ch.canBeFirstFollower)?.id ?? null;

    const player = await signup(h);
    expect((await call(h, "POST", "/v1/personas", {
      token: player.token,
      body: {
        worldId, handle: "stayer1", displayName: "Stayer", bio: "", avatarUrl: null, voiceNotes: "",
        firstFollowerId, idempotencyKey: "idem-stayer-1",
      },
    })).status).toBe(201);

    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    // The creator: still theirs, still open, and now told *why* it is in review.
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token })).status).toBe(200);
    const mine = await call<MineRes>(h, "GET", "/v1/worlds/mine", { token });
    const card = mine.data.worlds.find((w) => w.id === worldId);
    expect(card?.status).toBe("review");
    expect(card?.pulled).toBe(true);

    // Mid-game: taking a world out of Explore must not evict somebody from a story they are playing.
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token: player.token })).status).toBe(200);

    // Everyone else: off the shelf, and not openable by id.
    const stranger = await signup(h);
    expect(await shelfIds(stranger.token)).not.toContain(worldId);
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token: stranger.token })).status).toBe(404);
  });

  it("never pulls a preset: presets are ours, and a report on one is for a person to read", async () => {
    const preset = await prisma.world.findFirstOrThrow({ where: { isPreset: true } });
    // A preset genuinely on the shelf — the only guard left is `isPreset`.
    await prisma.world.update({ where: { id: preset.id }, data: { visibility: "public", status: "published" } });

    await reporters(preset.id, WORLD_MODERATION.REPORTS_TO_PULL + 1);

    const after = await worldRow(preset.id);
    expect(after.status).toBe("published");
    expect(after.pulledAt).toBeNull();
    // The reports are still filed — a brigade cannot take it down, but it is still on the record.
    expect(await prisma.report.count({ where: { target: "world", targetId: preset.id, status: "open" } }))
      .toBe(WORLD_MODERATION.REPORTS_TO_PULL + 1);
  });

  it("does not pull a world that was never on the shelf, and tells a stranger nothing about it", async () => {
    const { token } = await signup(h);
    const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
      token, body: { premise: `${PREMISE} in private`, genre: "idol", locale: "en", visibility: "private" },
    });
    await buildOnce();
    const worldId = created.data.world.id;

    // Reporting a private world you cannot see answers exactly what everything else answers.
    const stranger = await signup(h);
    const res = await reportWorld(stranger.token, worldId);
    expect(res.status).toBe(404);
    expect(await prisma.report.count({ where: { targetId: worldId } })).toBe(0);
    expect((await worldRow(worldId)).status).toBe("ready");
  });

  it("is limited like the rest of the write surface — brigading is the attack on a low threshold", () => {
    expect(budgetFor("POST", "/v1/moderation/report")).toBe("write");
  });
});

/* ------------------------------------------------------------- the decision ---- */

describe("reviewing a pulled world", () => {
  it("puts it back on the shelf on approve and closes the reports that were about it", async () => {
    const { worldId } = await shelvedWorld();
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);
    expect((await worldRow(worldId)).status).toBe("review");

    const decision = await call<PublishRes>(h, "POST", `/v1/admin/worlds/${worldId}/review`, {
      body: { decision: "approve", reason: "" },
    });
    expect(decision.status).toBe(200);
    expect(decision.data.world.status).toBe("published");
    expect(decision.data.world.pulled).toBe(false);

    const after = await worldRow(worldId);
    expect(after.pulledAt).toBeNull();
    // Or the queue never empties, and the next single report re-pulls what a person just cleared.
    expect(await prisma.report.count({ where: { target: "world", targetId: worldId, status: "open" } })).toBe(0);
    expect(await prisma.report.count({ where: { target: "world", targetId: worldId, status: "dismissed" } }))
      .toBe(WORLD_MODERATION.REPORTS_TO_PULL);

    const reader = await signup(h);
    expect(await shelfIds(reader.token)).toContain(worldId);

    // …and the count starts again from zero: one new report does not re-pull it.
    const late = await signup(h);
    await reportWorld(late.token, worldId, "still cross");
    expect((await worldRow(worldId)).status).toBe("published");
  });

  it("actions the reports on reject, and hands the world back to its creator", async () => {
    const { token, worldId } = await shelvedWorld();
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    const decision = await call<PublishRes>(h, "POST", `/v1/admin/worlds/${worldId}/review`, {
      body: { decision: "reject", reason: "the complaints were right" },
    });
    expect(decision.data.world.status).toBe("rejected");

    expect(await prisma.report.count({ where: { target: "world", targetId: worldId, status: "open" } })).toBe(0);
    expect(await prisma.report.count({ where: { target: "world", targetId: worldId, status: "actioned" } }))
      .toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    // Rejecting is not deleting either: the creator keeps it.
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token })).status).toBe(200);
    expect((await worldRow(worldId)).visibility).toBe("private");
  });
});

/* -------------------------------------------------------------- the cooldown ---- */

describe("resubmitting a rejected world", () => {
  it("is refused with a reason before the cooldown, and allowed after it", async () => {
    const { token, worldId } = await submittedWorld(`${PREMISE} rejected once`);
    await call(h, "POST", `/v1/admin/worlds/${worldId}/review`, {
      body: { decision: "reject", reason: "reads like a real show" },
    });

    const tooSoon = await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } });
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.error?.message).toContain("turned down");
    expect(tooSoon.error?.message).toMatch(/\d+ hours?/);
    // Refused before the safety gate: a bounced resubmit costs no tokens.
    expect((await worldRow(worldId)).status).toBe("rejected");

    // Still theirs in the meantime — the cooldown is on sharing, not on playing.
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token })).status).toBe(200);

    h.clock.offsetDays(WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS / 24);
    const now = await call<PublishRes>(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } });
    expect(now.status).toBe(202);
    expect(now.data.world.status).toBe("review");
    // A resubmission is a fresh wait, and it is not a takedown.
    expect(now.data.world.pulled).toBe(false);
    expect((await worldRow(worldId)).reviewRequestedAt).not.toBeNull();
  });
});

/* ----------------------------------------------------------------- the queue ---- */

describe("GET /v1/admin/worlds/review", () => {
  it("puts the worst thing first, says how long each has waited, and carries the complaints", async () => {
    // (a) waiting a long time, nobody has complained
    const old = await submittedWorld(`${PREMISE} the long wait`);
    await prisma.world.update({
      where: { id: old.worldId },
      data: { reviewRequestedAt: new Date(h.clock.now().getTime() - (WORLD_MODERATION.REVIEW_SLA_HOURS + 6) * 3600_000) },
    });
    // (b) submitted a moment ago
    const fresh = await submittedWorld(`${PREMISE} just arrived`);
    // (c) live, and the players took it off the shelf
    const pulled = await shelvedWorld(`${PREMISE} pulled down`);
    await reporters(pulled.worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    const queue = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review");
    expect(queue.status).toBe(200);
    expect(queue.data.worlds.map((w) => w.id)).toEqual([pulled.worldId, old.worldId, fresh.worldId]);

    const first = queue.data.worlds[0];
    expect(first?.pulled).toBe(true);
    expect(first?.reportCount).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(first?.reports).toHaveLength(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(first?.reports[0]?.reason).toBe("harassment");
    // Newest complaint first, so the reviewer reads what people objected to, not just the world.
    const times = first?.reports.map((r) => Date.parse(r.createdAt)) ?? [];
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(first?.overdue).toBe(false);
    expect(first?.bibleExcerpt.length).toBeGreaterThan(100);
    expect(first?.cast).toHaveLength(WORLD_STUDIO.CAST_SIZE);

    const waited = queue.data.worlds.find((w) => w.id === old.worldId);
    expect(waited?.overdue).toBe(true);
    expect(waited?.waitingHours).toBeGreaterThan(WORLD_MODERATION.REVIEW_SLA_HOURS);
    expect(queue.data.worlds.find((w) => w.id === fresh.worldId)?.overdue).toBe(false);

    // One overdue in the whole queue, whatever the page shows.
    expect(queue.data.overdueCount).toBe(1);
    expect(queue.data.total).toBe(3);
  });

  it("pages, and reports the queue-wide overdue count on every page", async () => {
    const a = await submittedWorld(`${PREMISE} page one`);
    await prisma.world.update({
      where: { id: a.worldId },
      data: { reviewRequestedAt: new Date(h.clock.now().getTime() - (WORLD_MODERATION.REVIEW_SLA_HOURS + 1) * 3600_000) },
    });
    const b = await submittedWorld(`${PREMISE} page two`);

    const first = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review?limit=1");
    expect(first.data.worlds.map((w) => w.id)).toEqual([a.worldId]);
    expect(first.data.nextCursor).toBe("1");
    expect(first.data.overdueCount).toBe(1);

    const second = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review?limit=1&cursor=1");
    expect(second.data.worlds.map((w) => w.id)).toEqual([b.worldId]);
    expect(second.data.nextCursor).toBeNull();
    expect(second.data.overdueCount).toBe(1);
  });
});

/* ------------------------------------------------------------ the ops signal ---- */

describe("the backlog is visible without anyone remembering to look", () => {
  it("shows up on /v1/cost, the surface an operator already reads", async () => {
    const { worldId } = await shelvedWorld();
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    interface Ops { inReview: number; overdueReviews: number; pulledWorlds: number; openWorldReports: number; slaHours: number }
    const summary = await call<{ moderation: Ops }>(h, "GET", "/v1/cost/summary");
    expect(summary.status).toBe(200);
    expect(summary.data.moderation.inReview).toBe(1);
    expect(summary.data.moderation.pulledWorlds).toBe(1);
    expect(summary.data.moderation.openWorldReports).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(summary.data.moderation.overdueReviews).toBe(0);
    expect(summary.data.moderation.slaHours).toBe(WORLD_MODERATION.REVIEW_SLA_HOURS);

    // Once it has sat there past the SLA, the probe payload says so too.
    await prisma.world.update({
      where: { id: worldId },
      data: { reviewRequestedAt: new Date(h.clock.now().getTime() - (WORLD_MODERATION.REVIEW_SLA_HOURS + 2) * 3600_000) },
    });
    const live = await call<{ moderation: Ops }>(h, "GET", "/v1/cost/live");
    expect(live.data.moderation.overdueReviews).toBe(1);
    expect(live.data.moderation.pulledWorlds).toBe(1);
  });

  it("is counted by the scheduled job, under the lock it already holds", async () => {
    const { worldId } = await shelvedWorld();
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL);

    const record = await runJobOnce(deps, "world-build", { trigger: "test" });
    expect(record.ok).toBe(true);
    expect(record.detail["inReview"]).toBe(1);
    expect(record.detail["pulledWorlds"]).toBe(1);
    expect(record.detail["overdueReviews"]).toBe(0);
  });
});
