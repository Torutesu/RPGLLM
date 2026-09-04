import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HEAT, MEDIA_EVERY, MEDIA_KINDS, TrendingResZ, hashString } from "@rpgllm/shared";
import { heatFor } from "../src/services/heat";
import { mediaFor } from "../src/services/media";
import { castFollowers, crowdAbove, extractTopics } from "../src/services/trending";
import { call, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); });

type Trending = ReturnType<typeof TrendingResZ.parse>;

const trending = (token: string, personaId: string) =>
  call<Trending>(h, "GET", `/v1/trending?personaId=${personaId}`, { token });

/** Post and drain the stream, so replies / news / snapshots exist for the aggregate to chew on. */
async function postAndSettle(token: string, personaId: string, text: string): Promise<string> {
  const res = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
    token, body: { personaId, text, parentId: null },
  });
  await readSSE(h, res.data.streamUrl, token);
  return res.data.post.id;
}

const row = (id: string, text: string, heat = 50) => ({ id, text, kind: "character", heat });

describe("Agent K — heat", () => {
  const now = new Date("2026-09-04T12:00:00Z");

  it("is 0 for a post nobody touched and rises with engagement", () => {
    const cold = heatFor({ metrics: { likes: 0, reposts: 0, replies: 0 }, kind: "character", createdAt: now, now });
    const warm = heatFor({ metrics: { likes: 400, reposts: 60, replies: 12 }, kind: "character", createdAt: now, now });
    const loud = heatFor({ metrics: { likes: 40_000, reposts: 6_000, replies: 900 }, kind: "character", createdAt: now, now });
    expect(cold).toBe(0);
    expect(warm).toBeGreaterThan(cold);
    expect(loud).toBeGreaterThan(warm);
    expect(loud).toBeLessThanOrEqual(HEAT.MAX);
  });

  it("decays with age, so yesterday's post is never hotter than today's", () => {
    const metrics = { likes: 2_000, reposts: 300, replies: 60 };
    const fresh = heatFor({ metrics, kind: "character", createdAt: now, now });
    const old = heatFor({ metrics, kind: "character", createdAt: new Date(now.getTime() - 72 * 3_600_000), now });
    expect(old).toBeLessThan(fresh);
  });

  it("counts the swing a post caused, not just its likes", () => {
    const base = { metrics: { likes: 100, reposts: 10, replies: 2 }, kind: "user" as const, createdAt: now, now };
    const quiet = heatFor(base);
    const drama = heatFor({ ...base, statImpact: { auraDelta: -9, followersDelta: -30_000, followersBefore: 60_000 } });
    expect(drama).toBeGreaterThan(quiet);
  });
});

describe("Agent K — procedural media", () => {
  it("gives a post the same media on every device, forever", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `post-${i}`);
    const first = ids.map((id) => mediaFor(id, "character"));
    const second = ids.map((id) => mediaFor(id, "character"));
    expect(second).toEqual(first);
    for (const m of first) {
      if (m.mediaKind === null) { expect(m.mediaSeed).toBeNull(); continue; }
      expect(MEDIA_KINDS).toContain(m.mediaKind);
      expect(m.mediaSeed).toBeTruthy();
    }
  });

  it("lands on roughly one post in MEDIA_EVERY and never on the player's own", () => {
    const ids = Array.from({ length: 1_200 }, (_, i) => `p${i}`);
    const withMedia = ids.filter((id) => mediaFor(id, "character").mediaKind !== null).length;
    const expected = ids.length / MEDIA_EVERY;
    expect(withMedia).toBeGreaterThan(expected * 0.6);
    expect(withMedia).toBeLessThan(expected * 1.6);
    expect(ids.every((id) => mediaFor(id, "user").mediaKind === null)).toBe(true);
  });

  it("never puts a picture inside a reply", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `r${i}`);
    expect(ids.every((id) => mediaFor(id, "character", "parent-1").mediaKind === null)).toBe(true);
  });

  it("attaches receipts to the press account more often than pictures to the cast", () => {
    const ids = Array.from({ length: 2_000 }, (_, i) => `x${i}`);
    const news = ids.filter((id) => mediaFor(id, "news").mediaKind !== null).length;
    const cast = ids.filter((id) => mediaFor(id, "character").mediaKind !== null).length;
    expect(news).toBeGreaterThan(cast);
  });

  it("keeps the press account to screenshots and charts", () => {
    const kinds = new Set(
      Array.from({ length: 500 }, (_, i) => mediaFor(`n${i}`, "news").mediaKind).filter((k) => k !== null),
    );
    expect(kinds.size).toBeGreaterThan(0);
    expect([...kinds].every((k) => k === "leak" || k === "chart")).toBe(true);
  });

  it("agrees with the id hash the client mirrors", () => {
    const id = "ckmediaexample";
    const media = mediaFor(id, "character");
    expect(hashString(id) % MEDIA_EVERY === 0).toBe(media.mediaKind !== null);
  });
});

describe("Agent K — topic extraction", () => {
  it("finds the phrase two posts share and ignores filler", () => {
    const topics = extractTopics([
      row("a", "the second chorus on that record is doing all the work", 70),
      row("b", "nobody is talking about the second chorus and it shows", 40),
      row("c", "unrelated thoughts about lunch"),
    ]);
    expect(topics.length).toBeGreaterThan(0);
    const labels = topics.map((t) => t.label.toLowerCase());
    expect(labels.some((l) => l.includes("second chorus"))).toBe(true);
    expect(labels).not.toContain("the");
    const chorus = topics.find((t) => t.label.toLowerCase().includes("second chorus"))!;
    expect(chorus.posts).toBe(2);
    expect(chorus.heat).toBe(70);
    expect(chorus.postId).toBe("a");
  });

  it("ranks a multi-word name above an accidental mid-sentence capital", () => {
    const topics = extractTopics([
      row("a", "the Ledger Awards seating chart is a File nobody wanted", 60),
      row("b", "everyone at the Ledger Awards saw that File", 50),
    ]).map((t) => t.label);
    expect(topics).toContain("Ledger Awards");
    // "File" is only ever a repeated word, never a name — so it can never outrank one.
    expect(topics.indexOf("Ledger Awards")).toBeLessThan(
      topics.indexOf("File") === -1 ? topics.length : topics.indexOf("File"),
    );
  });

  it("takes a hashtag from a single post", () => {
    const topics = extractTopics([row("a", "studio all night #EraTour", 90)]);
    expect(topics.map((t) => t.label)).toContain("#EraTour");
  });

  it("is deterministic and never repeats a topic inside another", () => {
    const rows = [
      row("a", "midnight rehearsal again and again", 30),
      row("b", "midnight rehearsal ran long", 60),
      row("c", "midnight rehearsal ran long", 60),
    ];
    const once = extractTopics(rows);
    expect(extractTopics(rows)).toEqual(once);
    const labels = once.map((t) => t.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l) => l.includes("midnight")).length).toBe(1);
  });

  it("returns nothing rather than noise when there is nothing to say", () => {
    expect(extractTopics([row("a", "hi"), row("b", "ok")])).toEqual([]);
  });

  it("never trends on a contraction", () => {
    const topics = extractTopics([
      row("a", "that's the thing, i don't think we're done"),
      row("b", "that's fair but i don't agree, we're not done"),
    ]);
    for (const topic of topics) expect(topic.label).not.toMatch(/['’]/);
  });
});

describe("Agent K — where you rank", () => {
  it("does not tell a new account it is bottom of the world", async () => {
    const fx = await signupWithPersona(h);
    const res = await trending(fx.token, fx.personaId);
    // A fresh persona is small but not last: the crowd model puts them mid-table, with somewhere
    // to climb. "top 100%" is technically true and product suicide.
    expect(res.data.yourRank.percentile).toBeLessThan(80);
    expect(res.data.yourRank.percentile).toBeGreaterThan(10);
    expect(res.data.yourRank.trending).toBe(false);
  });

  it("climbs, and calls you trending once you are one of the loudest", async () => {
    const fx = await signupWithPersona(h);
    const before = (await trending(fx.token, fx.personaId)).data.yourRank;

    await prisma.persona.update({ where: { id: fx.personaId }, data: { followers: 250_000 } });
    const after = (await trending(fx.token, fx.personaId)).data.yourRank;

    expect(after.percentile).toBeLessThan(before.percentile);
    expect(after.followers).toBe(250_000);
    expect(after.trending).toBe(true);
  });

  it("is monotonic in followers", () => {
    const steps = [100, 1_000, 10_000, 100_000].map((f) => crowdAbove(f));
    expect([...steps].sort((a, b) => b - a)).toEqual(steps);
  });
});

describe("Agent K — cast follower flavour", () => {
  it("is stable per handle and puts the press account on top", () => {
    expect(castFollowers("gmz", true)).toBe(castFollowers("@GMZ", true));
    expect(castFollowers("gmz", true)).toBeGreaterThan(castFollowers("gmz", false));
    expect(castFollowers("hivequeenbea", false)).toBeGreaterThan(0);
  });
});

describe("GET /v1/trending", () => {
  it("matches the contract and ranks the persona inside the world", async () => {
    const fx = await signupWithPersona(h);
    await postAndSettle(fx.token, fx.personaId, "new song Friday and the second chorus is the whole song");
    await postAndSettle(fx.token, fx.personaId, "the second chorus again, sorry, not sorry");

    const res = await trending(fx.token, fx.personaId);
    expect(res.status).toBe(200);
    expect(() => TrendingResZ.parse(res.data)).not.toThrow();

    expect(res.data.yourRank.followers).toBeGreaterThan(0);
    expect(res.data.yourRank.percentile).toBeGreaterThanOrEqual(1);
    expect(res.data.yourRank.percentile).toBeLessThanOrEqual(100);
    expect(res.data.risingCharacters.length).toBeGreaterThan(0);
    for (const r of res.data.risingCharacters) expect(r.handle.startsWith("@")).toBe(false);
  });

  it("sorts rising characters by how far they moved toward you", async () => {
    const fx = await signupWithPersona(h);
    await postAndSettle(fx.token, fx.personaId, "studio all night again");

    const res = await trending(fx.token, fx.personaId);
    const deltas = res.data.risingCharacters.map((r) => r.delta);
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });

  it("hides a blocked character from the rising rail", async () => {
    const fx = await signupWithPersona(h);
    await postAndSettle(fx.token, fx.personaId, "studio all night again");
    const before = await trending(fx.token, fx.personaId);
    const target = before.data.risingCharacters[0];
    expect(target).toBeTruthy();

    const character = fx.characters.find((ch) => ch.handle.replace(/^@+/, "") === target!.handle)!;
    const blocked = await call(h, "POST", "/v1/moderation/block", {
      token: fx.token, body: { personaId: fx.personaId, characterId: character.id },
    });
    expect(blocked.status).toBe(201);

    const after = await trending(fx.token, fx.personaId);
    expect(after.data.risingCharacters.map((r) => r.handle)).not.toContain(target!.handle);
  });

  it("refuses a persona that is not yours, and requires a session", async () => {
    const mine = await signupWithPersona(h);
    const theirs = await signupWithPersona(h);
    expect((await trending(mine.token, theirs.personaId)).status).toBe(404);
    expect((await call(h, "GET", "/v1/trending")).status).toBe(401);
  });

  it("stamps heat on the rows it creates so the strip is not empty on day one", async () => {
    const fx = await signupWithPersona(h);
    await postAndSettle(fx.token, fx.personaId, "the second chorus is doing the work of a bridge");
    const hottest = await prisma.post.findFirst({
      where: { personaId: fx.personaId }, orderBy: { heat: "desc" },
    });
    expect(hottest?.heat).toBeGreaterThan(0);
  });
});
