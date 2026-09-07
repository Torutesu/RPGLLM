import type { Prisma } from "@prisma/client";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REEL, rank, scoreCandidate, statLine } from "../src/services/reel";
import { textUnits, truncateToUnits } from "../src/services/reel-text";
import { call, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness, type PersonaFixture } from "./helpers";

/**
 * The reel (gtm.md §4) — a moment as something that moves.
 *
 * What these cases are actually protecting: **the timing is a contract with a recording.** Somebody
 * screen-records a reel and posts it to TikTok; if the same slug ever answers with different text
 * or different holds, the video and the page have silently disagreed. So determinism is tested
 * twice — the same call twice, and a reply written *after* the swing, which must not reach a reel
 * that already exists.
 */

let h: Harness;

interface Beat {
  kind: string; at: number; holdMs: number;
  handle: string | null; displayName: string | null; text: string;
  delta: { followers: number; aura: number; humor: number } | null;
}
interface Reel {
  slug: string; worldTitle: string; worldSlug: string; personaHandle: string;
  creatorHandle: string | null; durationMs: number; beats: Beat[];
}

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.clock.reset(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

/** A real post, its real reactions, and the swing they caused — turned into a shareable moment. */
async function momentFrom(
  fx: PersonaFixture,
  text = "new song friday",
  patch: (snapshotId: string) => Promise<void> = async () => {},
): Promise<{ postId: string; slug: string }> {
  const created = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
    token: fx.token, body: { personaId: fx.personaId, text, parentId: null },
  });
  expect(created.status).toBe(201);
  const postId = created.data.post.id;
  await readSSE(h, created.data.streamUrl, fx.token);

  const snapshot = await prisma.statSnapshot.findFirstOrThrow({ where: { cause: `post:${postId}` } });
  // The fake world is a polite one: nudge the swing over the moment threshold (|aura| >= 5).
  await prisma.statSnapshot.update({ where: { id: snapshot.id }, data: { auraDelta: 6 } });
  await patch(snapshot.id);

  const list = await call<{ moments: { shareSlug: string }[] }>(
    h, "GET", `/v1/moments?personaId=${fx.personaId}`, { token: fx.token },
  );
  expect(list.data.moments).toHaveLength(1);
  return { postId, slug: list.data.moments[0]!.shareSlug };
}

const getReel = (slug: string, token?: string) =>
  call<Reel>(h, "GET", `/v1/moments/${slug}/reel`, token ? { token } : {});

const kinds = (reel: Reel): string[] => reel.beats.map((b) => b.kind);

/* ------------------------------------------------------------------ the cut ---- */

describe("GET /v1/moments/:slug/reel", () => {
  it("is public, and answers the same reel every time — text and timing both", async () => {
    const fx = await signupWithPersona(h);
    const { slug } = await momentFrom(fx);

    // No bearer at all: the share target has to render for somebody with no account, or it is not
    // a growth surface (gtm.md §4).
    const first = await getReel(slug);
    expect(first.status).toBe(200);
    const second = await getReel(slug);
    expect(second.status).toBe(200);
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));

    // …and the same reel a logged-in reader sees.
    const asOwner = await getReel(slug, fx.token);
    expect(JSON.stringify(asOwner.data)).toBe(JSON.stringify(first.data));

    expect((await call(h, "GET", "/v1/moments/not-a-real-slug/reel")).status).toBe(404);
  });

  it("opens on the world, shows the post, at least one reaction, and lands the stat after both", async () => {
    const fx = await signupWithPersona(h);
    const { slug } = await momentFrom(fx, "the album leaked and i'm fine actually");
    const reel = (await getReel(slug)).data;

    expect(kinds(reel)[0], "a stranger needs to know what world this is").toBe("setup");
    const post = reel.beats.findIndex((b) => b.kind === "post");
    const stat = reel.beats.findIndex((b) => b.kind === "stat");
    const replies = reel.beats.flatMap((b, i) => (b.kind === "reply" ? [i] : []));

    expect(post).toBeGreaterThanOrEqual(0);
    expect(replies.length).toBeGreaterThanOrEqual(1);
    expect(replies.length).toBeLessThanOrEqual(REEL.MAX_REPLIES);
    // The turn is the punchline: everything that sets it up comes before it, nothing after.
    expect(stat).toBeGreaterThan(post);
    for (const r of replies) expect(stat).toBeGreaterThan(r);
    expect(reel.beats.slice(stat + 1).every((b) => b.kind === "headline" || b.kind === "outro")).toBe(true);

    // The post beat is the player speaking; the reactions are not.
    expect(reel.beats[post]!.handle).toBe(reel.personaHandle);
    expect(reel.beats[post]!.text).toContain("the album leaked");
    for (const r of replies) expect(reel.beats[r]!.handle).not.toBe(reel.personaHandle);

    // The number can count rather than appear.
    expect(reel.beats[stat]!.delta).toEqual({ followers: expect.any(Number), aura: 6, humor: expect.any(Number) });
    expect(reel.beats[stat]!.text).toContain("+6");

    // The timeline is contiguous and integer: `at` is where the client seeks to.
    let at = 0;
    for (const beat of reel.beats) {
      expect(beat.at).toBe(at);
      expect(Number.isInteger(beat.holdMs)).toBe(true);
      at += beat.holdMs;
    }
    expect(reel.durationMs).toBe(at);
    expect(reel.durationMs).toBeGreaterThan(4_000);
    expect(reel.durationMs).toBeLessThanOrEqual(REEL.MAX_MS);

    expect(reel.worldSlug).toBe("popstar-era");
    expect(reel.creatorHandle, "a preset is nobody's world").toBeNull();
  });

  it("truncates a post that would break the cut instead of letting the cut run long", async () => {
    const fx = await signupWithPersona(h);
    const long = `${"the group chat leaked and everybody has an opinion about it ".repeat(4)}so here we are`;
    expect(long.length).toBeGreaterThan(240);
    const { slug } = await momentFrom(fx, long.slice(0, 280));

    const reel = (await getReel(slug)).data;
    const post = reel.beats.find((b) => b.kind === "post")!;
    expect(post.text.endsWith("…"), "cut the text, never the cut").toBe(true);
    expect(textUnits(post.text)).toBeLessThanOrEqual(REEL.HOLD.post.units);
    expect(post.holdMs).toBe(REEL.HOLD.post.max);
    // Nine-ish seconds, whatever the player wrote.
    expect(reel.durationMs).toBeGreaterThan(6_000);
    expect(reel.durationMs).toBeLessThanOrEqual(REEL.MAX_MS);
  });

  it("is in the language the drama happened in — a JA persona's reel is Japanese", async () => {
    const fx = await signupWithPersona(h, { locale: "ja" });
    const { slug } = await momentFrom(fx, "新曲、金曜に出す");
    const reel = (await getReel(slug)).data;

    const japanese = /[぀-ヿ一-鿿]/u;
    expect(reel.worldTitle).toBe("ポップスター・エラ");
    expect(japanese.test(reel.beats.find((b) => b.kind === "setup")!.text)).toBe(true);
    expect(japanese.test(reel.beats.find((b) => b.kind === "headline")!.text)).toBe(true);
    expect(japanese.test(reel.beats.find((b) => b.kind === "reply")!.text)).toBe(true);
    // Even the stat label: "+6 オーラ", not "+6 Aura".
    expect(reel.beats.find((b) => b.kind === "stat")!.text).toContain("フォロワー");
    expect(reel.beats.find((b) => b.kind === "stat")!.text).toContain("オーラ");
  });

  it("puts the reaction that turned against the player last, right before the number", async () => {
    const fx = await signupWithPersona(h);
    // The rival disagreeing is the sharpest thing in nine seconds; everyone else agreed.
    const rival = await prisma.worldCharacter.findFirstOrThrow({ where: { worldId: fx.worldId, handle: "@the6ixdrey" } });
    const { slug } = await momentFrom(fx, "hot take incoming", async (snapshotId) => {
      const row = await prisma.statSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
      const previous = (row.relDeltas as { deltas?: Record<string, number>; after?: unknown }) ?? {};
      await prisma.statSnapshot.update({
        where: { id: snapshotId },
        data: {
          relDeltas: {
            deltas: { ...(previous.deltas ?? {}), the6ixdrey: -1 },
            after: previous.after ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    const reel = (await getReel(slug)).data;
    const stat = reel.beats.findIndex((b) => b.kind === "stat");
    const lastReply = reel.beats[stat - 1]!;
    expect(lastReply.kind).toBe("reply");
    expect(lastReply.handle).toBe("the6ixdrey");
  });

  it("freezes at the swing: a reply written afterwards cannot change a reel somebody recorded", async () => {
    const fx = await signupWithPersona(h);
    const { postId, slug } = await momentFrom(fx);
    const before = (await getReel(slug)).data;

    // `POST /posts/:id/more-replies` writes rows after the snapshot. A published reel must not move.
    const late = await prisma.worldCharacter.findFirstOrThrow({ where: { worldId: fx.worldId, handle: "@hivequeenbea" } });
    await prisma.post.create({
      data: {
        worldId: fx.worldId, personaId: fx.personaId, authorCharacterId: late.id, kind: "character",
        text: "AND ANOTHER THING 🐝", parentId: postId, heat: 99,
        createdAt: new Date(Date.now() + 60_000),
      },
    });

    expect(JSON.stringify((await getReel(slug)).data)).toBe(JSON.stringify(before));
  });
});

/* ------------------------------------------------- what earns a beat, in isolation ---- */

describe("the reel's judgement calls", () => {
  it("ranks a quiet reply that turned against you above a loud one that agreed", async () => {
    const agreed = scoreCandidate({ heat: 60, kind: "character" }, 1);
    const against = scoreCandidate({ heat: 10, kind: "character" }, -1);
    expect(against).toBeGreaterThan(agreed);
    // …and both above a reply nothing happened around.
    expect(agreed).toBeGreaterThan(scoreCandidate({ heat: 12, kind: "character" }, 0));
  });

  it("drops the lukewarm ones rather than padding the reel out to three", () => {
    const c = (id: string, score: number) => ({ id, score, handle: id, displayName: id, text: id, at: 0 });
    const kept = rank([c("a", 100), c("b", 80), c("c", 20), c("d", 5)]);
    expect(kept.map((x) => x.id), "20 and 5 are below 45% of the best one").toEqual(["a", "b"]);
    // Ties are broken by time then id, so the ranking is a total order and the reel never wobbles.
    expect(rank([c("z", 50), c("y", 50)]).map((x) => x.id)).toEqual(["y", "z"]);
    expect(rank([])).toEqual([]);
  });

  it("measures reading time in units, so a Japanese line gets the time it needs", () => {
    expect(textUnits("hello")).toBe(5);
    expect(textUnits("炎上した"), "a CJK character is worth two latin ones").toBe(8);
    expect(textUnits("@bea が言った")).toBe(5 + 8);

    expect(truncateToUnits("short", 20)).toBe("short");
    expect(truncateToUnits("  spaced   out  ", 20)).toBe("spaced out");
    expect(truncateToUnits("abcdefghij", 5)).toBe("abcd…");
    expect(truncateToUnits("あいうえおかきくけこ", 6)).toBe("あい…");
  });

  it("writes the stat line in the moment's language, and never a bare zero", () => {
    expect(statLine("en", { followers: 412, aura: 6, humor: 0 })).toBe("+412 Followers · +6 Aura");
    expect(statLine("en", { followers: -1200, aura: 0, humor: -2 })).toBe("-1.2K Followers · -2 Humor");
    expect(statLine("ja", { followers: 0, aura: 0, humor: 0 })).toBe("0 フォロワー");
  });
});
