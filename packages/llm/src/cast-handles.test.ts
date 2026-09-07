import { beforeEach, describe, expect, it } from "vitest";
import {
  askReserved,
  generatedHandleUniverse,
  handleLadder,
  handleStem,
  mintCastHandles,
  CAST_HANDLE_CONTRACT,
} from "./cast-handles.js";
import { createGateway } from "./gateway.js";
import { deterministicConcept } from "./generators/g9/blueprint.js";
import { resolveCastHandles } from "./generators/g9/rename-cast.js";
import { HANDLE_RE } from "./handles.js";
import type { G9Input } from "./generators/g9/types.js";

/**
 * The cast/creator handle collision (build-notes, Agent CREATOR-ID §2.3).
 *
 * The rule being held: a handle G9 mints can be moved out of the way of a name that already
 * belongs to somebody, and it is moved in the one window where moving it is free — after the
 * concept names it and before any other stage writes it down.
 */

beforeEach(() => {
  process.env.LLM_REPLAY_LATENCY_MS = "0";
});

const input = (over: Partial<G9Input> = {}): G9Input => ({
  slug: "seaside-storm",
  premise: "a murder mystery in a seaside town after a storm",
  genre: "mystery",
  locale: "en",
  seed: 4242,
  ...over,
});

describe("handle stems and ladders", () => {
  it("makes a legal stem out of anything", () => {
    expect(handleStem("@Rina")).toBe("rina");
    expect(handleStem("A")).toMatch(HANDLE_RE);
    expect(handleStem("wildly-illegal name!!")).toMatch(HANDLE_RE);
    expect(handleStem("averyveryverylonghandlename")).toMatch(HANDLE_RE);
  });

  it("offers only legal alternatives, starting with the name itself", () => {
    const ladder = handleLadder("rina", "seed");
    expect(ladder[0]).toBe("rina");
    expect(ladder.length).toBeGreaterThan(10);
    for (const h of ladder) expect(h).toMatch(HANDLE_RE);
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it("rotates the ladder by seed, so two worlds do not both land on the same alternative", () => {
    expect(handleLadder("rina", "world-a")[1]).not.toBe(handleLadder("rina", "world-b")[1]);
  });

  it("keeps a long stem inside 15 characters once a suffix is added", () => {
    for (const h of handleLadder("abcdefghijklmno", "s")) expect(h.length).toBeLessThanOrEqual(15);
  });
});

describe("mintCastHandles", () => {
  const cast = ["rina", "thescoop", "kenji", "mika"];

  it("changes nothing when nothing is reserved", () => {
    const mint = mintCastHandles({ candidates: cast, seed: "w" });
    expect(mint.handles).toEqual(cast);
    expect(mint.renamed).toEqual([]);
  });

  it("moves only the reserved name, and says so", () => {
    const mint = mintCastHandles({ candidates: cast, reserved: ["rina"], seed: "w" });
    expect(mint.handles).not.toContain("rina");
    expect(mint.handles.slice(1)).toEqual(["thescoop", "kenji", "mika"]);
    expect(mint.renamed).toHaveLength(1);
    expect(mint.renamed[0]).toMatchObject({ from: "rina", reason: "reserved" });
  });

  it("compares case-insensitively and ignores a leading @ on either side", () => {
    const mint = mintCastHandles({ candidates: ["@Rina"], reserved: ["RINA"], seed: "w" });
    expect(mint.handles[0]).not.toBe("rina");
  });

  it("is deterministic in the seed", () => {
    const a = mintCastHandles({ candidates: cast, reserved: ["rina"], seed: "w" });
    const b = mintCastHandles({ candidates: cast, reserved: ["rina"], seed: "w" });
    expect(a.handles).toEqual(b.handles);
  });

  it("resolves a duplicate inside one cast", () => {
    const mint = mintCastHandles({ candidates: ["rina", "rina"], seed: "w" });
    expect(mint.handles[0]).toBe("rina");
    expect(mint.handles[1]).not.toBe("rina");
    expect(mint.renamed[0]?.reason).toBe("duplicate");
  });

  it("repairs an illegal candidate rather than emitting it", () => {
    const mint = mintCastHandles({ candidates: ["@Not A Handle!"], seed: "w" });
    expect(mint.handles[0]).toMatch(HANDLE_RE);
    expect(mint.renamed[0]?.reason).toBe("illegal");
  });

  it("still returns a legal, unique handle when the whole ladder is reserved", () => {
    const ladder = handleLadder("rina", "w");
    const mint = mintCastHandles({ candidates: ["rina"], reserved: ladder, seed: "w" });
    expect(mint.handles[0]).toMatch(HANDLE_RE);
    expect(mint.handles).toHaveLength(1);
  });
});

describe("the enumerable half of the generated namespace", () => {
  it("lists every handle the deterministic generator can mint, all API-legal", () => {
    const universe = generatedHandleUniverse();
    expect(universe.length).toBeGreaterThan(50);
    for (const h of universe) expect(h).toMatch(HANDLE_RE);
    expect(universe).toContain("thefeedwire"); // a press handle
    expect(new Set(universe).size).toBe(universe.length);
  });

  it("covers the handles a fallback world actually ships", () => {
    const universe = new Set(generatedHandleUniverse());
    const concept = deterministicConcept(input());
    for (const member of concept.cast) expect(universe.has(member.handle)).toBe(true);
  });

  it("tells apps/api what to do", () => {
    expect(CAST_HANDLE_CONTRACT).toContain("reserveCastHandles");
    expect(CAST_HANDLE_CONTRACT).toContain("creatorHandle");
  });
});

describe("askReserved — the hook is never allowed to cost the world", () => {
  it("reports absence rather than failing", async () => {
    expect(await askReserved(undefined, ["a"])).toEqual({ reserved: [], status: "absent" });
  });

  it("swallows a throwing hook", async () => {
    const res = await askReserved(() => {
      throw new Error("db down");
    }, ["a"]);
    expect(res).toEqual({ reserved: [], status: "error" });
  });

  it("gives up on a hanging hook", async () => {
    const res = await askReserved(() => new Promise(() => undefined), ["a"], 5);
    expect(res.status).toBe("timeout");
    expect(res.reserved).toEqual([]);
  });

  it("passes a good answer through", async () => {
    const res = await askReserved(async (h) => h.filter((x) => x === "rina"), ["rina", "kenji"]);
    expect(res).toEqual({ reserved: ["rina"], status: "ok" });
  });
});

describe("resolveCastHandles — renaming while it is still free", () => {
  it("does nothing without a hook", async () => {
    const concept = deterministicConcept(input());
    const out = await resolveCastHandles(input(), concept, undefined);
    expect(out.status).toBe("absent");
    expect(out.renamed).toEqual([]);
    expect(out.concept.cast.map((c) => c.handle)).toEqual(concept.cast.map((c) => c.handle));
  });

  it("moves the colliding handle and rewrites every mention of it", async () => {
    const base = input();
    const concept = deterministicConcept(base);
    const taken = concept.cast[0]?.handle ?? "";
    const out = await resolveCastHandles(base, concept, async () => [taken]);

    expect(out.renamed).toHaveLength(1);
    const moved = out.concept.cast[0]?.handle ?? "";
    expect(moved).not.toBe(taken);
    expect(moved).toMatch(HANDLE_RE);
    expect(out.concept.cast).toHaveLength(concept.cast.length);
    expect(new Set(out.concept.cast.map((c) => c.handle)).size).toBe(concept.cast.length);
    // no reference to the discarded name survives anywhere in the concept. The replacement may
    // *contain* the old name (the ladder appends a suffix), so the check is on the handle
    // boundary, exactly as the rewrite itself is.
    const mention = new RegExp(`@${taken}(?![a-z0-9_])`);
    expect(mention.test(JSON.stringify(out.concept))).toBe(false);
    expect(out.concept.cast[0]?.avatarKey ?? "").toContain(moved);
  });

  it("keeps the model's names when the hook misbehaves", async () => {
    const base = input();
    const concept = deterministicConcept(base);
    const out = await resolveCastHandles(base, concept, () => {
      throw new Error("boom");
    });
    expect(out.concept.cast.map((c) => c.handle)).toEqual(concept.cast.map((c) => c.handle));
    expect(out.status).toBe("error");
  });
});

describe("through the gateway — the world never learns the discarded name", () => {
  it("keeps a reserved creator handle out of the cast, the bible and the ambient pool", async () => {
    const gateway = createGateway({ mode: "replay" });
    const base = input({ slug: "collision-world" });

    const before = await gateway.g9(base);
    const taken = before.output.cast[0]?.handle ?? "";
    expect(taken).not.toBe("");

    const renames: string[] = [];
    const after = await gateway.g9(base, {
      reserveCastHandles: async (handles) => handles.filter((h) => h === taken),
      onCastRenamed: (o) => {
        for (const r of o.renamed) renames.push(`${r.from}->${r.to}`);
      },
    });

    expect(renames).toHaveLength(1);
    const world = after.output;
    expect(world.cast.map((c) => c.handle)).not.toContain(taken);
    expect(Object.keys(world.fallbackReplies)).not.toContain(taken);
    expect(Object.keys(world.welcomePosts)).not.toContain(taken);
    expect(world.ambientPool.en?.some((p) => p.handle === taken)).toBe(false);
    const mention = new RegExp(`@${taken}(?![a-z0-9_])`);
    expect(mention.test(world.bible.en ?? "")).toBe(false);
    expect(mention.test(world.bible.ja ?? "")).toBe(false);
    // and it is still a complete, valid world
    expect(world.cast).toHaveLength(8);
    expect(after.meta.fallback).toBe(false);
  });

  it("costs no extra model call", async () => {
    const calls: string[] = [];
    const gateway = createGateway({
      mode: "replay",
      onGeneration: (m) => {
        calls.push(m.variantId);
      },
    });
    const base = input({ slug: "no-extra-call" });
    await gateway.g9(base, { reserveCastHandles: async (h) => [h[0] ?? ""] });
    expect(calls).toHaveLength(14);
  });
});
