import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { call, makeHarness, prisma, readSSE, resetDatabase, signupWithPersona, type Harness } from "./helpers";

let h: Harness;
const TIERS = ["light", "mid", "high"] as const;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

describe("ratings and regeneration (E2E-014)", () => {
  it("escalates one model tier and swaps the reply text", async () => {
    const fx = await signupWithPersona(h);
    const post = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
      token: fx.token, body: { personaId: fx.personaId, text: "rate me", parentId: null },
    });
    const events = await readSSE(h, post.data.streamUrl, fx.token);
    const reply = events.find((e) => e.event === "reply")!.data["post"] as { id: string; text: string; generationId: string };

    const originalTier = h.gateway.calls.filter((c) => c.generator === "G1").at(-1)!.tier;

    const res = await call<{ replacement: { id: string; text: string; generationId: string } | null; newGenerationId: string | null }>(
      h, "POST", `/v1/generations/${reply.generationId}/rate?postId=${reply.id}`,
      { token: fx.token, body: { value: -1, regenerate: true } },
    );
    expect(res.status).toBe(200);
    expect(res.data.replacement?.id).toBe(reply.id);
    expect(res.data.replacement?.text).not.toBe(reply.text);

    const escalated = h.gateway.calls.filter((c) => c.generator === "G1").at(-1)!;
    expect(TIERS.indexOf(escalated.tier)).toBe(Math.min(TIERS.indexOf(originalTier) + 1, TIERS.length - 1));
    expect(escalated.escalatedFrom).toBe(reply.generationId);

    const newLog = await prisma.generationLog.findUniqueOrThrow({ where: { id: res.data.newGenerationId! } });
    expect(newLog.escalatedFrom).toBe(reply.generationId);

    const rating = await prisma.rating.findFirstOrThrow({ where: { generationId: reply.generationId } });
    expect(rating.regenerate).toBe(true);
    expect(rating.value).toBe(-1);

    // the test hook resolves the reply post to its new log, carrying escalatedFrom
    const hook = await call<{ logs: { id: string; escalatedFrom: string | null }[] }>(
      h, "GET", `/v1/__test/generations?postId=${reply.id}`, { token: fx.token },
    );
    expect(hook.data.logs.some((l) => l.escalatedFrom === reply.generationId)).toBe(true);
  });

  it("stores a 👍 without regenerating", async () => {
    const fx = await signupWithPersona(h);
    const post = await call<{ streamUrl: string }>(h, "POST", "/v1/posts", {
      token: fx.token, body: { personaId: fx.personaId, text: "good one", parentId: null },
    });
    const events = await readSSE(h, post.data.streamUrl, fx.token);
    const reply = events.find((e) => e.event === "reply")!.data["post"] as { generationId: string };
    const before = h.gateway.calls.length;

    const res = await call<{ replacement: unknown | null }>(h, "POST", `/v1/generations/${reply.generationId}/rate`, {
      token: fx.token, body: { value: 1, regenerate: false },
    });
    expect(res.data.replacement).toBeNull();
    expect(h.gateway.calls.length).toBe(before);
    expect(await prisma.rating.count({ where: { value: 1 } })).toBe(1);
  });
});
