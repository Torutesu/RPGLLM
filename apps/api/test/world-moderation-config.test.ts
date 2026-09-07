/**
 * The moderation thresholds are guesses, and they are overridable (`WORLD_MODERATION_ENV`).
 *
 * Every number in `WORLD_MODERATION` was picked for a product with no users, and the first week of
 * real report rates will disagree with all four. So each one can be set per deploy — and each one
 * bounds content moderation, which means the failure modes matter as much as the feature: a typo
 * must not take the API down, and must not silently become `0` and pull every world on its first
 * report. These cases pin both halves: an override actually changes behaviour, and a bad value is
 * ignored in favour of the shipped default.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION, WORLD_MODERATION_ENV } from "@rpgllm/shared";
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

/** Every key this file touches goes back exactly as it was, whatever the case did. */
const KEYS = Object.values(WORLD_MODERATION_ENV);
afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});
const setEnv = (key: string, value: string): void => {
  process.env[key] = value;
};

/* ------------------------------------------------------------------ helpers ---- */

interface WorldFull { id: string; slug: string; status: string }
interface QueueRow extends WorldFull { overdue: boolean; waitingHours: number }
interface QueueRes { worlds: QueueRow[]; overdueCount: number; appealCount: number }
interface Ops {
  inReview: number; overdueReviews: number; pulledWorlds: number; appealedWorlds: number;
  claimedWorlds: number; slaHours: number; reportsToPull: number; resubmitCooldownHours: number;
  claimMinutes: number; appealsPerRejection: number;
}

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";
const MINUTE_DAYS = 1 / (24 * 60);

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });
const ops = async (): Promise<Ops> => (await call<{ moderation: Ops }>(h, "GET", "/v1/cost/live")).data.moderation;

const decide = (worldId: string, decision: "approve" | "reject", reason = "") =>
  call<{ world: WorldFull }>(h, "POST", `/v1/admin/worlds/${worldId}/review`, { body: { decision, reason } });

async function submittedWorld(premise: string) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token, body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
  // The shelf costs gems on top of the world (gtm.md §2 exit 1); a fresh account has none left.
  await grantShelfGems(userId, 4);
  const worldId = created.data.world.id;
  expect((await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } })).status).toBe(202);
  return { token, userId, worldId };
}

/** A world that made it onto the shelf. */
async function shelvedWorld(premise = PREMISE) {
  const world = await submittedWorld(premise);
  expect((await decide(world.worldId, "approve")).data.world.status).toBe("published");
  return world;
}

/** `n` different accounts, each reporting the world once. */
async function reporters(worldId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const who = await signup(h);
    const res = await call(h, "POST", "/v1/moderation/report", {
      token: who.token, body: { target: "world", targetId: worldId, reason: "harassment", note: `complaint ${i}` },
    });
    expect(res.status).toBe(201);
  }
}

/* ------------------------------------------------------- each one does something ---- */

describe("an override changes what the code does", () => {
  it("WORLD_REPORTS_TO_PULL: a lower threshold pulls a world sooner", async () => {
    const { worldId } = await shelvedWorld();
    setEnv(WORLD_MODERATION_ENV.REPORTS_TO_PULL, "2");

    await reporters(worldId, 1);
    expect((await worldRow(worldId)).status).toBe("published");
    // Two would not have been enough at the shipped default of three.
    await reporters(worldId, 1);
    expect((await worldRow(worldId)).status).toBe("review");
    expect((await ops()).reportsToPull).toBe(2);
  });

  it("WORLD_REVIEW_SLA_HOURS: a shorter SLA makes a shorter wait overdue", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    await prisma.world.update({
      where: { id: worldId },
      data: { reviewRequestedAt: new Date(h.clock.now().getTime() - 2 * 3600_000) },
    });

    // Two hours is nothing against the default 24.
    expect((await call<QueueRes>(h, "GET", "/v1/admin/worlds/review")).data.overdueCount).toBe(0);

    setEnv(WORLD_MODERATION_ENV.REVIEW_SLA_HOURS, "1");
    const queue = await call<QueueRes>(h, "GET", "/v1/admin/worlds/review");
    expect(queue.data.overdueCount).toBe(1);
    expect(queue.data.worlds.find((w) => w.id === worldId)?.overdue).toBe(true);
    const live = await ops();
    expect(live.overdueReviews).toBe(1);
    expect(live.slaHours).toBe(1);
  });

  it("WORLD_RESUBMIT_COOLDOWN_HOURS: a shorter cooldown lets a resubmit through sooner", async () => {
    const { token, worldId } = await submittedWorld(PREMISE);
    await decide(worldId, "reject", "Rule 1: too close to a real show.");
    setEnv(WORLD_MODERATION_ENV.RESUBMIT_COOLDOWN_HOURS, "1");

    const tooSoon = await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } });
    expect(tooSoon.status).toBe(409);
    // The creator is told the wait that is actually in force, not the one in the constants file.
    expect(tooSoon.error?.message).toContain("1 hour");

    h.clock.offsetDays(1 / 24);
    const again = await call(h, "POST", `/v1/worlds/${worldId}/publish`, { token, body: { visibility: "public" } });
    expect(again.status).toBe(202);
    expect((await ops()).resubmitCooldownHours).toBe(1);
  });

  it("WORLD_CLAIM_MINUTES: a shorter lease frees the world sooner", async () => {
    const { worldId } = await submittedWorld(PREMISE);
    setEnv(WORLD_MODERATION_ENV.CLAIM_MINUTES, "1");

    const kim = await call<{ claimedUntil: string }>(h, "POST", `/v1/admin/worlds/${worldId}/claim`, {
      headers: { "x-reviewer": "kim" },
    });
    expect(kim.status).toBe(200);
    expect(Date.parse(kim.data.claimedUntil) - h.clock.now().getTime()).toBeLessThanOrEqual(60_000);

    h.clock.offsetDays(2 * MINUTE_DAYS);
    // At the default twenty minutes this would still be kim's.
    const ada = await call(h, "POST", `/v1/admin/worlds/${worldId}/claim`, { headers: { "x-reviewer": "ada" } });
    expect(ada.status).toBe(200);
    expect((await ops()).claimMinutes).toBe(1);
  });
});

/* ------------------------------------------------------------- bad values ---- */

describe("a value that is not a threshold is ignored", () => {
  it.each([
    ["banana", "not a number at all"],
    ["0", "the value a typo expands to, and dangerous on every one of these"],
    ["-3", "negative"],
    ["1.5", "not a whole reporter"],
    ["", "set but empty, which is how a missing template variable arrives"],
  ])("falls back to the shipped default for %s (%s)", async (value) => {
    for (const key of KEYS) setEnv(key, value);

    const live = await ops();
    expect(live.reportsToPull).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(live.slaHours).toBe(WORLD_MODERATION.REVIEW_SLA_HOURS);
    expect(live.resubmitCooldownHours).toBe(WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS);
    expect(live.claimMinutes).toBe(WORLD_MODERATION.CLAIM_MINUTES);
  });

  it("keeps moderating on the default while the bad value is in force", async () => {
    const { worldId } = await shelvedWorld();
    setEnv(WORLD_MODERATION_ENV.REPORTS_TO_PULL, "nonsense");

    // Not one reporter short of the *default*, and not "everything pulls because zero".
    await reporters(worldId, WORLD_MODERATION.REPORTS_TO_PULL - 1);
    expect((await worldRow(worldId)).status).toBe("published");
    await reporters(worldId, 1);
    expect((await worldRow(worldId)).status).toBe("review");
  });
});

/* --------------------------------------------------------- the ops surface ---- */

describe("what is actually in force is visible to an operator", () => {
  it("reports the shipped defaults when nothing is set", async () => {
    const live = await ops();
    expect(live.slaHours).toBe(WORLD_MODERATION.REVIEW_SLA_HOURS);
    expect(live.reportsToPull).toBe(WORLD_MODERATION.REPORTS_TO_PULL);
    expect(live.resubmitCooldownHours).toBe(WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS);
    expect(live.claimMinutes).toBe(WORLD_MODERATION.CLAIM_MINUTES);
    // No env key: more than one appeal per decision is a policy change, not a dial.
    expect(live.appealsPerRejection).toBe(WORLD_MODERATION.APPEALS_PER_REJECTION);
  });

  it("reports the overrides, on the summary an operator already reads", async () => {
    setEnv(WORLD_MODERATION_ENV.REPORTS_TO_PULL, "5");
    setEnv(WORLD_MODERATION_ENV.REVIEW_SLA_HOURS, "6");
    setEnv(WORLD_MODERATION_ENV.RESUBMIT_COOLDOWN_HOURS, "48");
    setEnv(WORLD_MODERATION_ENV.CLAIM_MINUTES, "45");

    const summary = await call<{ moderation: Ops }>(h, "GET", "/v1/cost/summary");
    expect(summary.status).toBe(200);
    expect(summary.data.moderation.reportsToPull).toBe(5);
    expect(summary.data.moderation.slaHours).toBe(6);
    expect(summary.data.moderation.resubmitCooldownHours).toBe(48);
    expect(summary.data.moderation.claimMinutes).toBe(45);
  });

  it("counts the queue by what people are waiting for, not just by its length", async () => {
    const plain = await submittedWorld(`${PREMISE} plain`);
    const appealed = await submittedWorld(`${PREMISE} appealed`);
    await decide(appealed.worldId, "reject", "Rule 1: too close to a real show.");
    const sent = await call(h, "POST", `/v1/worlds/${appealed.worldId}/appeal`, {
      token: appealed.token, body: { message: "The names are invented and the format is a genre." },
    });
    expect(sent.status).toBe(200);

    const live = await ops();
    expect(live.inReview).toBe(2);
    expect(live.appealedWorlds).toBe(1);
    expect(live.pulledWorlds).toBe(0);
    expect((await call<QueueRes>(h, "GET", "/v1/admin/worlds/review")).data.appealCount).toBe(1);
    expect(plain.worldId).not.toBe(appealed.worldId);
  });
});
