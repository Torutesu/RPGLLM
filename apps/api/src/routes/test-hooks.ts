import { Hono } from "hono";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { TestLlmModeReqZ, TestSetEnergyReqZ, TestTimeTravelReqZ, type GeneratorId } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { ok, parseBody } from "../http";
import { metricsCausedBy } from "../services/serialize";
import { ensureWallet } from "../services/wallet";
import { seedDatabase } from "../seed";
import type { AppEnv } from "../types";

/**
 * Local rather than in `packages/shared`: a fixture knob for the harness is not part of the API
 * anyone ships against, and `/__test/*` is mounted only when `TEST_HOOKS=1`.
 */
const TestSetGemsReqZ = z.object({ gems: z.number().int().min(0).max(100_000) });

const GENERATORS: readonly string[] = ["G1", "G2", "G3", "G4", "G5", "G7", "G8", "G9", "G10", "GJ"];

/** Everything that persona/user state touches; World/WorldCharacter/AmbientPost survive a reset. */
const TRUNCATE_TABLES = [
  "Rating",
  "ExperimentAssignment",
  "LedgerEntry",
  "Purchase",
  "Subscription",
  "Wallet",
  "MemoryEntry",
  "RelationshipState",
  "StatSnapshot",
  "Event",
  "DMMessage",
  "DMThread",
  "Post",
  "Persona",
  "GenerationLog",
  "User",
] as const;

/** Mounted only when TEST_HOOKS=1 (build-plan §3). */
export function testHookRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/reset", async (c) => {
    const deps = c.get("deps");
    const state = c.get("state");
    const list = TRUNCATE_TABLES.map((t) => `"${t}"`).join(", ");
    await deps.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    // Time travel is process-wide: without this, E2E-015's +1 day would make every later case
    // seed onboarding posts a day in the future (they carry an explicit clock createdAt while
    // every other row uses the DB default) and invert the feed order.
    deps.clock.reset();
    state.softenedPosts.clear();
    state.softenedThreads.clear();
    state.personaIdempotency.clear();
    const worlds = await deps.prisma.world.count();
    if (worlds === 0) await seedDatabase(deps.prisma);
    return ok({ reset: true, worlds: await deps.prisma.world.count() });
  });

  app.post("/time-travel", async (c) => {
    const body = await parseBody(c.req, TestTimeTravelReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    deps.clock.offsetDays(body.value.days);
    return ok({ now: deps.clock.now().toISOString(), offsetMs: deps.clock.offsetMs() });
  });

  app.post("/llm-mode", async (c) => {
    const body = await parseBody(c.req, TestLlmModeReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    deps.gateway.setMode(body.value.mode);
    return ok({ mode: deps.gateway.mode() });
  });

  /**
   * GenerationLog inspection for E2E-009/013/014 (Agent D's contract in build-notes "## Agent D").
   *   ?postId=    logs linked to that post — its own generationId plus the ones on its replies /
   *               caused news post. A user post therefore yields exactly one G1 row; a reply post
   *               yields the row whose `escalatedFrom` points at its previous generation.
   *   ?messageId= same, for a DM message.
   *   ?generator= filter (G8 counts safety blocks); combined with an unmatched postId it falls back
   *               to the caller's logs for that generator, because G8 runs before a post exists.
   *   ?userId=    scope override (defaults to the bearer user).
   */
  app.get("/generations", requireAuth, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const scopeUserId = c.req.query("userId") ?? user.id;
    const generatorParam = c.req.query("generator");
    const generator =
      generatorParam && GENERATORS.includes(generatorParam as GeneratorId)
        ? (generatorParam as GeneratorId)
        : undefined;

    let linked: string[] | null = null;
    const postId = c.req.query("postId");
    if (postId) {
      const post = await deps.prisma.post.findUnique({ where: { id: postId } });
      const children = post
        ? await deps.prisma.post.findMany({ where: { parentId: post.id }, select: { generationId: true } })
        : [];
      const news = post?.personaId
        ? await deps.prisma.post.findMany({
            where: { personaId: post.personaId, kind: "news" },
            select: { generationId: true, metrics: true },
          })
        : [];
      const ids = new Set<string>();
      if (post?.generationId) ids.add(post.generationId);
      for (const child of children) if (child.generationId) ids.add(child.generationId);
      for (const n of news)
        if (n.generationId && metricsCausedBy(n.metrics) === `post:${postId}`) ids.add(n.generationId);
      linked = [...ids];
    }
    const messageId = c.req.query("messageId");
    if (messageId) {
      const message = await deps.prisma.dMMessage.findUnique({
        where: { id: messageId },
        select: { generationId: true },
      });
      linked = message?.generationId ? [message.generationId] : [];
    }

    const find = (where: Prisma.GenerationLogWhereInput) =>
      deps.prisma.generationLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });

    let rows = linked
      ? await find({ id: { in: linked }, ...(generator ? { generator } : {}) })
      : await find({ userId: scopeUserId, ...(generator ? { generator } : {}) });
    if (rows.length === 0 && generator) rows = await find({ userId: scopeUserId, generator });

    const logs = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      generator: r.generator,
      variantId: r.variantId,
      model: r.model,
      promptHash: r.promptHash,
      inputTokens: r.inputTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      cacheReadTokens: r.cacheReadTokens,
      outputTokens: r.outputTokens,
      costUsd: Number(r.costUsd),
      ttftMs: r.ttftMs,
      latencyMs: r.latencyMs,
      stopReason: r.stopReason,
      safetyVerdict: r.safetyVerdict,
      escalatedFrom: r.escalatedFrom,
      createdAt: r.createdAt.toISOString(),
    }));
    return ok({ logs });
  });

  /**
   * Gems, for a harness that needs to reach a screen behind a price.
   *
   * `WORLD_STUDIO.STARTER_GEMS` is exactly one world, so an account that has built one has an empty
   * wallet — and asking for a place on Explore now costs `WORLD_MODERATION.PUBLIC_SUBMIT_GEMS` on
   * top of it (gtm.md §2 exit 1, `services/world-submit-fee.ts`). Without this, an end-to-end case
   * that wants to exercise *review* has to exercise the 402 first, which is a different case.
   *
   * Deliberately a **set**, not a grant: a test that wants an empty wallet asks for `0` and gets a
   * wallet with no gems in it, which is the other half of the same feature. No ledger row is
   * written — this is a fixture, not a purchase, and the metrics count ledger rows.
   */
  app.post("/set-gems", requireAuth, async (c) => {
    const body = await parseBody(c.req, TestSetGemsReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const updated = await deps.prisma.wallet.update({ where: { id: wallet.id }, data: { gems: body.value.gems } });
    return ok({ gems: updated.gems });
  });

  app.post("/set-energy", requireAuth, async (c) => {
    const body = await parseBody(c.req, TestSetEnergyReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
    const updated = await deps.prisma.wallet.update({ where: { id: wallet.id }, data: { energy: body.value.energy } });
    return ok({ energy: updated.energy });
  });

  return app;
}
