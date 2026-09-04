import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PACING } from "@rpgllm/shared";
import { call, makeHarness, prisma, readSSE, resetDatabase, setEnergy, signupWithPersona, type Harness } from "./helpers";

let h: Harness;

beforeAll(() => { h = makeHarness(); });
beforeEach(async () => { await resetDatabase(); h.gateway.setMode("replay"); h.gateway.calls.length = 0; });

describe("drama events (E2E-005)", () => {
  it("surfaces an event on the 8th action and applies the chosen deltas", async () => {
    const fx = await signupWithPersona(h);
    // The press handle differs per world and between the stand-in and the real seeds, so read it
    // from the database rather than hardcoding a name.
    const press = await prisma.worldCharacter.findFirstOrThrow({ where: { isPressAccount: true } });
    const pressHandle = press.handle.replace(/^@/, "");
    await setEnergy(h, fx.token, 40);

    let lastEvents: Awaited<ReturnType<typeof readSSE>> = [];
    for (let i = 1; i <= PACING.EVENT_EVERY; i++) {
      const res = await call<{ post: { id: string }; streamUrl: string }>(h, "POST", "/v1/posts", {
        token: fx.token, body: { personaId: fx.personaId, text: `action ${i}`, parentId: null },
      });
      expect(res.status).toBe(201);
      lastEvents = await readSSE(h, res.data.streamUrl, fx.token);
      if (i < PACING.EVENT_EVERY) expect(lastEvents.map((e) => e.event)).not.toContain("event");
    }

    // prefetched at actionCount % 8 == 7, emitted after the 8th
    expect(h.gateway.calls.filter((c) => c.generator === "G5")).toHaveLength(1);
    expect(lastEvents.map((e) => e.event)).toContain("event");

    const pending = await call<{ event: { id: string; choices: { id: string; label: string }[] } | null }>(
      h, "GET", `/v1/events/pending?personaId=${fx.personaId}`, { token: fx.token },
    );
    const event = pending.data.event!;
    expect(event.choices).toHaveLength(3);

    const before = await prisma.persona.findUniqueOrThrow({ where: { id: fx.personaId } });
    const choice = event.choices[1]!;
    const chosen = await call<{ snapshot: { cause: string; followersDelta: number; auraDelta: number }; newsPost: { kind: string; author: { handle: string } } | null; energy: number }>(
      h, "POST", `/v1/events/${event.id}/choose`, { token: fx.token, body: { choiceId: choice.id } },
    );
    expect(chosen.status).toBe(200);
    expect(chosen.data.snapshot.cause).toBe(`event:${event.id}`);
    expect(chosen.data.snapshot.followersDelta).toBeGreaterThan(0);
    expect(chosen.data.newsPost?.kind).toBe("news");
    // The press handle differs per world (and between the stand-in and the real seeds), so assert
    // the role rather than the name.
    expect(chosen.data.newsPost?.author.handle).toBe(pressHandle);

    const after = await prisma.persona.findUniqueOrThrow({ where: { id: fx.personaId } });
    expect(after.followers).toBeGreaterThan(before.followers);
    expect(after.aura).toBeGreaterThan(before.aura);

    const resolved = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.chosenId).toBe(choice.id);

    const again = await call(h, "POST", `/v1/events/${event.id}/choose`, { token: fx.token, body: { choiceId: choice.id } });
    expect(again.status).toBe(409);
  });

  it("returns 402 when choosing with no energy", async () => {
    const fx = await signupWithPersona(h);
    await setEnergy(h, fx.token, 40);
    for (let i = 1; i <= PACING.EVENT_EVERY; i++) {
      const res = await call<{ streamUrl: string }>(h, "POST", "/v1/posts", {
        token: fx.token, body: { personaId: fx.personaId, text: `a${i}`, parentId: null },
      });
      await readSSE(h, res.data.streamUrl, fx.token);
    }
    const pending = await call<{ event: { id: string; choices: { id: string }[] } }>(h, "GET", "/v1/events/pending", { token: fx.token });
    await setEnergy(h, fx.token, 0);
    const res = await call(h, "POST", `/v1/events/${pending.data.event.id}/choose`, {
      token: fx.token, body: { choiceId: pending.data.event.choices[0]!.id },
    });
    expect(res.status).toBe(402);
  });
});
