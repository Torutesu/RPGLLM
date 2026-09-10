import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  adminAuthorized,
  identifyAdmin,
  parseAdminTokens,
  reviewerNameFor,
  SHARED_NAME,
} from "../src/services/admin-identity";
import { call, grantShelfGems, makeHarness, prisma, resetDatabase, signup, type Harness } from "./helpers";

/**
 * Who approved this world (production-readiness pass).
 *
 * The gate was one shared secret and the reviewer's name was a header the client wrote itself —
 * so a moderation record could be written in anybody's name by anybody past the gate, and a
 * reviewer leaving meant rotating a token for the whole team (which means nobody rotates it).
 */

function withEnv(patch: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(patch)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe("parsing the credential list", () => {
  it("reads name:secret pairs and drops what is not one", () => {
    expect(parseAdminTokens("rina:aaa, koji:bbb")).toEqual([
      { name: "rina", secret: "aaa" },
      { name: "koji", secret: "bbb" },
    ]);
    // A malformed entry must not throw: this runs on every admin request, and one stray comma
    // turning the moderation surface into a 500 is a worse outcome than one dead credential.
    expect(parseAdminTokens(",,:nope,noname,: ,ok:yes")).toEqual([{ name: "ok", secret: "yes" }]);
    expect(parseAdminTokens("")).toEqual([]);
  });

  it("keeps a secret containing a colon whole", () => {
    expect(parseAdminTokens("rina:aa:bb:cc")).toEqual([{ name: "rina", secret: "aa:bb:cc" }]);
  });
});

describe("identifying the caller", () => {
  it("names the reviewer whose secret matched", () => {
    restore = withEnv({ ADMIN_TOKENS: "rina:s1,koji:s2", ADMIN_TOKEN: "" });
    expect(identifyAdmin("s1")).toEqual({ name: "rina", attributable: true });
    expect(identifyAdmin("s2")).toEqual({ name: "koji", attributable: true });
    expect(identifyAdmin("s3")).toBeNull();
    expect(identifyAdmin(undefined)).toBeNull();
    expect(identifyAdmin("")).toBeNull();
  });

  it("accepts the shared token, and refuses to call it a person", () => {
    restore = withEnv({ ADMIN_TOKENS: "", ADMIN_TOKEN: "sharedsecret" });
    expect(identifyAdmin("sharedsecret")).toEqual({ name: SHARED_NAME, attributable: false });
    expect(adminAuthorized("sharedsecret")).toBe(true);
  });

  it("is closed when nothing is configured", () => {
    restore = withEnv({ ADMIN_TOKENS: "", ADMIN_TOKEN: "" });
    // An empty expected secret must never match an empty presented one.
    expect(identifyAdmin("")).toBeNull();
    expect(adminAuthorized("anything")).toBe(false);
  });
});

describe("the name a decision is recorded under", () => {
  it("ignores the header when the credential names a person", () => {
    const rina = { name: "rina", attributable: true };
    expect(reviewerNameFor(rina, "somebody-else", "admin")).toBe("rina");
  });

  it("marks a shared-token decision as unattributable", () => {
    const shared = { name: SHARED_NAME, attributable: false };
    expect(reviewerNameFor(shared, "koji", "admin")).toBe("shared:koji");
    expect(reviewerNameFor(shared, "", "admin")).toBe("shared");
  });

  it("falls back to the header only where there is no credential at all (the harness)", () => {
    expect(reviewerNameFor(null, "koji", "admin")).toBe("koji");
    expect(reviewerNameFor(null, "", "admin")).toBe("admin");
  });
});

describe("end to end, through the review queue", () => {
  let h: Harness;
  beforeAll(() => {
    h = makeHarness();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  /** A world sitting in the queue, submitted by a real account. */
  async function aWorldInReview(): Promise<string> {
    const author = await signup(h);
    await grantShelfGems(author.userId, 6);
    const created = await call<{ world: { id: string } }>(h, "POST", "/v1/worlds", {
      token: author.token,
      body: { premise: "Seven trainees and one debut slot", genre: "idol", locale: "en", visibility: "private" },
    });
    const worldId = created.data.world.id;
    await prisma.world.update({ where: { id: worldId }, data: { status: "review", reviewRequestedAt: new Date() } });
    return worldId;
  }

  it("records the reviewer named by the token, not the one named by the header", async () => {
    const worldId = await aWorldInReview();
    restore = withEnv({ ADMIN_TOKENS: "rina:s1", ADMIN_TOKEN: "" });

    const res = await call(h, "POST", `/v1/admin/worlds/${worldId}/review`, {
      body: { decision: "approve" },
      // The classic forgery: a real credential, somebody else's name on the decision.
      headers: { "x-admin-token": "s1", "x-reviewer": "koji" },
    });
    expect(res.status).toBe(200);

    const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
    expect(world.reviewedBy, "the credential names the reviewer").toBe("rina");
  });

  it("says out loud when a decision came from the shared token", async () => {
    const worldId = await aWorldInReview();
    restore = withEnv({ ADMIN_TOKENS: "", ADMIN_TOKEN: "sharedsecret" });

    await call(h, "POST", `/v1/admin/worlds/${worldId}/review`, {
      body: { decision: "approve" },
      headers: { "x-admin-token": "sharedsecret", "x-reviewer": "koji" },
    });
    const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
    expect(world.reviewedBy).toBe("shared:koji");
  });
});
