import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, SAFETY_BLOCK_TEST_PHRASES } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

describe("DMs (E2E-006)", () => {
  it("lists followers, sends a message for 1 energy and streams bubbles + affinity", async () => {
    const fx = await signupWithPersona(h);

    const inbox = await call<{ threads: unknown[]; followers: { id: string; handle: string }[] }>(
      h, "GET", `/v1/dms?personaId=${fx.personaId}`, { token: fx.token },
    );
    expect(inbox.data.threads).toHaveLength(0);
    expect(inbox.data.followers.map((f) => f.handle)).toContain("@hivequeenbea");

    const thread = await call<{ thread: { id: string; character: { handle: string } } }>(h, "POST", "/v1/dms", {
      token: fx.token, body: { personaId: fx.personaId, characterId: fx.firstFollowerId },
    });
    expect(thread.status).toBe(201);
    const threadId = thread.data.thread.id;

    const sent = await call<{ message: { id: string; fromCharacter: boolean }; streamUrl: string }>(
      h, "POST", `/v1/dms/${threadId}/messages`, { token: fx.token, body: { text: "did you see gmz?" } },
    );
    expect(sent.status).toBe(201);
    expect(sent.data.message.fromCharacter).toBe(false);
    expect((await getWallet(h, fx.token)).data.energy).toBe(ENERGY.FREE_DAILY - 1);

    const events = await readSSE(h, sent.data.streamUrl, fx.token);
    const names = events.map((e) => e.event);
    expect(names.filter((n) => n === "message").length).toBeGreaterThanOrEqual(1);
    expect(names).toContain("affinity");
    expect(names.at(-1)).toBe("done");

    const affinity = events.find((e) => e.event === "affinity")!.data;
    expect(affinity["delta"]).toBe(1);
    expect(affinity["affinity"]).toBe(21);

    const detail = await call<{ messages: { fromCharacter: boolean }[]; relationship: { affinity: number; isFollower: boolean } }>(
      h, "GET", `/v1/dms/${threadId}`, { token: fx.token },
    );
    expect(detail.data.messages.filter((m) => m.fromCharacter).length).toBeGreaterThanOrEqual(1);
    expect(detail.data.relationship.affinity).toBe(21);
    expect(detail.data.relationship.isFollower).toBe(true);

    // replaying the stream must not produce new bubbles
    const bubbleCount = await prisma.dMMessage.count({ where: { threadId, fromCharacter: true } });
    await readSSE(h, sent.data.streamUrl, fx.token);
    expect(await prisma.dMMessage.count({ where: { threadId, fromCharacter: true } })).toBe(bubbleCount);
  });

  it("blocks unsafe DM input with 422 and no energy spent", async () => {
    const fx = await signupWithPersona(h);
    const thread = await call<{ thread: { id: string } }>(h, "POST", "/v1/dms", {
      token: fx.token, body: { personaId: fx.personaId, characterId: fx.firstFollowerId },
    });
    const before = (await getWallet(h, fx.token)).data.energy;
    const res = await call(h, "POST", `/v1/dms/${thread.data.thread.id}/messages`, {
      token: fx.token, body: { text: SAFETY_BLOCK_TEST_PHRASES[1]! },
    });
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe("SAFETY_BLOCKED");
    expect((await getWallet(h, fx.token)).data.energy).toBe(before);
  });

  it("refunds the energy when G4 falls back", async () => {
    const fx = await signupWithPersona(h);
    const thread = await call<{ thread: { id: string } }>(h, "POST", "/v1/dms", {
      token: fx.token, body: { personaId: fx.personaId, characterId: fx.firstFollowerId },
    });
    await call(h, "POST", "/v1/__test/llm-mode", { token: fx.token, body: { mode: "fail" } });
    const sent = await call<{ streamUrl: string }>(h, "POST", `/v1/dms/${thread.data.thread.id}/messages`, {
      token: fx.token, body: { text: "hello?" },
    });
    expect((await getWallet(h, fx.token)).data.energy).toBe(ENERGY.FREE_DAILY - 1);
    const events = await readSSE(h, sent.data.streamUrl, fx.token);
    expect(events.map((e) => e.event)).toContain("fallback");
    expect((await getWallet(h, fx.token)).data.energy).toBe(ENERGY.FREE_DAILY);
  });
});
