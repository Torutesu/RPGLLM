import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DIGEST } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

interface DigestBody {
  digest: { id: string; headline: string; body: string; postIds: string[]; createdAt: string; seenAt: string | null } | null;
}
interface RunJobBody {
  ran: string[];
  digest: { considered: number; generated: { digestId: string; postIds: string[]; dmMessageId: string | null }[]; skipped: number } | null;
}

const runDigestJob = (personaId: string, force = true) =>
  call<RunJobBody>(h, "POST", "/v1/__test/run-job", { body: { job: "digest", personaId, force } });

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

describe("offline world director / digest (S2-1, AIF-001)", () => {
  it("generates one digest, returns it unseen, marks it seen, and costs no energy", async () => {
    const p = await signupWithPersona(h);
    const before = await getWallet(h, p.token);

    const job = await runDigestJob(p.personaId);
    expect(job.status).toBe(200);
    expect(job.data.digest?.generated).toHaveLength(1);
    const generated = job.data.digest!.generated[0]!;
    expect(generated.postIds.length).toBeGreaterThanOrEqual(DIGEST.POSTS_PER_DIGEST);
    expect(generated.dmMessageId, "the highest-affinity follower sends a DM").toBeTruthy();

    // AIF-001 costs no energy: the user did not act.
    const after = await getWallet(h, p.token);
    expect(after.data.energy).toBe(before.data.energy);
    const spends = await prisma.ledgerEntry.count({ where: { source: "spend" } });
    expect(spends).toBe(0);

    const read = await call<DigestBody>(h, "GET", `/v1/digest?personaId=${p.personaId}`, { token: p.token });
    expect(read.status).toBe(200);
    expect(read.data.digest?.id).toBe(generated.digestId);
    expect(read.data.digest?.seenAt).toBeNull();
    expect(read.data.digest?.headline.length ?? 0).toBeGreaterThan(0);
    expect(read.data.digest?.body.length ?? 0).toBeGreaterThan(0);

    // Running the job again while a digest is unseen must not stack a second one.
    const again = await runDigestJob(p.personaId);
    expect(again.data.digest?.generated).toHaveLength(0);
    expect(await prisma.digest.count({ where: { personaId: p.personaId } })).toBe(1);

    const seen = await call<{ seenAt: string }>(h, "POST", `/v1/digest/${generated.digestId}/seen`, { token: p.token });
    expect(seen.status).toBe(200);
    expect(seen.data.seenAt).toBeTruthy();

    // Seen + just active → nothing new (the away window is measured from the last digest too).
    const empty = await call<DigestBody>(h, "GET", `/v1/digest?personaId=${p.personaId}`, { token: p.token });
    expect(empty.data.digest).toBeNull();
  });

  it("puts the generated posts in the feed and logs every generator call", async () => {
    const p = await signupWithPersona(h);
    const job = await runDigestJob(p.personaId);
    const postIds = job.data.digest!.generated[0]!.postIds;

    const rows = await prisma.post.findMany({ where: { id: { in: postIds } } });
    expect(rows.length).toBe(postIds.length);
    for (const row of rows) expect(row.personaId).toBe(p.personaId);

    const feed = await call<{ posts: { id: string }[] }>(h, "GET", `/v1/feed?personaId=${p.personaId}`, { token: p.token });
    const inFeed = feed.data.posts.map((x) => x.id);
    expect(postIds.some((id) => inFeed.includes(id)), "digest posts land in the feed").toBe(true);

    const logs = await prisma.generationLog.findMany({ where: { userId: p.userId } });
    const generators = new Set(logs.map((l) => l.generator));
    expect(generators.has("G5"), "director beat").toBe(true);
    expect(generators.has("G1"), "character posts").toBe(true);
    expect(generators.has("G4"), "DM from the favourite follower").toBe(true);
  });

  it("does not fire inside the away window and fires once it is met", async () => {
    const p = await signupWithPersona(h);

    const tooSoon = await runDigestJob(p.personaId, false);
    expect(tooSoon.data.digest?.generated).toHaveLength(0);

    // Move the clock past DIGEST.MIN_AWAY_HOURS instead of forcing the job.
    h.clock.offsetDays(1);
    const now = await call<DigestBody>(h, "GET", `/v1/digest?personaId=${p.personaId}`, { token: p.token });
    expect(now.data.digest, "the read itself is the trigger when there is no scheduler").not.toBeNull();
    h.clock.reset();
  });

  it("registers an Expo push token (delivery is a no-op without PUSH_ENABLED=1)", async () => {
    const p = await signupWithPersona(h);
    const res = await call<{ registered: boolean }>(h, "POST", "/v1/push/register", {
      token: p.token, body: { token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", platform: "ios" },
    });
    expect(res.status).toBe(200);
    expect(res.data.registered).toBe(true);
    expect(await prisma.pushToken.count({ where: { userId: p.userId, enabled: true } })).toBe(1);

    // Re-registering the same device is idempotent.
    await call(h, "POST", "/v1/push/register", {
      token: p.token, body: { token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", platform: "ios" },
    });
    expect(await prisma.pushToken.count()).toBe(1);

    const job = await runDigestJob(p.personaId);
    expect(job.data.digest?.generated).toHaveLength(1);
  });
});
