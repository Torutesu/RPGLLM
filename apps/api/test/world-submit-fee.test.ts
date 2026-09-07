/**
 * **Exit 1 — charging for the shelf** (gtm.md §2, `services/world-submit-fee.ts`).
 *
 * A world costs $0.32 to generate and $5.00 to review. Selling worlds cannot pay for reading them,
 * so the charge moves to the person asking for a stranger's twenty minutes. These cases pin the
 * four decisions that make that fair rather than merely profitable:
 *
 *  - a creator who cannot pay is told so **before** the gate spends any tokens, and loses nothing;
 *  - nobody pays to be told no — a blocked world is not charged;
 *  - a submission nobody read comes back, and one somebody opened does not;
 *  - a review the creator did not ask for (a pull, an appeal) is never billed to them.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION, WORLD_MODERATION_ENV, WORLD_STUDIO } from "@rpgllm/shared";
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
afterEach(() => {
  for (const key of Object.values(WORLD_MODERATION_ENV)) delete process.env[key];
});

const FEE = WORLD_MODERATION.PUBLIC_SUBMIT_GEMS;
const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";

interface WorldFull { id: string; status: string; visibility: string }
interface PublishRes { world: WorldFull; needsReview: boolean; charged: { gems: number; remaining: number } }

const gemsOf = async (userId: string): Promise<number> =>
  (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).gems;

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });

const g8Calls = (): number => h.gateway.calls.filter((c) => c.generator === "G8").length;

const publish = (token: string, id: string, visibility: string) =>
  call<PublishRes>(h, "POST", `/v1/worlds/${id}/publish`, { token, body: { visibility } });

const decide = (id: string, decision: "approve" | "reject", reason = "") =>
  call<{ world: WorldFull }>(h, "POST", `/v1/admin/worlds/${id}/review`, { body: { decision, reason } });

/** signup → create → build. The wallet is empty afterwards: a starter grant is exactly one world. */
async function builtWorld(premise = PREMISE, packs = 0) {
  const { token, userId } = await signup(h);
  const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
    token, body: { premise, genre: "idol", locale: "en", visibility: "private" },
  });
  expect(created.status).toBe(201);
  expect((await runJobOnce(deps, "world-build", { trigger: "test" })).error).toBeNull();
  if (packs > 0) await grantShelfGems(userId, packs);
  return { token, userId, worldId: created.data.world.id };
}

/* ------------------------------------------------------------------ the price ---- */

describe("a place on the shelf costs gems; building and playing do not", () => {
  it("charges the fee, says so, and puts the world in front of a person", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    expect(await gemsOf(userId), "the starter grant bought exactly one world").toBe(FEE);

    const res = await publish(token, worldId, "public");
    expect(res.status).toBe(202);
    expect(res.data.needsReview).toBe(true);
    expect(res.data.charged).toEqual({ gems: FEE, remaining: 0 });
    expect(await gemsOf(userId)).toBe(0);

    // One ledger row, readable as what it is — the metrics surface counts these.
    const ledger = await prisma.ledgerEntry.findMany({ where: { ref: `world_publish:${worldId}` } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.delta).toBe(-FEE);

    const row = await worldRow(worldId);
    expect(row.status).toBe("review");
    expect(row.publishChargeGems, "the charge stands while a person still owes it a read").toBe(FEE);
    expect(row.publishSubmittedAt).not.toBeNull();
  });

  it("is free to keep private and free to share behind a link", async () => {
    const { token, userId, worldId } = await builtWorld();
    expect(await gemsOf(userId)).toBe(0);

    const unlisted = await publish(token, worldId, "unlisted");
    expect(unlisted.status).toBe(200);
    expect(unlisted.data.charged).toEqual({ gems: 0, remaining: 0 });
    expect(unlisted.data.world.status).toBe("published");

    const priv = await publish(token, worldId, "private");
    expect(priv.status).toBe(200);
    expect(priv.data.charged.gems).toBe(0);
    expect(await gemsOf(userId), "nobody has to read a world that is not on a shelf").toBe(0);
  });

  it("402s an empty wallet before the gate is asked anything, and leaves the world alone", async () => {
    const { token, userId, worldId } = await builtWorld();
    h.gateway.calls.length = 0;

    const res = await publish(token, worldId, "public");
    expect(res.status).toBe(402);
    expect(res.error?.code).toBe("GEMS_REQUIRED");
    expect(res.error?.message).toContain(String(FEE));
    // The gate is a model call in live mode; an unaffordable request must not cost us one.
    expect(g8Calls(), "the price is checked before the gate").toBe(0);

    const row = await worldRow(worldId);
    expect(row.status, "the world is exactly where it was").toBe("ready");
    expect(row.visibility).toBe("private");
    expect(row.publishChargeGems).toBe(0);
    expect(await gemsOf(userId)).toBe(0);

    // And it is still theirs to play — this is a price, not a punishment.
    expect((await call(h, "GET", `/v1/worlds/${worldId}`, { token })).status).toBe(200);
  });

  it("takes nothing from a world the gate blocks: nobody pays to be told no", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    await prisma.world.update({
      where: { id: worldId },
      data: { bible: { en: "detailed torture and dismemberment", ja: "拷問と切断を詳細に" } },
    });

    const res = await publish(token, worldId, "public");
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe("SAFETY_BLOCKED");
    expect(g8Calls(), "the gate did run — it is the thing that said no").toBeGreaterThan(0);
    expect(await gemsOf(userId), "and it cost nothing").toBe(FEE);
    expect((await worldRow(worldId)).publishChargeGems).toBe(0);
  });
});

/* -------------------------------------------------------------- the refund ---- */

describe("a submission nobody read comes back", () => {
  it("refunds a withdrawn submission and reports the movement", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    expect((await publish(token, worldId, "public")).status).toBe(202);
    expect(await gemsOf(userId)).toBe(0);

    const back = await publish(token, worldId, "private");
    expect(back.status).toBe(200);
    // The negative is the point: `remaining` alone cannot say the gems came home.
    expect(back.data.charged).toEqual({ gems: -FEE, remaining: FEE });
    expect(await gemsOf(userId)).toBe(FEE);

    const row = await worldRow(worldId);
    expect(row.publishChargeGems).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { ref: `world_publish_refund:${worldId}` } })).toBe(1);

    // Withdrawing again refunds nothing — the claim on the charge is taken exactly once.
    const again = await publish(token, worldId, "private");
    expect(again.data.charged.gems).toBe(0);
    expect(await gemsOf(userId)).toBe(FEE);
  });

  it("does not refund once a reviewer has opened it", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    await publish(token, worldId, "public");
    expect((await call(h, "POST", `/v1/admin/worlds/${worldId}/claim`, { headers: { "x-reviewer": "kim" } })).status).toBe(200);

    const back = await publish(token, worldId, "private");
    expect(back.status).toBe(200);
    expect(back.data.charged.gems, "somebody spent the time; that is what was bought").toBe(0);
    expect(await gemsOf(userId)).toBe(0);
  });

  it("does not refund after a decision, however the world is moved afterwards", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    await publish(token, worldId, "public");
    expect((await decide(worldId, "approve")).data.world.status).toBe("published");
    expect((await worldRow(worldId)).publishChargeGems, "the read happened").toBe(0);

    await publish(token, worldId, "private");
    expect(await gemsOf(userId)).toBe(0);
  });
});

/* ------------------------------------------------- reviews the creator did not ask for ---- */

describe("only the review a creator asked for is billed to them", () => {
  it("does not charge twice when reports pull a world and a person puts it back", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    await publish(token, worldId, "public");
    await decide(worldId, "approve");
    expect(await gemsOf(userId)).toBe(0);

    // Three distinct reporters take it off the shelf and back into the queue.
    for (let i = 0; i < WORLD_MODERATION.REPORTS_TO_PULL; i += 1) {
      const who = await signup(h);
      expect((await call(h, "POST", "/v1/moderation/report", {
        token: who.token, body: { target: "world", targetId: worldId, reason: "harassment", note: `complaint ${i}` },
      })).status).toBe(201);
    }
    const pulled = await worldRow(worldId);
    expect(pulled.status).toBe("review");
    expect(pulled.pulledAt).not.toBeNull();
    expect(pulled.publishChargeGems, "a pull is not a submission").toBe(0);

    // The creator cannot resubmit it (QA-001), so there is no second charge to make…
    const refused = await publish(token, worldId, "public");
    expect(refused.status).toBe(409);

    // …and the re-approval is free.
    expect((await decide(worldId, "approve")).data.world.status).toBe("published");
    expect(await gemsOf(userId), "the creator paid once, for the review they asked for").toBe(0);
  });

  it("charges a resubmit and never an appeal", async () => {
    const { token, userId, worldId } = await builtWorld(PREMISE, 2);
    await publish(token, worldId, "public");
    await decide(worldId, "reject", "Rule 1: this reads like a real show.");
    expect(await gemsOf(userId)).toBe(FEE);

    // An appeal is the answer to a decision *we* may have got wrong. Charging for our own error is
    // the wrong incentive on both sides of it.
    const appeal = await call<{ world: WorldFull }>(h, "POST", `/v1/worlds/${worldId}/appeal`, {
      token, body: { message: "The names are invented and the format is a genre, not a programme." },
    });
    expect(appeal.status).toBe(200);
    expect(appeal.data.world.status).toBe("review");
    expect(await gemsOf(userId), "an appeal is free").toBe(FEE);

    // A resubmit is a second twenty minutes the creator is asking for, so it costs what the first did.
    await decide(worldId, "reject", "still no");
    h.clock.offsetDays(WORLD_MODERATION.RESUBMIT_COOLDOWN_HOURS / 24);
    const again = await publish(token, worldId, "public");
    expect(again.status).toBe(202);
    expect(again.data.charged.gems).toBe(FEE);
    expect(await gemsOf(userId)).toBe(0);
  });
});

/* ------------------------------------------------------------------ the knob ---- */

describe(`${WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS}`, () => {
  it("changes the price, and zero is a policy rather than a typo", async () => {
    process.env[WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS] = "10";
    const dear = await builtWorld(PREMISE, 1);
    const charged = await publish(dear.token, dear.worldId, "public");
    expect(charged.data.charged.gems).toBe(10);
    expect(await gemsOf(dear.userId)).toBe(FEE - 10);

    // Zero is the one value in `WORLD_MODERATION` that may legitimately be off: a launch
    // promotion, or a market where gems are not sold yet. An empty wallet publishes.
    process.env[WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS] = "0";
    const free = await builtWorld(`${PREMISE} free`);
    expect(await gemsOf(free.userId)).toBe(0);
    const res = await publish(free.token, free.worldId, "public");
    expect(res.status).toBe(202);
    expect(res.data.charged.gems).toBe(0);
    // …and the submission is still counted, so the metrics have a denominator.
    expect((await worldRow(free.worldId)).publishSubmittedAt).not.toBeNull();
  });

  it("falls back to the shipped default on garbage, without taking the studio down", async () => {
    process.env[WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS] = "not-a-number";
    const { token, userId, worldId } = await builtWorld(PREMISE, 1);
    const res = await publish(token, worldId, "public");
    expect(res.status).toBe(202);
    expect(res.data.charged.gems).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);
    expect(await gemsOf(userId)).toBe(0);
  });

  it("tells the studio shelf the price in force, so the button cannot show a stale one", async () => {
    process.env[WORLD_MODERATION_ENV.PUBLIC_SUBMIT_GEMS] = "45";
    const { token } = await builtWorld();
    const mine = await call<{ publicSubmitGems: number }>(h, "GET", "/v1/worlds/mine", { token });
    expect(mine.status).toBe(200);
    // The 402 is authoritative about what is charged; this is what stops the client *displaying* a
    // number that is no longer the number.
    expect(mine.data.publicSubmitGems).toBe(45);
  });

  it("leaves what a world costs to build alone", async () => {
    const { userId } = await builtWorld();
    const spent = await prisma.ledgerEntry.findFirst({ where: { ref: { startsWith: "world:" } } });
    expect(spent?.delta).toBe(-WORLD_STUDIO.GEM_COST);
    expect(await gemsOf(userId)).toBe(WORLD_STUDIO.STARTER_GEMS - WORLD_STUDIO.GEM_COST);
  });
  /**
   * Choosing "Everyone" at create time *is* choosing to publish — the build job walks the finished
   * world through the same shelf charge. Asking only for the build price here let a player spend
   * 120 gems on a world they had told us to put in Explore, watch the settle 402 inside a
   * background job where nobody was listening, and find it quietly private. Worse than the
   * stranded world of QA-003, because this time the money was already taken.
   */
  it("prices a create-for-everyone at the build and the shelf, and refuses it up front", async () => {
    const { token, userId } = await signup(h);
    // One gem short of build + shelf: the starter grant is exactly the build.
    await prisma.wallet.update({
      where: { userId },
      data: { gems: WORLD_STUDIO.GEM_COST + WORLD_MODERATION.PUBLIC_SUBMIT_GEMS - 1 },
    });

    const refused = await call<unknown>(h, "POST", "/v1/worlds", {
      token, body: { premise: PREMISE, genre: "idol", locale: "en", visibility: "public" },
    });
    expect(refused.status, "the build alone is not the price of this create").toBe(402);
    expect(refused.error?.code).toBe("GEMS_REQUIRED");
    expect(refused.error?.message, "and it says what it is short of").toContain("shelf");
    expect(await gemsOf(userId), "a refusal costs nothing").toBe(
      WORLD_STUDIO.GEM_COST + WORLD_MODERATION.PUBLIC_SUBMIT_GEMS - 1,
    );
    expect(await prisma.world.count({ where: { createdBy: userId } })).toBe(0);

    // The same wallet still affords a private world, which costs the build and nothing else.
    const priv = await call<unknown>(h, "POST", "/v1/worlds", {
      token, body: { premise: PREMISE, genre: "idol", locale: "en", visibility: "private" },
    });
    expect(priv.status, "private is the build price, unchanged").toBe(201);
  });

});
