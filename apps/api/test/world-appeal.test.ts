/**
 * Appealing a rejection (`WORLD_MODERATION.APPEALS_PER_REJECTION`, `docs/moderation.md` §7).
 *
 * The runbook tells reviewers to reject when they are unsure, so wrong rejections are a designed-in
 * cost rather than an accident. What these cases pin is the shape of the answer to one: a creator
 * can say "you read this wrong" **once per decision**, a person sees the message next to the reason
 * they are arguing with, and neither side can turn that into a lever — no infinite appeals, no
 * second appeal bought by being rejected twice, and no cooldown standing in front of the first one.
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
  visibility: string;
  premise: string;
  reason: string | null;
  pulled: boolean;
  canAppeal: boolean;
  appealed: boolean;
}
interface PublishRes {
  world: WorldFull;
  needsReview: boolean;
}
interface AppealRes {
  world: WorldFull;
}
interface MineRes {
  worlds: WorldFull[];
  remainingToday: number;
}
interface QueueRow extends WorldFull {
  reportCount: number;
  appeal: { message: string; createdAt: string; previousReason: string } | null;
}
interface QueueRes {
  worlds: QueueRow[];
  overdueCount: number;
  appealCount: number;
  total: number;
}

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";
const REASON = "Rule 1: this reads like a real show with the names changed.";
const CASE = "The names are invented and the format is a genre, not a specific programme.";

const buildOnce = async (): Promise<void> => {
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
};

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });

const decide = (worldId: string, decision: "approve" | "reject", reason = "") =>
  call<PublishRes>(h, "POST", `/v1/admin/worlds/${worldId}/review`, { body: { decision, reason } });

const appeal = (token: string, worldId: string, message = CASE) =>
  call<AppealRes>(h, "POST", `/v1/worlds/${worldId}/appeal`, { token, body: { message } });

const mine = async (token: string, worldId: string): Promise<WorldFull> => {
  const res = await call<MineRes>(h, "GET", "/v1/worlds/mine", { token });
  return res.data.worlds.find((w) => w.id === worldId)!;
};

/** A world that asked to go public and is waiting for a person. */
async function submittedWorld(premise: string) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token,
    body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  await buildOnce();
  // The shelf costs gems on top of the world (gtm.md §2 exit 1); a fresh account has none left.
  await grantShelfGems(userId, 4);
  const worldId = created.data.world.id;
  expect(
    (await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } })).status,
  ).toBe(202);
  return { token, userId, worldId };
}

/** …and then a person turned it down. */
async function rejectedWorld(premise = PREMISE, reason = REASON) {
  const world = await submittedWorld(premise);
  expect((await decide(world.worldId, "reject", reason)).data.world.status).toBe("rejected");
  return world;
}

/* ------------------------------------------------------------- who may appeal ---- */

describe("POST /v1/worlds/:id/appeal", () => {
  it("is offered to the creator of a rejected world, and to nobody else", async () => {
    const { token, worldId } = await rejectedWorld();

    // The offer is on the world itself, so a screen does not have to infer it.
    const rejected = await mine(token, worldId);
    expect(rejected.status).toBe("rejected");
    expect(rejected.reason).toBe(REASON);
    expect(rejected.canAppeal).toBe(true);
    expect(rejected.appealed).toBe(false);

    // Somebody else's rejected world does not exist, exactly as everywhere else in the studio.
    const stranger = await signup(h);
    const theirs = await appeal(stranger.token, worldId);
    expect(theirs.status).toBe(404);
    expect((await worldRow(worldId)).status).toBe("rejected");
  });

  it("refuses a world that has not been turned down — there is no decision to argue with", async () => {
    const waiting = await submittedWorld(`${PREMISE} still waiting`);
    const early = await appeal(waiting.token, waiting.worldId);
    expect(early.status).toBe(409);
    expect(early.error?.message).toContain("no decision");
    expect((await worldRow(waiting.worldId)).appealsUsed).toBe(0);

    // And an approved one: a published world is not owed a hearing about being published.
    await decide(waiting.worldId, "approve");
    expect((await appeal(waiting.token, waiting.worldId)).status).toBe(409);
  });

  it("refuses a message that is only whitespace — a person has to read this one", async () => {
    const { token, worldId } = await rejectedWorld(`${PREMISE} empty case`);
    const blank = await appeal(token, worldId, "            ");
    expect(blank.status).toBe(400);
    expect((await worldRow(worldId)).appealsUsed).toBe(0);
    // The offer survives a bad attempt: nothing was spent.
    expect((await mine(token, worldId)).canAppeal).toBe(true);
  });
});

/* ------------------------------------------------------ what the reviewer sees ---- */

describe("an appealed world in the queue", () => {
  it("carries the creator's message and the reason it was rejected for", async () => {
    const { token, worldId } = await rejectedWorld();
    const sent = await appeal(token, worldId);
    expect(sent.status).toBe(200);
    expect(sent.data.world.status).toBe("review");
    // Used, and used up — and this is the state a reopened screen reads as "being looked at".
    expect(sent.data.world.appealed).toBe(true);
    expect(sent.data.world.canAppeal).toBe(false);
    // An appeal is not a takedown, and not a fresh submission either.
    expect(sent.data.world.pulled).toBe(false);

    const queue = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review");
    const card = queue.data.worlds.find((w) => w.id === worldId);
    expect(card?.appeal?.message).toBe(CASE);
    // The whole point: the reviewer is looking at a decision being argued with.
    expect(card?.appeal?.previousReason).toBe(REASON);
    expect(queue.data.appealCount).toBe(1);

    // The wait restarts when it joins the queue — an appeal sitting for three days is exactly the
    // failure `overdueCount` exists to make visible.
    const row = await worldRow(worldId);
    expect(row.reviewRequestedAt?.getTime()).toBeGreaterThanOrEqual(row.reviewedAt!.getTime());
  });

  it("ranks with the pulled worlds, not behind the fresh submissions", async () => {
    // (a) submitted first and still waiting — no one is arguing with anything
    const fresh = await submittedWorld(`${PREMISE} plain submission`);
    // (b) rejected, then appealed: a person is waiting on a second look
    const appealed = await rejectedWorld(`${PREMISE} appealed`);
    await appeal(appealed.token, appealed.worldId);
    // (c) live, and the players took it off the shelf
    const pulled = await submittedWorld(`${PREMISE} pulled down`);
    await decide(pulled.worldId, "approve");
    for (let i = 0; i < WORLD_MODERATION.REPORTS_TO_PULL; i += 1) {
      const who = await signup(h);
      await call(h, "POST", "/v1/moderation/report", {
        token: who.token,
        body: { target: "world", targetId: pulled.worldId, reason: "harassment", note: `no ${i}` },
      });
    }

    const queue = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review");
    expect(queue.data.worlds.map((w) => w.id)).toEqual([pulled.worldId, appealed.worldId, fresh.worldId]);
    expect(queue.data.appealCount).toBe(1);
  });
});

/* ---------------------------------------------------------- once per rejection ---- */

describe("one appeal per decision", () => {
  it("refuses a second appeal against the same rejection", async () => {
    const { token, worldId } = await rejectedWorld();
    expect((await appeal(token, worldId)).status).toBe(200);
    // It is back in the queue, so this also covers "not rejected any more"; either way the answer
    // to a second appeal is the same one.
    const again = await appeal(token, worldId, "please, one more look at this");
    expect(again.status).toBe(409);
    expect((await worldRow(worldId)).appealsUsed).toBe(WORLD_MODERATION.APPEALS_PER_REJECTION);
    // The message the reviewer reads is still the first one — a refused appeal cannot overwrite it.
    expect((await worldRow(worldId)).appealMessage).toBe(CASE);
  });

  it("publishes the world when the reviewer agrees", async () => {
    const { token, worldId } = await rejectedWorld();
    await appeal(token, worldId);

    const approved = await decide(worldId, "approve");
    expect(approved.data.world.status).toBe("published");

    const row = await worldRow(worldId);
    expect(row.visibility).toBe("public");
    expect(row.appealedAt).toBeNull();
    // On the shelf, which is what the creator was asking for.
    const reader = await signup(h);
    const shelf = await call<{ worlds: WorldFull[] }>(h, "GET", "/v1/worlds/public", { token: reader.token });
    expect(shelf.data.worlds.map((w) => w.id)).toContain(worldId);
  });

  it("ends the appeal when the reviewer disagrees, and does not grant another", async () => {
    const { token, worldId } = await rejectedWorld();
    await appeal(token, worldId);

    const upheld = await decide(worldId, "reject", "Rule 1 again: read on appeal, same answer.");
    expect(upheld.data.world.status).toBe("rejected");

    const after = await mine(token, worldId);
    expect(after.appealed).toBe(true);
    // A second rejection is not a second decision to appeal — it is the same argument, finished.
    expect(after.canAppeal).toBe(false);
    expect(after.reason).toContain("same answer");
    expect((await appeal(token, worldId, "but you did not read it properly")).status).toBe(409);
  });
});

/* ---------------------------------------------------------------- the cooldown ---- */

describe("an appeal is not a resubmit", () => {
  it("skips the cooldown that a resubmit waits out", async () => {
    const { token, worldId } = await rejectedWorld();

    // The same world offered again, immediately: refused, with the wait spelled out.
    const resubmit = await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } });
    expect(resubmit.status).toBe(409);
    expect(resubmit.error?.message).toContain("turned down");

    // The same world *argued about*, immediately: heard.
    expect((await appeal(token, worldId)).status).toBe(200);
    expect((await worldRow(worldId)).status).toBe("review");
  });

  it("gives the next rejection its own appeal only after a genuine resubmit", async () => {
    const { token, worldId } = await rejectedWorld();
    await appeal(token, worldId);
    await decide(worldId, "reject", "still no");
    expect((await mine(token, worldId)).canAppeal).toBe(false);

    // The cooldown runs from the decision that closed the appeal, not from the first rejection.
    expect(
      (await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } })).status,
    ).toBe(409);
    h.clock.offsetDays(WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS / 24);
    const resubmitted = await call<PublishRes>(h, "POST", `/v1/worlds/${worldId}/publish`, {
      token,
      body: { visibility: "public" },
    });
    expect(resubmitted.status).toBe(202);
    // A new cycle: the queue card is a submission again, with no appeal attached to it.
    const queue = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review");
    expect(queue.data.worlds.find((w) => w.id === worldId)?.appeal).toBeNull();
    expect(queue.data.appealCount).toBe(0);

    // …and the decision on *that* submission is a decision of its own, appealable once.
    await decide(worldId, "reject", "a new reason, on a new reading");
    const afresh = await mine(token, worldId);
    expect(afresh.canAppeal).toBe(true);
    expect(afresh.appealed).toBe(false);
    expect((await appeal(token, worldId, "one more time, about the new reason")).status).toBe(200);
  });
});
