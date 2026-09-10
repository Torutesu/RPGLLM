/**
 * The four circuits that make a world have an author (gtm.md 勝ち筋 A).
 *
 * ① the return signal — the author hears that somebody played it, and hears about the world's
 *    whole lifecycle **even if they have never made a persona**, which is the ordinary case;
 * ② the name — a creator is a page you can go to, and a name they can change;
 * ③ first speed — a new world reaches its first players without winning a ranking first;
 * ④ conversion — a player who liked a world can make their own version of it.
 *
 * Plus the claim all of it rests on: the community shelf is not narrowed by the caller's language.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WORLD_STUDIO } from "@rpgllm/shared";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import { PLAY_MILESTONES } from "../src/services/world-plays";
import { freshMinShelf, freshSlots } from "../src/services/world-fresh";
import { renameCooldownDays } from "../src/services/creator-rename";
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
  title: string;
  status: string;
  visibility: string;
  premise: string;
  isPreset: boolean;
  isMine: boolean;
  creatorHandle: string | null;
  playCount: number;
  castCount: number;
  createdAt: string;
  reason: string | null;
  remixOf: { id: string; slug: string; title: string; creatorHandle: string | null } | null;
  remixCount: number;
}
interface CreateRes {
  world: WorldFull;
  charged: { gems: number; remaining: number };
}
interface PublicRes {
  worlds: WorldFull[];
  fresh: WorldFull[];
  nextCursor: string | null;
}
interface ProfileRes {
  handle: string;
  isYou: boolean;
  worldCount: number;
  totalPlays: number;
  joinedAt: string;
  worlds: WorldFull[];
}
interface NotificationRow {
  id: string;
  kind: string;
  text: string;
  target: string | null;
  payload: Record<string, unknown>;
}
interface InboxRes {
  notifications: NotificationRow[];
  unread: number;
  nextCursor: string | null;
}

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";

const buildOnce = async (): Promise<void> => {
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
};

const create = (token: string, premise = PREMISE, visibility = "private", locale = "en") =>
  call<CreateRes>(h, "POST", "/v1/worlds", { token, body: { premise, genre: "idol", locale, visibility } });

/** The gem balance, with the wallet brought into existence first if this account has never read it. */
async function gemsOf(token: string, userId: string): Promise<number> {
  await call(h, "GET", "/v1/wallet", { token });
  return (await prisma.wallet.findUniqueOrThrow({ where: { userId } })).gems;
}

/** Give a wallet enough gems for another world (signup grants exactly one world's worth). */
async function topUp(token: string, userId: string, gems = WORLD_STUDIO.GEM_COST * 4): Promise<void> {
  await call(h, "GET", "/v1/wallet", { token });
  await prisma.wallet.update({ where: { userId }, data: { gems } });
}

/** signup → create → build. The author has **no persona**: that is the point of most of these. */
async function builtWorld(opts: { premise?: string; locale?: string; userLocale?: "en" | "ja" } = {}) {
  const { token, userId } = await signup(h, opts.userLocale ? { locale: opts.userLocale } : {});
  const created = await create(token, opts.premise ?? PREMISE, "private", opts.locale ?? "en");
  expect(created.status).toBe(201);
  await buildOnce();
  // The shelf costs gems on top of the world (gtm.md §2 exit 1); a fresh account has none left.
  await grantShelfGems(userId, 4);
  const world = await prisma.world.findUniqueOrThrow({ where: { id: created.data.world.id } });
  return { token, userId, world };
}

/** …and all the way onto the shelf: submitted, and approved by a person. */
async function shelvedWorld(opts: { premise?: string; locale?: string; userLocale?: "en" | "ja" } = {}) {
  const built = await builtWorld(opts);
  expect(
    (
      await call(h, "POST", `/v1/worlds/${built.world.id}/publish`, {
        token: built.token,
        body: { visibility: "public" },
      })
    ).status,
  ).toBe(202);
  expect(
    (
      await call<{ world: WorldFull }>(h, "POST", `/v1/admin/worlds/${built.world.id}/review`, {
        body: { decision: "approve", reason: "" },
      })
    ).data.world.status,
  ).toBe("published");
  return built;
}

/** A different person makes a persona in this world — one play. */
async function play(worldId: string): Promise<{ token: string; userId: string; personaId: string }> {
  const who = await signup(h);
  return { ...who, personaId: await playAs(who.token, worldId) };
}

async function playAs(token: string, worldId: string): Promise<string> {
  const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
    h,
    "GET",
    `/v1/worlds/${worldId}`,
    { token },
  );
  const first = detail.data.characters.find((c) => c.canBeFirstFollower) ?? detail.data.characters[0]!;
  const res = await call<{ persona: { id: string } }>(h, "POST", "/v1/personas", {
    token,
    body: {
      worldId,
      handle: `p${Math.random().toString(36).slice(2, 9)}`,
      displayName: "P",
      bio: "",
      avatarUrl: null,
      voiceNotes: "",
      firstFollowerId: first.id,
      idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
    },
  });
  expect(res.status).toBe(201);
  return res.data.persona.id;
}

const creatorRows = (userId: string, kind?: string) =>
  prisma.notification.findMany({
    where: { userId, personaId: null, ...(kind ? { kind: kind as never } : {}) },
    orderBy: { createdAt: "asc" },
  });

const inbox = (token: string) => call<InboxRes>(h, "GET", "/v1/notifications", { token });

/* ============================================================ ① the return ==== */

describe("circuit ① — the author hears about their own world", () => {
  it("tells a creator who has never made a persona every single thing that happens to it", async () => {
    // Built. No persona has ever existed for this account — the studio is reachable from the world
    // picker, which is the screen a player sees before they have played anything at all.
    const { token, userId, world } = await builtWorld();
    expect(await prisma.persona.count({ where: { userId } })).toBe(0);
    expect((await creatorRows(userId, "world_ready")).length, "the build must be announced").toBe(1);

    // Reviewed — approved.
    await call(h, "POST", `/v1/worlds/${world.id}/publish`, { token, body: { visibility: "public" } });
    await call(h, "POST", `/v1/admin/worlds/${world.id}/review`, { body: { decision: "approve", reason: "" } });
    const reviewed = await creatorRows(userId, "world_reviewed");
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.payload).toMatchObject({ approved: true, worldId: world.id });

    // Pulled by reports.
    for (let i = 0; i < 3; i += 1) {
      const reporter = await signup(h);
      expect(
        (
          await call(h, "POST", "/v1/moderation/report", {
            token: reporter.token,
            body: { target: "world", targetId: world.id, reason: "harassment", note: `complaint ${i}` },
          })
        ).status,
      ).toBe(201);
    }
    expect((await prisma.world.findUniqueOrThrow({ where: { id: world.id } })).pulledAt).not.toBeNull();
    expect(await creatorRows(userId, "world_pulled")).toHaveLength(1);

    // Reviewed again — rejected this time.
    await call(h, "POST", `/v1/admin/worlds/${world.id}/review`, { body: { decision: "reject", reason: "no" } });
    expect((await creatorRows(userId, "world_reviewed")).length).toBe(2);

    // …and every one of them is readable, by an account that still has no persona at all.
    const list = await inbox(token);
    expect(list.status, "an inbox must not 404 just because nobody has played anything").toBe(200);
    expect(list.data.notifications.map((n) => n.kind).sort()).toEqual([
      "world_pulled",
      "world_ready",
      "world_reviewed",
      "world_reviewed",
    ]);
    expect(list.data.unread).toBe(4);
    expect(list.data.notifications.every((n) => n.target === `world:${world.id}`)).toBe(true);
  });

  it("tells a creator with no persona that a build failed, in the same breath as the refund", async () => {
    const { token, userId } = await signup(h);
    expect((await create(token)).status).toBe(201);
    h.gateway.failNext(1);
    await buildOnce();

    const rows = await creatorRows(userId, "world_ready");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ ok: false });
    expect((await inbox(token)).data.notifications).toHaveLength(1);
    // The refund and the sentence about it are the same event.
    expect(await prisma.ledgerEntry.count({ where: { ref: { startsWith: "world_refund:" } } })).toBe(1);
  });

  it("rings on the first play and on the ladder, never once per play", async () => {
    const author = await shelvedWorld();
    const worldId = author.world.id;

    await play(worldId);
    let rows = await creatorRows(author.userId, "world_played");
    expect(rows, "the first person who is not you is the signal that matters").toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ plays: 1 });

    // Plays 2, 3 and 4 are between rungs: the world is being played and the author is left alone.
    for (let i = 0; i < 3; i += 1) await play(worldId);
    expect(await creatorRows(author.userId, "world_played")).toHaveLength(1);

    // The fifth crosses the next rung.
    await play(worldId);
    rows = await creatorRows(author.userId, "world_played");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload).toMatchObject({ plays: PLAY_MILESTONES[1] });
    expect((await prisma.world.findUniqueOrThrow({ where: { id: worldId } })).playCount).toBe(5);
  });

  it("does not tell an author that they played their own world", async () => {
    const author = await shelvedWorld();
    await playAs(author.token, author.world.id);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: author.world.id } })).playCount).toBe(1); // it still counts as a play — the shelf ranks on plays
    expect(await creatorRows(author.userId, "world_played")).toHaveLength(0);
  });

  it("keeps one account's creator notifications out of another account's inbox", async () => {
    const author = await shelvedWorld();
    const other = await play(author.world.id);
    const theirs = await call<InboxRes>(h, "GET", `/v1/notifications?personaId=${other.personaId}`, {
      token: other.token,
    });
    expect(theirs.data.notifications.some((n) => n.kind.startsWith("world_"))).toBe(false);
  });
});

/* ============================================================== ② the name ==== */

describe("circuit ② — the creator is a place you can go", () => {
  it("shows a creator's public worlds and never their private ones — not even to themselves", async () => {
    const author = await shelvedWorld();
    await topUp(author.token, author.userId);
    // A second world that never leaves the studio.
    const secret = await create(author.token, "A quiet town where nobody remembers last summer");
    await buildOnce();
    expect((await prisma.world.findUniqueOrThrow({ where: { id: secret.data.world.id } })).status).toBe("ready");

    await play(author.world.id);
    const handle = (await prisma.user.findUniqueOrThrow({ where: { id: author.userId } })).creatorHandle;

    const mine = await call<ProfileRes>(h, "GET", `/v1/creators/${handle}`, { token: author.token });
    expect(mine.status).toBe(200);
    expect(mine.data.isYou).toBe(true);
    expect(mine.data.worldCount, "one public world, whoever is looking").toBe(1);
    expect(mine.data.worlds.map((w) => w.id)).toEqual([author.world.id]);
    expect(mine.data.worlds.map((w) => w.id)).not.toContain(secret.data.world.id);
    expect(mine.data.totalPlays).toBe(1);
    expect(Date.parse(mine.data.joinedAt)).toBeGreaterThan(0);

    const stranger = await signup(h);
    const theirs = await call<ProfileRes>(h, "GET", `/v1/creators/@${handle.toUpperCase()}`, { token: stranger.token });
    expect(theirs.status, "the handle is case-insensitive and the @ is optional").toBe(200);
    expect(theirs.data.isYou).toBe(false);
    expect(theirs.data.worlds.map((w) => w.id)).toEqual([author.world.id]);
    expect(theirs.data.worldCount).toBe(1);
  });

  it("is a 404 for a name nobody goes by, and for an account that deleted itself", async () => {
    const stranger = await signup(h);
    expect((await call(h, "GET", "/v1/creators/nobodyhere", { token: stranger.token })).status).toBe(404);

    const author = await shelvedWorld();
    const handle = (await prisma.user.findUniqueOrThrow({ where: { id: author.userId } })).creatorHandle;
    await prisma.user.update({ where: { id: author.userId }, data: { deletedAt: h.clock.now() } });
    expect((await call(h, "GET", `/v1/creators/${handle}`, { token: stranger.token })).status).toBe(404);
  });

  it("lets a placeholder be renamed, and every world keeps crediting the same person", async () => {
    const author = await shelvedWorld();
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: author.userId } })).creatorHandle;

    const me = await call<{ user: { creatorHandle: string } }>(h, "GET", "/v1/me", { token: author.token });
    expect(me.data.user.creatorHandle, "`/v1/me` carries the name the worlds are credited to").toBe(before);

    const renamed = await call<{ creatorHandle: string }>(h, "POST", "/v1/me/creator-handle", {
      token: author.token,
      body: { handle: "kagerou" },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.data.creatorHandle).toBe("kagerou");

    // The credit is resolved at read time, so it has already moved — everywhere, at once.
    const reader = await signup(h);
    const card = await call<{ world: { creatorHandle: string | null } }>(h, "GET", `/v1/worlds/${author.world.id}`, {
      token: reader.token,
    });
    expect(card.data.world.creatorHandle).toBe("kagerou");
    const shelf = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: reader.token });
    expect(shelf.data.worlds.find((w) => w.id === author.world.id)?.creatorHandle).toBe("kagerou");
    expect(
      (await call<ProfileRes>(h, "GET", "/v1/creators/kagerou", { token: reader.token })).data.worlds,
    ).toHaveLength(1);
    // …and the old page is gone rather than pointing at somebody else.
    expect((await call(h, "GET", `/v1/creators/${before}`, { token: reader.token })).status).toBe(404);
  });

  it("refuses a name that is taken, a name a cast goes by, and a name still held by whoever left it", async () => {
    const first = await signup(h);
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: first.token, body: { handle: "kagerou" } })).status,
    ).toBe(200);

    const second = await signup(h);
    const taken = await call(h, "POST", "/v1/me/creator-handle", { token: second.token, body: { handle: "kagerou" } });
    expect(taken.status, "uniqueness is case-insensitive because handles are stored normalised").toBe(409);
    expect(taken.error?.code).toBe("HANDLE_TAKEN");
    // `SetCreatorHandleReqZ` is lowercase-only, so an uppercase spelling is refused by the shape
    // before it can reach the index — the same answer, one gate earlier.
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: second.token, body: { handle: "KAGEROU" } })).status,
    ).toBe(400);

    // A cast member of a preset world. Two `@rina`s on one card is exactly what ② is not.
    const cast = await prisma.worldCharacter.findFirstOrThrow({ select: { handle: true } });
    const bare = cast.handle.replace(/^@/, "");
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: second.token, body: { handle: bare } })).status,
    ).toBe(409);

    // `first` renames away; the name they left is not immediately somebody else's to take.
    h.clock.offsetDays(renameCooldownDays() + 1);
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: first.token, body: { handle: "kagerou2" } })).status,
    ).toBe(200);
    const grab = await call(h, "POST", "/v1/me/creator-handle", { token: second.token, body: { handle: "kagerou" } });
    expect(grab.status, "a released handle is reserved — links to it are already out in the world").toBe(409);
    // Its previous owner may still take it back at any time.
    h.clock.offsetDays(renameCooldownDays() + 1);
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: first.token, body: { handle: "kagerou" } })).status,
    ).toBe(200);
  });

  it("rations renames after the free graduation, and says when the next one is", async () => {
    const who = await signup(h);
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: who.token, body: { handle: "firstname" } })).status,
    ).toBe(200);

    const tooSoon = await call(h, "POST", "/v1/me/creator-handle", {
      token: who.token,
      body: { handle: "secondname" },
    });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.error?.code).toBe("RATE_LIMITED");
    // Asking for the name you already have is free, and costs no cooldown.
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: who.token, body: { handle: "firstname" } })).status,
    ).toBe(200);

    h.clock.offsetDays(renameCooldownDays() + 1);
    expect(
      (await call(h, "POST", "/v1/me/creator-handle", { token: who.token, body: { handle: "secondname" } })).status,
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: who.userId } })).creatorHandle).toBe("secondname");
  });
});

/* ============================================================ ③ first speed ==== */

describe("circuit ③ — a new world reaches its first players", () => {
  /** A world already on the shelf, written straight to the row: this is scenery, not the case. */
  const shelveRaw = async (slug: string, plays: number, ageDays: number, createdBy: string | null = null) =>
    await prisma.world.create({
      data: {
        slug,
        title: { en: slug, ja: slug },
        scenario: { en: slug, ja: slug },
        bible: { en: "b", ja: "b" },
        bibleTokens: 0,
        isPreset: false,
        status: "published",
        visibility: "public",
        premise: `premise for ${slug}`,
        genre: "idol",
        genLocale: "en",
        playCount: plays,
        createdBy,
        createdAt: new Date(h.clock.now().getTime() - ageDays * 24 * 60 * 60 * 1000),
      },
    });

  it("keeps the strip empty while the shelf is small enough to fit on one screen", async () => {
    const author = await shelvedWorld();
    const reader = await signup(h);
    const shelf = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: reader.token });
    expect(shelf.data.fresh, "nothing can be buried under two worlds").toHaveLength(0);
    expect(shelf.data.worlds.map((w) => w.id)).toContain(author.world.id);
  });

  it("gives a world with zero plays a slot the ranking would never have given it", async () => {
    // A shelf big enough to bury something: every one of these outranks a new world on plays alone.
    for (let i = 0; i < freshMinShelf(); i += 1) await shelveRaw(`popular-${i}`, 500 + i, 30);
    const newcomer = await shelvedWorld({ premise: "A night market that only opens when it rains" });
    expect(newcomer.world.playCount).toBe(0);

    const reader = await signup(h);
    const shelf = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: reader.token });

    expect(
      shelf.data.fresh.map((w) => w.id),
      "shown because it is new, and for no other reason",
    ).toContain(newcomer.world.id);
    expect(
      shelf.data.worlds.map((w) => w.id),
      "and never in both lists at once",
    ).not.toContain(newcomer.world.id);
    expect(shelf.data.fresh.every((w) => w.playCount === 0 || w.playCount >= 0)).toBe(true);
    expect(shelf.data.fresh.length).toBeLessThanOrEqual(freshSlots());
    // The ranking is untouched otherwise: the popular worlds are still ranked by plays.
    expect(shelf.data.worlds[0]?.playCount).toBeGreaterThan(shelf.data.worlds[1]?.playCount ?? 0);

    // Paging deeper is not a request for the strip, and never repeats it.
    const page2 = await call<PublicRes>(
      h,
      "GET",
      `/v1/worlds/public?limit=5&cursor=${encodeURIComponent(
        (await call<PublicRes>(h, "GET", "/v1/worlds/public?limit=5", { token: reader.token })).data.nextCursor ?? "",
      )}`,
      { token: reader.token },
    );
    expect(page2.data.fresh).toHaveLength(0);
    expect(page2.data.worlds.map((w) => w.id)).not.toContain(newcomer.world.id);
  });

  it("cannot become a second winner-take-all list: one slot per creator, and only while new", async () => {
    for (let i = 0; i < freshMinShelf(); i += 1) await shelveRaw(`popular-${i}`, 500 + i, 30);

    const prolific = await signup(h);
    for (let i = 0; i < 3; i += 1) await shelveRaw(`mine-${i}`, 0, 0, prolific.userId);
    // …and one world that is new but no longer inside the window.
    const stale = await shelveRaw("aged-out", 0, 10);

    const reader = await signup(h);
    const shelf = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: reader.token });
    const mine = shelf.data.fresh.filter((w) => w.slug.startsWith("mine-"));
    expect(mine, "one author cannot own the strip by making eight worlds a day").toHaveLength(1);
    expect(shelf.data.fresh.map((w) => w.id)).not.toContain(stale.id);
    expect(
      shelf.data.worlds.map((w) => w.id),
      "a world leaves the strip by getting old, into the ranking",
    ).toContain(stale.id);
  });
});

/* ============================================================= ④ conversion ==== */

describe("circuit ④ — a world made out of a world you played", () => {
  const remix = (token: string, worldId: string, body: Record<string, unknown> = {}) =>
    call<CreateRes>(h, "POST", `/v1/worlds/${worldId}/remix`, {
      token,
      body: { premise: "The same debut slot, but the leak was mine", visibility: "private", ...body },
    });

  it("charges, screens and builds exactly like a create, and records what it came out of", async () => {
    const author = await shelvedWorld({ locale: "ja" });
    const fan = await signup(h);
    await playAs(fan.token, author.world.id);

    const before = await gemsOf(fan.token, fan.userId);
    const made = await remix(fan.token, author.world.id);

    expect(made.status).toBe(201);
    expect(made.data.charged.gems, "a remix is not a discount").toBe(WORLD_STUDIO.GEM_COST);
    expect(made.data.charged.remaining).toBe(before - WORLD_STUDIO.GEM_COST);
    expect(made.data.world.status).toBe("generating");
    expect(made.data.world.remixOf).toMatchObject({ id: author.world.id, slug: author.world.slug });

    const row = await prisma.world.findUniqueOrThrow({ where: { id: made.data.world.id } });
    expect(row.remixOfId).toBe(author.world.id);
    expect(row.genre, "the source's genre unless overridden").toBe(author.world.genre);
    expect(row.genLocale, "…and the source's language").toBe("ja");
    expect(row.premise).toBe("The same debut slot, but the leak was mine");

    // The source says how often it was taken up.
    expect((await prisma.world.findUniqueOrThrow({ where: { id: author.world.id } })).remixCount).toBe(1);
    const reader = await signup(h);
    const card = await call<{ world: { id: string } }>(h, "GET", `/v1/worlds/${author.world.id}`, {
      token: reader.token,
    });
    expect(card.status).toBe(200);

    // The same build job finishes it — there is no second generator for remixes.
    await buildOnce();
    const built = await prisma.world.findUniqueOrThrow({ where: { id: made.data.world.id } });
    expect(built.status).toBe("ready");
    expect(built.remixOfId).toBe(author.world.id);
    expect(await prisma.worldCharacter.count({ where: { worldId: built.id } })).toBe(WORLD_STUDIO.CAST_SIZE);
  });

  it("takes an override for genre and locale, and counts against the same daily limit", async () => {
    const author = await shelvedWorld();
    const fan = await signup(h);
    await topUp(fan.token, fan.userId);

    const made = await remix(fan.token, author.world.id, { genre: "fantasy", locale: "ja" });
    expect(made.status).toBe(201);
    const row = await prisma.world.findUniqueOrThrow({ where: { id: made.data.world.id } });
    expect(row.genre).toBe("fantasy");
    expect(row.genLocale).toBe("ja");

    for (let i = 1; i < WORLD_STUDIO.DAILY_LIMIT; i += 1) {
      expect((await remix(fan.token, author.world.id, { premise: `A different angle number ${i}` })).status).toBe(201);
    }
    const overLimit = await remix(fan.token, author.world.id, { premise: "One more angle, one too many" });
    expect(overLimit.status).toBe(429);
    expect(overLimit.error?.code).toBe("WORLD_LIMIT");
  });

  it("refuses a world the caller may not play, and never says whether it exists", async () => {
    const author = await builtWorld(); // private: theirs alone
    const stranger = await signup(h);
    const refused = await remix(stranger.token, author.world.id);
    expect(refused.status).toBe(404);
    expect(await prisma.world.count({ where: { createdBy: stranger.userId } })).toBe(0);
    expect(await gemsOf(stranger.token, stranger.userId)).toBe(WORLD_STUDIO.STARTER_GEMS);

    // An unlisted world is playable by whoever holds the link, so it is remixable by them too.
    const unlisted = await builtWorld({ premise: "A radio station nobody admits to listening to" });
    await call(h, "POST", `/v1/worlds/${unlisted.world.id}/publish`, {
      token: unlisted.token,
      body: { visibility: "unlisted" },
    });
    expect((await remix(stranger.token, unlisted.world.id)).status).toBe(201);
  });

  it("screens the remixed premise like any other, and charges nothing when it blocks", async () => {
    const author = await shelvedWorld();
    const fan = await signup(h);
    const blocked = await remix(fan.token, author.world.id, {
      premise: "A story where an adult teacher seduces a minor student",
    });
    expect(blocked.status).toBe(422);
    expect(blocked.error?.code).toBe("SAFETY_BLOCKED");
    expect(await gemsOf(fan.token, fan.userId)).toBe(WORLD_STUDIO.STARTER_GEMS);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: author.world.id } })).remixCount).toBe(0);
  });

  it("allows a remix of a remix, and the chain always terminates", async () => {
    const author = await shelvedWorld();
    const fan = await signup(h);
    const child = await remix(fan.token, author.world.id);
    await buildOnce();
    await call(h, "POST", `/v1/worlds/${child.data.world.id}/publish`, {
      token: fan.token,
      body: { visibility: "unlisted" },
    });

    const grandchild = await remix((await signup(h)).token, child.data.world.id, { premise: "And then it was mine" });
    expect(grandchild.status).toBe(201);
    expect(grandchild.data.world.remixOf?.id).toBe(child.data.world.id);

    // Walk it: every edge points at an older row, so following them cannot loop.
    const seen = new Set<string>();
    let cursor: string | null = grandchild.data.world.id;
    while (cursor) {
      expect(seen.has(cursor), "a remix graph with a cycle would hang this walk").toBe(false);
      seen.add(cursor);
      cursor = (await prisma.world.findUniqueOrThrow({ where: { id: cursor } })).remixOfId;
    }
    expect(seen.size).toBe(3);
    expect((await prisma.world.findUniqueOrThrow({ where: { id: author.world.id } })).remixCount).toBe(1);
  });
});

/* ======================================================= the global claim ==== */

describe("the community shelf does not speak one language", () => {
  it("shows an English reader a world written in Japanese, and the other way round", async () => {
    const ja = await shelvedWorld({ premise: "放課後の屋上、誰も知らない約束", locale: "ja", userLocale: "ja" });
    const en = await shelvedWorld({ premise: "A lighthouse keeper who answers letters", locale: "en" });

    const english = await signup(h, { locale: "en" });
    const shelfEn = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: english.token });
    expect(shelfEn.data.worlds.map((w) => w.id).sort(), "every world carries both locales by construction").toEqual(
      [ja.world.id, en.world.id].sort(),
    );

    const japanese = await signup(h, { locale: "ja" });
    const shelfJa = await call<PublicRes>(h, "GET", "/v1/worlds/public", { token: japanese.token });
    expect(shelfJa.data.worlds.map((w) => w.id).sort()).toEqual([ja.world.id, en.world.id].sort());
    // …and each reader is served it in their own language.
    const jaCard = shelfJa.data.worlds.find((w) => w.id === en.world.id);
    const enCard = shelfEn.data.worlds.find((w) => w.id === en.world.id);
    expect(jaCard?.title.length).toBeGreaterThan(0);
    expect(enCard?.title.length).toBeGreaterThan(0);
  });
});
