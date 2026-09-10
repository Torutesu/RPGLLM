/**
 * **Exit 2 — trust** (gtm.md §2「信頼度の階段」, `services/creator-trust.ts`).
 *
 * This is the exit that bends the curve and the exit that can hurt somebody: a sampled world goes
 * live with nobody having read it. So the cases here are mostly about the *limits*, not the saving:
 *
 *  - trust is earned at the threshold, and a rejection takes it away;
 *  - the first submission after graduating is always read;
 *  - a world the gate asked for a closer read on is never sampled;
 *  - a creator with a world pulled off the shelf publishes to a person again, immediately, without
 *    losing the standing a brigade did not earn;
 *  - and the number is the creator's own business: it is never on another player's view of them.
 *
 * `WORLD_TRUST_SAMPLE_EVERY` is the lever these drive. `1` draws every submission (the kill switch:
 * trust changes nothing); a very large value draws essentially none, which is how a sampled-away
 * submission is made deterministic without knowing the server's draw secret.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_MODERATION, WORLD_MODERATION_ENV } from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import { drawnForFullRead, samplingDecision, trustOf } from "../src/services/creator-trust";
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

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";
/** Big enough that the draw essentially never picks a world — "sampled away", deterministically. */
const NEVER_DRAWN = "100000";

interface WorldFull {
  id: string;
  status: string;
  visibility: string;
}
interface PublishRes {
  world: WorldFull;
  needsReview: boolean;
  charged: { gems: number };
}
interface Profile {
  handle: string;
  isYou: boolean;
  trust: { approvals: number; trusted: boolean; toTrusted: number | null } | null;
}
interface QueueRow extends WorldFull {
  creatorTrust: Profile["trust"];
  digest: { sampled: boolean } | null;
}
interface QueueRes {
  worlds: QueueRow[];
}

const worldRow = (id: string) => prisma.world.findUniqueOrThrow({ where: { id } });
const userRow = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });

const publish = (token: string, id: string, visibility = "public") =>
  call<PublishRes>(h, "POST", `/v1/worlds/${id}/publish`, { token, body: { visibility } });

const decide = (id: string, decision: "approve" | "reject", reason = "") =>
  call<{ world: WorldFull }>(h, "POST", `/v1/admin/worlds/${id}/review`, { body: { decision, reason } });

const queue = () => call<QueueRes>(h, "GET", "/v1/admin/worlds/review");

const profile = (token: string, handle: string) => call<Profile>(h, "GET", `/v1/creators/${handle}`, { token });

/** One account, and a way to keep building worlds for it. Gems are topped up for every shelf fee. */
async function creator() {
  const { token, userId } = await signup(h);
  let n = 0;
  const build = async (): Promise<string> => {
    n += 1;
    const created = await call<{ world: WorldFull }>(h, "POST", "/v1/worlds", {
      token,
      body: { premise: `${PREMISE} number ${n}`, genre: "idol", locale: "en", visibility: "private" },
    });
    expect(created.status, JSON.stringify(created.error)).toBe(201);
    expect((await runJobOnce(deps, "world-build", { trigger: "test" })).error).toBeNull();
    // The daily cap is a spend limit, not a quota of successes — these cases need more than three.
    await prisma.world.updateMany({
      where: { createdBy: userId },
      data: { createdAt: new Date(h.clock.now().getTime() - 2 * 24 * 3_600_000) },
    });
    await grantShelfGems(userId, 4);
    return created.data.world.id;
  };
  const handle = (await userRow(userId)).creatorHandle;
  return { token, userId, handle, build };
}

/** Earn `n` approvals: build, submit, and have a person say yes. */
async function approvals(who: Awaited<ReturnType<typeof creator>>, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const id = await who.build();
    expect((await publish(who.token, id)).status).toBe(202);
    expect((await decide(id, "approve")).data.world.status).toBe("published");
  }
}

/* ------------------------------------------------------------- earning it ---- */

describe("trust is earned, and it is the creator's own business", () => {
  it("counts approvals up to the threshold and flips at it", async () => {
    const who = await creator();
    const need = WORLD_MODERATION.TRUST_APPROVALS;

    const fresh = await profile(who.token, who.handle);
    expect(fresh.data.trust).toEqual({ approvals: 0, trusted: false, toTrusted: need });

    await approvals(who, need - 1);
    const nearly = await profile(who.token, who.handle);
    expect(nearly.data.trust).toEqual({ approvals: need - 1, trusted: false, toTrusted: 1 });

    await approvals(who, 1);
    const trusted = await profile(who.token, who.handle);
    // `toTrusted` is null once there is nothing left to earn — a countdown, not a score.
    expect(trusted.data.trust).toEqual({ approvals: need, trusted: true, toTrusted: null });
  });

  it("is never on another account's view of a creator", async () => {
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);

    const stranger = await signup(h);
    const theirs = await profile(stranger.token, who.handle);
    expect(theirs.status).toBe(200);
    expect(theirs.data.isYou).toBe(false);
    // A public badge saying "this person's worlds go live unread" is a shopping list.
    expect(theirs.data.trust).toBeNull();
    // The page is otherwise the same page.
    expect(theirs.data.handle).toBe(who.handle);
  });

  it("shows the reviewer the standing of the creator whose card they are reading", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = "1";
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);
    const id = await who.build();
    await publish(who.token, id);

    const row = (await queue()).data.worlds.find((w) => w.id === id);
    expect(row?.creatorTrust?.trusted).toBe(true);
    expect(row?.creatorTrust?.approvals).toBe(WORLD_MODERATION.TRUST_APPROVALS);
  });
});

/* --------------------------------------------------------------- sampling ---- */

describe("a trusted creator's submissions are sampled", () => {
  it("reads the first one after graduating, then lets the undrawn ones go live unread", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = NEVER_DRAWN;
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);

    // 1. The moment trust is granted is the moment it is worth most to somebody who spent three
    //    clean worlds earning it. That one is read whatever the draw says.
    const first = await who.build();
    const firstRes = await publish(who.token, first);
    expect(firstRes.status).toBe(202);
    expect(firstRes.data.needsReview, "the first world after graduating is always read").toBe(true);
    expect((await worldRow(first)).sampledAwayAt).toBeNull();
    expect((await userRow(who.userId)).trustSubmissions).toBe(1);

    // 2. The next one is not drawn: live, public, and in nobody's queue.
    const second = await who.build();
    const res = await publish(who.token, second);
    expect(res.status, "live is a 200, not the 202 that means somebody owes it time").toBe(200);
    expect(res.data.needsReview).toBe(false);
    expect(res.data.world.status).toBe("published");
    expect(res.data.world.visibility).toBe("public");
    // It still paid for the shelf: the fee is the price of the shelf, not an invoice per read.
    expect(res.data.charged.gems).toBe(WORLD_MODERATION.PUBLIC_SUBMIT_GEMS);

    const row = await worldRow(second);
    expect(row.sampledAwayAt, "…and the saving is on the row, so it can be counted").not.toBeNull();
    expect(row.publishChargeGems, "already on the shelf: there is nothing left to refund").toBe(0);
    expect((await queue()).data.worlds.map((w) => w.id)).not.toContain(second);

    // A reader finds it on Explore with no human having approved it — which is the whole point,
    // and the risk this feature is spending.
    const reader = await signup(h);
    const shelf = await call<{ worlds: WorldFull[]; fresh: WorldFull[] }>(h, "GET", "/v1/worlds/public", {
      token: reader.token,
    });
    expect([...shelf.data.worlds, ...shelf.data.fresh].map((w) => w.id)).toContain(second);
  });

  it("still queues the drawn one, and marks the card as drawn", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = "1";
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);
    // Spend the always-read first submission.
    await publish(who.token, await who.build());

    const drawn = await who.build();
    const res = await publish(who.token, drawn);
    expect(res.status).toBe(202);
    expect(res.data.needsReview).toBe(true);

    const row = (await queue()).data.worlds.find((w) => w.id === drawn);
    expect(row).toBeDefined();
    // The reviewer is told this is a sampled read rather than a first submission — a different card.
    expect(row?.digest?.sampled).toBe(true);
  });

  it("never samples a world the gate asked for a closer read on", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = NEVER_DRAWN;
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);
    await publish(who.token, await who.build());

    const edgy = await who.build();
    // The fake G8 softens on this marker; the real one softens on its own judgement.
    await prisma.world.update({
      where: { id: edgy },
      data: { bible: { en: "a season that is soften-me around the edges", ja: "soften-me な季節" } },
    });

    const res = await publish(who.token, edgy);
    expect(res.status, "our own machine asked for a human; a coin may not overrule it").toBe(202);
    const row = await worldRow(edgy);
    expect(row.safety).toBe("soften");
    expect(row.sampledAwayAt).toBeNull();
  });
});

/* ---------------------------------------------------------------- losing it ---- */

describe("what takes trust away", () => {
  it("resets on a rejection, and the first world after earning it back is read again", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = NEVER_DRAWN;
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);

    // The first submission after graduating is the one that is always read — so it is also the one
    // a reviewer can say no to, which is exactly the case that has to cost the standing.
    const rejected = await who.build();
    expect((await publish(who.token, rejected)).data.needsReview).toBe(true);
    expect((await decide(rejected, "reject", "Rule 1: this is somebody else's show.")).data.world.status).toBe(
      "rejected",
    );

    const after = await userRow(who.userId);
    expect(after.trustApprovals, "a reviewer's no costs the standing").toBe(0);
    expect(after.trustSubmissions).toBe(0);
    expect(after.trustResetAt).not.toBeNull();
    expect((await profile(who.token, who.handle)).data.trust?.trusted).toBe(false);

    // Back to being read every time.
    const next = await who.build();
    expect((await publish(who.token, next)).data.needsReview).toBe(true);
  });

  it("suspends immediately when a world is pulled, without letting a brigade erase the standing", async () => {
    process.env[WORLD_MODERATION_ENV.TRUST_SAMPLE_EVERY] = NEVER_DRAWN;
    const who = await creator();
    await approvals(who, WORLD_MODERATION.TRUST_APPROVALS);
    await publish(who.token, await who.build());

    // One of their live worlds is taken off the shelf by reports.
    const live = await who.build();
    await publish(who.token, live);
    await decide(live, "approve");
    for (let i = 0; i < WORLD_MODERATION.REPORTS_TO_PULL; i += 1) {
      const reporter = await signup(h);
      await call(h, "POST", "/v1/moderation/report", {
        token: reporter.token,
        body: { target: "world", targetId: live, reason: "harassment", note: `no ${i}` },
      });
    }
    expect((await worldRow(live)).pulledAt).not.toBeNull();

    // Suspended: at the bar, not trusted, nothing left to earn.
    const suspended = (await profile(who.token, who.handle)).data.trust;
    expect(suspended?.trusted).toBe(false);
    expect(suspended?.approvals).toBeGreaterThanOrEqual(WORLD_MODERATION.TRUST_APPROVALS);
    expect(suspended?.toTrusted).toBe(0);

    // While it stands, their submissions go to a person again.
    const during = await who.build();
    expect((await publish(who.token, during)).data.needsReview).toBe(true);
    await decide(during, "approve");

    // The complaints turn out to be wrong. The standing was never spent, so it comes straight back
    // — and the first submission after it lifts is read, exactly like the first after graduating.
    expect((await decide(live, "approve")).data.world.status).toBe("published");
    expect((await profile(who.token, who.handle)).data.trust?.trusted).toBe(true);
    const firstBack = await who.build();
    expect((await publish(who.token, firstBack)).data.needsReview).toBe(true);
    const thenOn = await who.build();
    expect((await publish(who.token, thenOn)).data.needsReview).toBe(false);
  });

  it("does not credit an approval that merely restores a pulled world", async () => {
    const who = await creator();
    const id = await who.build();
    await publish(who.token, id);
    await decide(id, "approve");
    expect((await userRow(who.userId)).trustApprovals).toBe(1);

    for (let i = 0; i < WORLD_MODERATION.REPORTS_TO_PULL; i += 1) {
      const reporter = await signup(h);
      await call(h, "POST", "/v1/moderation/report", {
        token: reporter.token,
        body: { target: "world", targetId: id, reason: "harassment", note: `no ${i}` },
      });
    }
    await decide(id, "approve");
    // Otherwise a creator farms standing by having one world brigaded repeatedly.
    expect((await userRow(who.userId)).trustApprovals).toBe(1);
  });
});

/* ------------------------------------------------------------------ the draw ---- */

describe("the draw itself", () => {
  it("draws everything at 1 — the kill switch — and is stable for a given world", () => {
    expect(drawnForFullRead("u1", "w1", 1)).toBe(true);
    expect(drawnForFullRead("u1", "w1", 0)).toBe(true);
    const once = drawnForFullRead("u1", "w1", 5);
    expect(drawnForFullRead("u1", "w1", 5), "the same world always draws the same way").toBe(once);
    // Independent across worlds: knowing this one tells a creator nothing about the next.
    const spread = ["a", "b", "c", "d", "e", "f", "g", "h"].map((w) => drawnForFullRead("u1", w, 2));
    expect(new Set(spread).size, "two outcomes across eight worlds").toBe(2);
  });

  it("names the reason a world is being read, and the exemptions do not need trust to be checked", () => {
    const trusted = trustOf({ trustApprovals: 9, trustSubmissions: 5 }, false);
    const world = { id: "w1", safety: null, rejectedReason: "" } as const;

    expect(
      samplingDecision(world, "u1", trustOf({ trustApprovals: 0, trustSubmissions: 0 }, false), {
        trustApprovals: 0,
        trustSubmissions: 0,
      }).reason,
    ).toBe("untrusted");
    expect(samplingDecision(world, "u1", trusted, { trustApprovals: 9, trustSubmissions: 0 }).reason).toBe(
      "first_after_trust",
    );
    expect(
      samplingDecision({ ...world, safety: "soften" }, "u1", trusted, { trustApprovals: 9, trustSubmissions: 5 })
        .reason,
    ).toBe("softened");
    // Defence in depth: a world a human already said no to is never a coin toss, even on a deploy
    // that has turned `TRUST_RESET_ON_REJECT` off.
    expect(
      samplingDecision({ ...world, rejectedReason: "no" }, "u1", trusted, { trustApprovals: 9, trustSubmissions: 5 })
        .reason,
    ).toBe("was_rejected");
    // A suspended creator is not trusted, whatever they have earned.
    expect(trustOf({ trustApprovals: 9, trustSubmissions: 5 }, true).trusted).toBe(false);
  });
});
