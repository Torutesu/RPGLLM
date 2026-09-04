import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ENERGY, PACING, SAFETY_BLOCK_TEST_PHRASES } from "@rpgllm/shared";
import { call, getWallet, makeHarness, prisma, readSSE, resetDatabase, setEnergy, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

const createPost = (token: string, personaId: string, text: string, parentId: string | null = null) =>
  call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", { token, body: { personaId, text, parentId } });

describe("posting and the reply stream (E2E-003, E2E-009, E2E-010)", () => {
  it("spends 1 energy and streams reply×3 → stat → done in order", async () => {
    const fx = await signupWithPersona(h);
    const res = await createPost(fx.token, fx.personaId, "new song Friday");
    expect(res.status).toBe(201);
    expect(res.data.streamUrl).toBe(`/v1/posts/${res.data.post.id}/stream`);
    expect((await getWallet(h, fx.token)).data.energy).toBe(ENERGY.FREE_DAILY - 1);

    const events = await readSSE(h, res.data.streamUrl, fx.token);
    const names = events.map((e) => e.event);
    expect(names.filter((n) => n === "reply")).toHaveLength(PACING.K_INITIAL);
    expect(names).toEqual([...Array(PACING.K_INITIAL).fill("reply"), "stat", "done"]);

    const stat = events.find((e) => e.event === "stat")!.data["snapshot"] as Record<string, unknown>;
    expect(typeof stat["narrative"]).toBe("string");
    expect((stat["after"] as { followers: number }).followers).toBeGreaterThan(0);
    expect(events.at(-1)!.data["energy"]).toBe(ENERGY.FREE_DAILY - 1);

    const replies = await prisma.post.findMany({ where: { parentId: res.data.post.id, kind: "character" } });
    expect(replies).toHaveLength(PACING.K_INITIAL);
    expect(replies.every((r) => r.generationId !== null)).toBe(true);
  });

  it("accepts ?token= instead of the Authorization header on the stream (Agent C: EventSource)", async () => {
    const fx = await signupWithPersona(h);
    const res = await createPost(fx.token, fx.personaId, "token in the query");
    const streamed = await h.app.request(`${res.data.streamUrl}?token=${fx.token}`);
    expect(streamed.status).toBe(200);
    const text = await streamed.text();
    expect(text).toContain("event: done");
  });

  it("is idempotent: a second GET replays without calling G1 again", async () => {
    const fx = await signupWithPersona(h);
    const res = await createPost(fx.token, fx.personaId, "replay me");
    const first = await readSSE(h, res.data.streamUrl, fx.token);
    const g1After = h.gateway.calls.filter((c) => c.generator === "G1").length;
    const second = await readSSE(h, res.data.streamUrl, fx.token);
    expect(h.gateway.calls.filter((c) => c.generator === "G1").length).toBe(g1After);
    expect(second.filter((e) => e.event === "reply")).toHaveLength(first.filter((e) => e.event === "reply").length);
    expect(await prisma.post.count({ where: { parentId: res.data.post.id } })).toBe(PACING.K_INITIAL);
  });

  it("returns 402 ENERGY_REQUIRED when the tank is empty", async () => {
    const fx = await signupWithPersona(h);
    await setEnergy(h, fx.token, 0);
    const res = await createPost(fx.token, fx.personaId, "no energy left");
    expect(res.status).toBe(402);
    expect(res.error?.code).toBe("ENERGY_REQUIRED");
    expect(await prisma.post.count({ where: { kind: "user" } })).toBe(0);
  });

  it("blocks unsafe input with 422 and spends no energy, but still logs G8", async () => {
    const fx = await signupWithPersona(h);
    await setEnergy(h, fx.token, 5);
    const phrase = SAFETY_BLOCK_TEST_PHRASES[2]!;
    const res = await createPost(fx.token, fx.personaId, phrase);
    expect(res.status).toBe(422);
    expect(res.error?.code).toBe("SAFETY_BLOCKED");
    expect((await getWallet(h, fx.token)).data.energy).toBe(5);
    expect(await prisma.post.count({ where: { kind: "user" } })).toBe(0);

    const blocks = await prisma.generationLog.count({ where: { generator: "G8", safetyVerdict: "block" } });
    expect(blocks).toBe(1);

    const hook = await call<{ logs: { generator: string; safetyVerdict: string | null }[] }>(
      h, "GET", "/v1/__test/generations?generator=G8", { token: fx.token },
    );
    expect(hook.data.logs.filter((l) => l.safetyVerdict === "block")).toHaveLength(1);
  });

  it("refunds the energy when the generation falls back (LLM_MODE=fail)", async () => {
    const fx = await signupWithPersona(h);
    await setEnergy(h, fx.token, 5);
    await call(h, "POST", "/v1/__test/llm-mode", { token: fx.token, body: { mode: "fail" } });

    const res = await createPost(fx.token, fx.personaId, "the world is on fire");
    expect(res.status).toBe(201);
    expect((await getWallet(h, fx.token)).data.energy).toBe(4);

    const events = await readSSE(h, res.data.streamUrl, fx.token);
    expect(events.map((e) => e.event)).toContain("fallback");
    expect(events.at(-1)!.data["energy"]).toBe(5);
    expect((await getWallet(h, fx.token)).data.energy).toBe(5);
    // the post and canned replies still exist — the app never breaks
    expect(await prisma.post.count({ where: { parentId: res.data.post.id } })).toBeGreaterThan(0);
  });

  it("exposes the thread and generates extra reactions exactly once", async () => {
    const fx = await signupWithPersona(h);
    const res = await createPost(fx.token, fx.personaId, "load more please");
    await readSSE(h, res.data.streamUrl, fx.token);

    const detail = await call<{ replies: unknown[]; moreAvailable: boolean }>(h, "GET", `/v1/posts/${res.data.post.id}`, { token: fx.token });
    expect(detail.data.replies).toHaveLength(PACING.K_INITIAL);
    expect(detail.data.moreAvailable).toBe(true);

    const energyBefore = (await getWallet(h, fx.token)).data.energy;
    const more = await call<{ replies: unknown[] }>(h, "POST", `/v1/posts/${res.data.post.id}/more-replies`, { token: fx.token });
    expect(more.status).toBe(200);
    expect(more.data.replies).toHaveLength(PACING.K_MORE);
    expect((await getWallet(h, fx.token)).data.energy).toBe(energyBefore);

    const again = await call(h, "POST", `/v1/posts/${res.data.post.id}/more-replies`, { token: fx.token });
    expect(again.status).toBe(409);
    expect(again.error?.code).toBe("ALREADY_DONE");
  });

  it("logs exactly one G1 GenerationLog per post with 4 token counts and costUsd > 0 (E2E-013)", async () => {
    const fx = await signupWithPersona(h);
    const res = await createPost(fx.token, fx.personaId, "receipts on the way");
    await readSSE(h, res.data.streamUrl, fx.token);

    const hook = await call<{ logs: { generator: string; variantId: string; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }[] }>(
      h, "GET", `/v1/__test/generations?postId=${res.data.post.id}`, { token: fx.token },
    );
    const g1 = hook.data.logs.filter((l) => l.generator === "G1");
    expect(g1).toHaveLength(1);
    expect(g1[0]!.costUsd).toBeGreaterThan(0);
    expect(g1[0]!.inputTokens).toBeGreaterThan(0);
    expect(g1[0]!.outputTokens).toBeGreaterThan(0);
    expect(g1[0]!.cacheReadTokens).toBeGreaterThanOrEqual(0);
    expect(g1[0]!.cacheWriteTokens).toBeGreaterThanOrEqual(0);

    const assignments = await call<Record<string, string>>(h, "GET", "/v1/experiments/assignments", { token: fx.token });
    expect(g1[0]!.variantId).toBe(assignments.data["g1_model"]);
  });
});
