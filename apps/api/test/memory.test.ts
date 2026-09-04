import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PACING } from "@rpgllm/shared";
import { call, makeHarness, prisma, resetDatabase, signupWithPersona, type Harness, type PersonaFixture } from "./helpers";

let h: Harness;

interface LedgerBody {
  character: { handle: string; displayName: string; avatarUrl: string | null };
  affinity: number;
  summary: string;
  memories: { id: string; note: string; sourceRef: string; quote: string | null; consolidated: boolean; createdAt: string }[];
}

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.calls.length = 0; });

/** The relationship with the persona's first follower, plus a real post to quote. */
async function seedNotes(p: PersonaFixture, count: number, extraRef?: string) {
  const relationship = await prisma.relationshipState.findFirstOrThrow({
    where: { personaId: p.personaId, characterId: p.firstFollowerId },
  });
  const post = await prisma.post.findFirstOrThrow({ where: { personaId: p.personaId }, orderBy: { createdAt: "desc" } });
  for (let i = 0; i < count; i += 1) {
    await prisma.memoryEntry.create({
      data: { relationshipId: relationship.id, note: `they said thing #${i}`, sourceRef: `post:${post.id}` },
    });
  }
  if (extraRef) {
    await prisma.memoryEntry.create({
      data: { relationshipId: relationship.id, note: "a receipt whose source is gone", sourceRef: extraRef },
    });
  }
  return { relationship, post };
}

const handleOf = (p: PersonaFixture): string =>
  p.characters.find((ch) => ch.id === p.firstFollowerId)?.handle ?? "";

describe("relationship memory ledger + G7 consolidation (S2-3, AIF-002)", () => {
  it("returns the notes with their quoted source, and null when the source is gone", async () => {
    const p = await signupWithPersona(h);
    const { post } = await seedNotes(p, 2, "post:does-not-exist");

    const res = await call<LedgerBody>(h, "GET", `/v1/memory/${handleOf(p)}?personaId=${p.personaId}`, { token: p.token });
    expect(res.status).toBe(200);
    expect(res.data.character.handle).toBe(handleOf(p));
    expect(res.data.memories).toHaveLength(3);
    const quoted = res.data.memories.filter((m) => m.quote !== null);
    expect(quoted).toHaveLength(2);
    expect(quoted[0]?.quote).toBe(post.text);
    expect(res.data.memories.find((m) => m.sourceRef === "post:does-not-exist")?.quote).toBeNull();

    // Below PACING.MEMORY_CONSOLIDATE_AT nothing is folded.
    expect(h.gateway.calls.some((c) => c.generator === "G7")).toBe(false);
    expect(res.data.memories.every((m) => !m.consolidated)).toBe(true);
  });

  it("collapses the backlog with G7 and writes back the relationship + world summary", async () => {
    const p = await signupWithPersona(h);
    const { relationship } = await seedNotes(p, PACING.MEMORY_CONSOLIDATE_AT);
    expect(relationship.summary).toBe("");

    const res = await call<LedgerBody>(h, "GET", `/v1/memory/${p.firstFollowerId}?personaId=${p.personaId}`, { token: p.token });
    expect(res.status).toBe(200);

    // G7 is the generator the gap analysis found was never called anywhere.
    const g7 = h.gateway.calls.filter((c) => c.generator === "G7");
    expect(g7).toHaveLength(1);

    expect(res.data.summary.length).toBeGreaterThan(0);
    expect(res.data.memories).toHaveLength(PACING.MEMORY_CONSOLIDATE_AT);
    expect(res.data.memories.every((m) => m.consolidated), "every folded note is marked").toBe(true);

    const after = await prisma.relationshipState.findUniqueOrThrow({ where: { id: relationship.id } });
    expect(after.summary.length).toBeGreaterThan(0);
    expect(after.summary).toContain("thing #0");
    const persona = await prisma.persona.findUniqueOrThrow({ where: { id: p.personaId } });
    expect(persona.worldSummary.length).toBeGreaterThan(0);

    // Nothing left to fold → a second read makes no further G7 call.
    await call(h, "GET", `/v1/memory/${p.firstFollowerId}?personaId=${p.personaId}`, { token: p.token });
    expect(h.gateway.calls.filter((c) => c.generator === "G7")).toHaveLength(1);
    expect(await prisma.generationLog.count({ where: { generator: "G7", userId: p.userId } })).toBe(1);
  });

  it("consolidates from the job hook too (no scheduler in this build)", async () => {
    const p = await signupWithPersona(h);
    await seedNotes(p, PACING.MEMORY_CONSOLIDATE_AT);

    const job = await call<{ memory: { personas: number; relationships: number; notes: number } | null }>(
      h, "POST", "/v1/__test/run-job", { body: { job: "memory", personaId: p.personaId } },
    );
    expect(job.status).toBe(200);
    expect(job.data.memory?.relationships).toBe(1);
    expect(job.data.memory?.notes).toBe(PACING.MEMORY_CONSOLIDATE_AT);
    expect(await prisma.memoryEntry.count({ where: { consolidated: false } })).toBe(0);
  });

  it("refuses a character the persona has no relationship with, and another user's persona", async () => {
    const p = await signupWithPersona(h);
    const other = await signupWithPersona(h);

    const unknown = await call(h, "GET", `/v1/memory/nobody-here?personaId=${p.personaId}`, { token: p.token });
    expect(unknown.status).toBe(404);

    const stolen = await call(h, "GET", `/v1/memory/${handleOf(p)}?personaId=${p.personaId}`, { token: other.token });
    expect(stolen.status).toBe(404);
  });
});
