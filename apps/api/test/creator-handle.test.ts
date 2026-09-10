/**
 * The name a world is credited to (gtm.md 勝ち筋 A ②).
 *
 * The credit used to be the creator's most recent persona handle, and a persona is per
 * (user, world) — so it moved when they started a second world, and it did not exist at all before
 * their first one. These cases pin the two properties that make a credit mean authorship: it is
 * never empty, and it never changes underneath a world.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runJobOnce, type JobDeps } from "../src/jobs/registry";
import {
  CREATOR_HANDLE_RE,
  adoptFirstPersonaHandle,
  createUserWithCreatorHandle,
  placeholderHandle,
} from "../src/services/creator-handle";
import { creatorHandles } from "../src/services/world-studio";
import { call, makeHarness, prisma, resetDatabase, signup, signupWithPersona, type Harness } from "./helpers";

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
});

/* ------------------------------------------------------------------ helpers ---- */

interface WorldFull {
  id: string;
  slug: string;
  status: string;
  creatorHandle: string | null;
}
interface CreateRes {
  world: WorldFull;
}
interface DetailRes {
  world: WorldFull;
}

const PREMISE = "Seven rookies, one debut slot, and a leaked group chat";

const createWorld = (token: string, visibility = "private") =>
  call<CreateRes>(h, "POST", "/v1/worlds", {
    token,
    body: { premise: PREMISE, genre: "idol", locale: "en", visibility },
  });

async function buildOnce(): Promise<void> {
  const record = await runJobOnce(deps, "world-build", { trigger: "test" });
  expect(record.error).toBeNull();
}

const handleOf = async (userId: string): Promise<string> =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { creatorHandle: true } })).creatorHandle;

const creditOn = async (token: string, worldId: string): Promise<string | null> =>
  (await call<DetailRes>(h, "GET", `/v1/worlds/${worldId}`, { token })).data.world.creatorHandle;

/** Force the wallet into existence, then top it up: a world costs every gem an account starts with. */
async function fundWorlds(token: string, userId: string): Promise<void> {
  await call(h, "GET", "/v1/wallet", { token });
  await prisma.wallet.update({ where: { userId }, data: { gems: 1000 } });
}

/** A world of the player's own, so a persona has somewhere else to live. */
async function aWorldOfTheirOwn(token: string): Promise<string> {
  const created = await createWorld(token);
  expect(created.status).toBe(201);
  await buildOnce();
  return created.data.world.id;
}

/* -------------------------------------------------------- never empty, ever ---- */

describe("every account has a name", () => {
  it("mints one at signup, before any persona exists", async () => {
    const { userId } = await signup(h);
    const handle = await handleOf(userId);
    expect(handle, "an account without a credit line cannot exist").toMatch(CREATOR_HANDLE_RE);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.creatorHandleClaimedAt, "and it is still a placeholder the first persona may replace").toBeNull();
  });

  it("gives every account a different one", async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, () => signup(h).then((s) => s.userId)));
    const handles = await Promise.all(ids.map(handleOf));
    expect(new Set(handles).size).toBe(handles.length);
  });

  it("reads as a name a person might have picked, not as a row id", () => {
    // The credit is the aspirational half of "made by @someone"; `user_7x3k9q` is product-hostile.
    expect(placeholderHandle("seed-a")).toMatch(/^[a-z]{6,12}\d{2}$/);
    expect(placeholderHandle("seed-a"), "deterministic, so a retry is not a new name").toBe(
      placeholderHandle("seed-a"),
    );
    expect(placeholderHandle("seed-b")).not.toBe(placeholderHandle("seed-a"));
  });

  /**
   * Two signups deriving the same candidate is the only way the unique index is ever contended,
   * so it is provoked directly: one seed, two rows, at the same time. The loser must be handed
   * another name, not a failed signup.
   */
  it("keeps the name unique when two signups race for it", async () => {
    const seed = "identical-seed";
    const [a, b] = await Promise.all([
      createUserWithCreatorHandle(
        prisma,
        {
          email: "race-a@example.com",
          authProvider: "email",
          authSubject: "race-a@example.com",
          birthYear: 1995,
          isMinor: false,
        },
        seed,
      ),
      createUserWithCreatorHandle(
        prisma,
        {
          email: "race-b@example.com",
          authProvider: "email",
          authSubject: "race-b@example.com",
          birthYear: 1995,
          isMinor: false,
        },
        seed,
      ),
    ]);
    expect(a.creatorHandle).not.toBe(b.creatorHandle);
    expect([a.creatorHandle, b.creatorHandle], "one of them still gets the name the seed asked for").toContain(
      placeholderHandle(`${seed}:0`),
    );
    expect(await prisma.user.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
  });

  it("never mints a name the cast of some world already goes by", async () => {
    const world = await prisma.world.findFirstOrThrow({ where: { isPreset: true } });
    const taken = placeholderHandle("cast-clash:0");
    await prisma.worldCharacter.create({
      data: {
        worldId: world.id,
        handle: `@${taken}`,
        displayName: "Squatter",
        role: "rival",
        card: { en: "", ja: "" },
      },
    });
    const user = await createUserWithCreatorHandle(
      prisma,
      {
        email: "clash@example.com",
        authProvider: "email",
        authSubject: "clash@example.com",
        birthYear: 1995,
        isMinor: false,
      },
      "cast-clash",
    );
    expect(user.creatorHandle).not.toBe(taken);
  });
});

/* ----------------------------------------------------------- the one upgrade ---- */

describe("the first persona names the account", () => {
  it("adopts the handle the player chose, once", async () => {
    const { userId } = await signupWithPersona(h, { handle: "rina" });
    expect(await handleOf(userId)).toBe("rina");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.creatorHandleClaimedAt).not.toBeNull();
  });

  /** The bug this whole change exists to kill. */
  it("does not move the credit on the first world when a second world gets a persona", async () => {
    const { token, userId } = await signupWithPersona(h, { handle: "rina" });
    await fundWorlds(token, userId);
    const firstWorldId = await aWorldOfTheirOwn(token);
    const creditBefore = await creditOn(token, firstWorldId);
    expect(creditBefore).toBe("rina");

    const secondWorldId = await aWorldOfTheirOwn(token);
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
      h,
      "GET",
      `/v1/worlds/${secondWorldId}`,
      { token },
    );
    const created = await call(h, "POST", "/v1/personas", {
      token,
      body: {
        worldId: secondWorldId,
        handle: "someoneelse",
        displayName: "Other",
        bio: "",
        avatarUrl: null,
        voiceNotes: "",
        firstFollowerId: detail.data.characters.find((c) => c.canBeFirstFollower)!.id,
        idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
      },
    });
    expect(created.status).toBe(201);

    expect(await handleOf(userId), "the account's name is not the newest persona's").toBe("rina");
    expect(await creditOn(token, firstWorldId), "an author whose name changes is not an author").toBe(creditBefore);
    expect(await creditOn(token, secondWorldId)).toBe("rina");
  });

  it("leaves the placeholder alone once something of theirs has been seen by somebody else", async () => {
    const { token, userId } = await signup(h);
    const placeholder = await handleOf(userId);
    const created = await createWorld(token);
    await buildOnce();
    const publish = await call(h, "POST", `/v1/worlds/${created.data.world.id}/publish`, {
      token,
      body: { visibility: "unlisted" },
    });
    expect(publish.status).toBe(200);

    // Only now do they make a persona. The name the world went out under wins.
    const detail = await call<{ characters: { id: string; canBeFirstFollower: boolean }[] }>(
      h,
      "GET",
      `/v1/worlds/${created.data.world.id}`,
      { token },
    );
    const persona = await call(h, "POST", "/v1/personas", {
      token,
      body: {
        worldId: created.data.world.id,
        handle: "latecomer",
        displayName: "Late",
        bio: "",
        avatarUrl: null,
        voiceNotes: "",
        firstFollowerId: detail.data.characters.find((c) => c.canBeFirstFollower)!.id,
        idempotencyKey: `idem-${Math.random().toString(36).slice(2)}`,
      },
    });
    expect(persona.status).toBe(201);
    expect(await handleOf(userId), "a name already published under does not change underneath it").toBe(placeholder);
  });

  it("will not take a name that belongs to some world's cast", async () => {
    const { userId } = await signup(h);
    const placeholder = await handleOf(userId);
    const world = await prisma.world.findFirstOrThrow({ where: { isPreset: true } });
    const cast = await prisma.worldCharacter.findFirstOrThrow({ where: { worldId: world.id } });
    const bare = cast.handle.replace(/^@+/, "").toLowerCase();

    const adopted = await adoptFirstPersonaHandle(prisma, userId, bare, h.clock.now());
    expect(adopted, "a credit confusable with a cast member is not a credit").toBeNull();
    expect(await handleOf(userId)).toBe(placeholder);
  });

  /**
   * `@rina` is free once per world, so two players legitimately both play as `@rina`. Only one of
   * them can be `@rina` to the whole product; the other keeps a name that is at least theirs.
   */
  it("gives the name to whoever asks first and leaves the other one whole", async () => {
    const first = await signupWithPersona(h, { handle: "rina" });
    const second = await signup(h);
    const placeholder = await handleOf(second.userId);
    const adopted = await adoptFirstPersonaHandle(prisma, second.userId, "rina", h.clock.now());
    expect(adopted).toBeNull();
    expect(await handleOf(second.userId)).toBe(placeholder);
    expect(await handleOf(first.userId)).toBe("rina");
  });

  it("spends its one attempt whether or not it succeeds", async () => {
    const { userId } = await signup(h);
    const placeholder = await handleOf(userId);
    // Loses to a cast handle...
    const world = await prisma.world.findFirstOrThrow({ where: { isPreset: true } });
    const cast = await prisma.worldCharacter.findFirstOrThrow({ where: { worldId: world.id } });
    expect(await adoptFirstPersonaHandle(prisma, userId, cast.handle.replace(/^@+/, ""), h.clock.now())).toBeNull();
    // ...and a later persona does not get a second go, which is what kept the credit moving before.
    expect(await adoptFirstPersonaHandle(prisma, userId, "another", h.clock.now())).toBeNull();
    expect(await handleOf(userId)).toBe(placeholder);
  });
});

/* ------------------------------------------------------------- the credit ---- */

describe("what a world is credited to", () => {
  /** e2e world-lifecycle QA-002: the studio is reachable before any persona exists. */
  it("credits a world built before its creator ever made a persona", async () => {
    const { token, userId } = await signup(h);
    expect(await prisma.persona.count({ where: { userId } })).toBe(0);
    const created = await createWorld(token);
    await buildOnce();

    expect(await creditOn(token, created.data.world.id), "no world is ever uncredited").not.toBeNull();
    expect(await creditOn(token, created.data.world.id)).toBe(await handleOf(userId));
  });

  it("reads the account, not the newest persona", async () => {
    const { userId } = await signupWithPersona(h, { handle: "rina" });
    const map = await creatorHandles(prisma, [userId]);
    expect(map.get(userId)).toBe("rina");
    // A persona row can be deleted (account export, purge); the credit is not stored there.
    await prisma.user.update({ where: { id: userId }, data: { creatorHandle: "renamed" } });
    expect((await creatorHandles(prisma, [userId])).get(userId)).toBe("renamed");
  });

  it("answers nothing for a creator that no longer exists", async () => {
    expect((await creatorHandles(prisma, ["nobody"])).get("nobody")).toBeUndefined();
    expect((await creatorHandles(prisma, [])).size).toBe(0);
  });
});

/* ------------------------------------------------------------- the migration ---- */

/**
 * The backfill runs against rows that already exist, so it is tested against rows that already
 * exist: a scratch database migrated to the commit *before* this change, filled with the shapes
 * that can go wrong, then migrated forward.
 */
describe("existing rows migrate", () => {
  const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const API = join(REPO_ROOT, "apps/api");
  const THIS_MIGRATION = "20260907140000_creator_handle";
  const DB = "rpgllm_creator_handle_migration";
  const ADMIN = "postgresql://postgres@127.0.0.1:5432/postgres";
  const URL = `postgresql://postgres@127.0.0.1:5432/${DB}`;

  const psql = (url: string, sql: string): string =>
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-tAq", url, "-c", sql], { encoding: "utf8" });

  const psqlFile = (url: string, file: string): void => {
    execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-q", url, "-f", file], { stdio: ["ignore", "ignore", "pipe"] });
  };

  it("gives every existing account a name, keeps the credit their worlds already show, and collides with nothing", () => {
    psql(ADMIN, `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    psql(ADMIN, `CREATE DATABASE "${DB}"`);
    try {
      // 1. every migration except this one, in order — the schema as it stands without this change.
      const MIGRATIONS = join(API, "prisma/migrations");
      const earlier = readdirSync(MIGRATIONS)
        .filter((name) => /^\d/.test(name) && name !== THIS_MIGRATION)
        .sort();
      expect(earlier.length, "the suite must be replaying real history, not an empty directory").toBeGreaterThan(0);
      for (const name of earlier) psqlFile(URL, join(MIGRATIONS, name, "migration.sql"));

      // 2. the rows that already exist, including every shape the backfill has to survive.
      psql(
        URL,
        `
        INSERT INTO "World" ("id","slug","title","scenario","bible","bibleTokens","genre")
        VALUES ('w1','w-one','{}','{}','{}',0,'idol'), ('w2','w-two','{}','{}','{}',0,'idol');
        INSERT INTO "WorldCharacter" ("id","worldId","handle","displayName","role","card")
        VALUES ('c1','w1','@bigbossmei','Mei','rival','{}');
        INSERT INTO "User" ("id","email","authProvider","authSubject","birthYear")
        VALUES ('u-latest','a@example.com','email','a',1995),
               ('u-early','b@example.com','email','b',1995),
               ('u-late','c@example.com','email','c',1995),
               ('u-cast','d@example.com','email','d',1995),
               ('u-none','e@example.com','email','e',1995);
        INSERT INTO "Persona" ("id","userId","worldId","handle","displayName","createdAt") VALUES
          -- the newest persona is the credit their worlds show today
          ('p1','u-latest','w1','oldname','A','2026-01-01'),
          ('p2','u-latest','w2','newname','A','2026-02-01'),
          -- two accounts playing under one handle: legitimate per world, impossible as a credit
          ('p3','u-early','w1','shared','B','2026-01-01'),
          ('p4','u-late','w2','shared','C','2026-03-01'),
          -- a handle some world's cast already goes by
          ('p5','u-cast','w2','bigbossmei','D','2026-01-01');
      `,
      );

      // 3. forward.
      psqlFile(URL, join(API, "prisma/migrations", THIS_MIGRATION, "migration.sql"));

      interface Row {
        handle: string;
        claimed: string;
      }
      const rows = new Map<string, Row>(
        psql(
          URL,
          `SELECT "id" || ' ' || "creatorHandle" || ' ' || (("creatorHandleClaimedAt" IS NOT NULL)::text) FROM "User" ORDER BY "id"`,
        )
          .trim()
          .split("\n")
          .map((line): [string, Row] => {
            const [id = "", handle = "", claimed = ""] = line.split(" ");
            return [id, { handle, claimed }];
          }),
      );
      const row = (id: string): Row => rows.get(id) ?? { handle: "", claimed: "" };

      expect(row("u-latest"), "the credit their worlds show today does not change on migration day").toEqual({
        handle: "newname",
        claimed: "true",
      });
      expect(row("u-early"), "the earlier persona keeps the shared handle").toEqual({
        handle: "shared",
        claimed: "true",
      });
      expect(row("u-late").handle, "and the later one is given a name of its own").not.toBe("shared");
      expect(row("u-cast").handle, "a cast handle is never adopted as a credit").not.toBe("bigbossmei");
      expect(row("u-none").handle, "an account that never had a persona still gets a name").toMatch(CREATOR_HANDLE_RE);
      expect(row("u-none").claimed, "and may still name itself with its first persona").toBe("false");

      for (const r of rows.values()) expect(r.handle).toMatch(CREATOR_HANDLE_RE);
      expect(new Set([...rows.values()].map((r) => r.handle)).size).toBe(5);
      expect(psql(URL, `SELECT count(*) FROM "User" WHERE "creatorHandle" IS NULL`).trim()).toBe("0");
      expect(
        psql(
          URL,
          `SELECT count(*) FROM information_schema.columns WHERE table_name='User' AND column_name='creatorHandle' AND is_nullable='NO'`,
        ).trim(),
        "and the invariant is the database's, not a convention",
      ).toBe("1");
    } finally {
      psql(ADMIN, `DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    }
  });
});
