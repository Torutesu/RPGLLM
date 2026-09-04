import { Hono } from "hono";
import type { Prisma } from "@prisma/client";
import { ChooseEventReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { fail, notFound, ok, parseBody } from "../http";
import { evaluateQuietly } from "../services/achievements";
import { pendingEvent } from "../services/events";
import { notifyFollowerMilestones } from "../services/notify";
import { computeMetrics } from "../services/rng";
import { readChoices, toApiEvent, toApiPost, toApiSnapshot } from "../services/serialize";
import { applyRelationshipDeltas, applyStatDeltas, loadStoryContext, pressAccount } from "../services/story";
import { EnergyRequiredError, ensureWallet, spendEnergy } from "../services/wallet";
import type { AppEnv } from "../types";

export function eventRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/pending", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const personaId = c.req.query("personaId");
    const persona = personaId
      ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
      : await deps.prisma.persona.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    if (!persona || persona.userId !== user.id) return notFound("Persona");
    const event = await pendingEvent(deps, persona.id);
    return ok({ event: event ? toApiEvent(event) : null });
  });

  /** SCR-014. The outcome text and deltas were generated with the event (no LLM call here). */
  app.post("/:id/choose", requireAuth, async (c) => {
    const body = await parseBody(c.req, ChooseEventReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const event = await deps.prisma.event.findUnique({ where: { id: c.req.param("id") } });
    if (!event) return notFound("Event");
    if (event.resolvedAt) return fail("ALREADY_DONE", "This event was already resolved", 409);

    const ctx = await loadStoryContext(deps.prisma, user, event.personaId);
    if (!ctx) return notFound("Event");

    const choice = readChoices(event.choices).find((ch) => ch.id === body.value.choiceId);
    if (!choice) return fail("VALIDATION", "Unknown choice", 400);

    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const applied = applyStatDeltas(ctx.persona, choice.statDeltas);

    let energy = wallet.energy;
    try {
      energy = await deps.prisma.$transaction(async (tx) => {
        const left = await spendEnergy(tx, wallet.id, `event:${event.id}`);
        await tx.persona.update({
          where: { id: ctx.persona.id },
          data: {
            followers: applied.followers, aura: applied.aura, humor: applied.humor,
            xp: applied.xp, level: applied.level, actionCount: { increment: 1 },
          },
        });
        await tx.event.update({ where: { id: event.id }, data: { chosenId: choice.id, resolvedAt: deps.clock.now() } });
        await notifyFollowerMilestones(tx, {
          personaId: ctx.persona.id,
          locale: ctx.locale,
          before: ctx.persona.followers,
          after: applied.followers,
        });
        return left;
      });
    } catch (err) {
      if (err instanceof EnergyRequiredError) return fail("ENERGY_REQUIRED", "Out of energy", 402);
      throw err;
    }

    const relDeltas = await deps.prisma.$transaction((tx) => applyRelationshipDeltas(tx, ctx, choice.relationshipDeltas));
    const snapshot = await deps.prisma.statSnapshot.create({
      data: {
        personaId: ctx.persona.id,
        cause: `event:${event.id}`,
        narrative: choice.outcomeText,
        followersDelta: applied.followersDelta,
        auraDelta: applied.auraDelta,
        humorDelta: applied.humorDelta,
        relDeltas: {
          deltas: relDeltas,
          after: { followers: applied.followers, aura: applied.aura, humor: applied.humor },
        } as unknown as Prisma.InputJsonValue,
      },
    });

    let newsPost = null;
    // The press account always reports the outcome (spec E2E-005): authored newsText when the
    // director wrote one, otherwise the outcome itself becomes the headline.
    const newsText = choice.newsText ?? choice.outcomeText;
    if (newsText) {
      const press = pressAccount(ctx.characters);
      if (press) {
        const row = await deps.prisma.post.create({
          data: {
            worldId: ctx.world.id,
            personaId: ctx.persona.id,
            authorCharacterId: press.id,
            kind: "news",
            text: newsText,
            generationId: event.generationId,
            createdAt: deps.clock.now(),
            metrics: {},
          },
        });
        const updated = await deps.prisma.post.update({
          where: { id: row.id },
          data: {
            metrics: { ...computeMetrics(row.id, applied.followers), causedBy: `event:${event.id}` } as unknown as Prisma.InputJsonValue,
          },
          include: { authorCharacter: true },
        });
        newsPost = toApiPost(updated, ctx.persona);
      }
    }

    // Agent L: the collection drive re-evaluates after every energy-spending action.
    await evaluateQuietly(deps.prisma, ctx.persona.id, ctx.locale);

    const persona = { followers: applied.followers, aura: applied.aura, humor: applied.humor };
    return ok({ snapshot: toApiSnapshot(snapshot, persona), newsPost, energy });
  });

  return app;
}
