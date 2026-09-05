import { Hono } from "hono";
import type { Persona } from "@prisma/client";
import { BlockReqZ, ReportReqZ } from "@rpgllm/shared";
import { requireAuth } from "../auth";
import { testHooksEnabled } from "../env";
import { fail, notFound, ok, parseBody } from "../http";
import { requireActiveAccount } from "../services/account";
import { adminTokenMatches, blockedCharacterIds, createReport, findOpenReport, loadReportedContent } from "../services/moderation";
import { pullWorldIfBrigaded, tellCreatorPulled } from "../services/world-moderation";
import { logLine } from "../middleware/request-log";
import type { LocaleKey } from "../services/locale";
import type { AppEnv, Deps } from "../types";

const bareHandle = (handle: string): string => handle.replace(/^@+/, "");

/** The caller's persona: the one named by `personaId`, else their most recent. */
async function ownPersona(deps: Deps, userId: string, personaId?: string): Promise<Persona | null> {
  const persona = personaId
    ? await deps.prisma.persona.findUnique({ where: { id: personaId } })
    : await deps.prisma.persona.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  return persona && persona.userId === userId ? persona : null;
}

/** S1-2 report & block (App Store Guideline 1.2). Mounted at `/v1/moderation`. */
export function moderationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * SCR-037. The snapshot and the originating generation are resolved server-side.
   *
   * A report against a **world** has a consequence, not just a row: once
   * `WORLD_MODERATION.REPORTS_TO_PULL` distinct people have an open report against a world that is
   * live in Explore, it comes off the shelf and goes back to a human — in *this* transaction, at
   * the moment the threshold is crossed. See `services/world-moderation.ts` for why counting and
   * pulling under the world row's own lock is safe when the reports arrive at once.
   */
  app.post("/report", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, ReportReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const { target, targetId, reason, note } = body.value;

    const content = await loadReportedContent(deps.prisma, target, targetId, user.id);
    if (!content) return notFound("Reported content");

    const duplicate = await findOpenReport(deps.prisma, user.id, target, targetId);
    if (duplicate) return fail("ALREADY_DONE", "You have already reported this", 409);

    const now = deps.clock.now();
    const filed = await deps.prisma.$transaction(async (tx) => {
      const report = await createReport(tx, {
        userId: user.id,
        target,
        targetId,
        reason,
        note,
        snapshot: content.snapshot,
        generationId: content.generationId,
        createdAt: now,
      });
      if (target !== "world") return { report, pulled: false, reporters: 0 };

      const outcome = await pullWorldIfBrigaded(tx, targetId, now);
      if (outcome.pulled) {
        const world = await tx.world.findUniqueOrThrow({ where: { id: targetId } });
        await tellCreatorPulled(tx, world, (world.genLocale ?? "en") as LocaleKey);
      }
      return { report, ...outcome };
    });

    if (filed.pulled) {
      logLine({
        level: "warn", msg: "world.pulled", worldId: targetId, reporters: filed.reporters, reason,
      });
    }
    return ok({ id: filed.report.id, status: filed.report.status }, 201);
  });

  /** Blocking is what makes the report meaningful: the character leaves feed, DMs and the cast. */
  app.post("/block", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, BlockReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await ownPersona(deps, user.id, body.value.personaId);
    if (!persona) return notFound("Persona");
    const character = await deps.prisma.worldCharacter.findUnique({ where: { id: body.value.characterId } });
    if (!character || character.worldId !== persona.worldId) return notFound("Character");

    const existing = await deps.prisma.blockedCharacter.findUnique({
      where: { personaId_characterId: { personaId: persona.id, characterId: character.id } },
    });
    if (existing) return fail("BLOCKED", "Already blocked", 409);

    await deps.prisma.blockedCharacter.create({
      data: { personaId: persona.id, characterId: character.id, createdAt: deps.clock.now() },
    });
    return ok({ blocked: true, characterId: character.id, handle: bareHandle(character.handle) }, 201);
  });

  app.post("/unblock", requireAuth, requireActiveAccount, async (c) => {
    const body = await parseBody(c.req, BlockReqZ);
    if (!body.ok) return body.res;
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await ownPersona(deps, user.id, body.value.personaId);
    if (!persona) return notFound("Persona");
    const removed = await deps.prisma.blockedCharacter.deleteMany({
      where: { personaId: persona.id, characterId: body.value.characterId },
    });
    if (removed.count === 0) return notFound("Block");
    return ok({ blocked: false, characterId: body.value.characterId });
  });

  /** SCR-033 → Safety → blocked list. */
  app.get("/blocked", requireAuth, requireActiveAccount, async (c) => {
    const deps = c.get("deps");
    const user = c.get("user");
    const persona = await ownPersona(deps, user.id, c.req.query("personaId"));
    if (!persona) return ok({ blocked: [] });
    const rows = await deps.prisma.blockedCharacter.findMany({
      where: { personaId: persona.id },
      orderBy: { createdAt: "desc" },
      include: { character: true },
    });
    return ok({
      blocked: rows.map((r) => ({
        characterId: r.characterId,
        handle: bareHandle(r.character.handle),
        displayName: r.character.displayName,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  /**
   * Minimal moderation queue so reports are inspectable. Gated behind `TEST_HOOKS=1` or an
   * `ADMIN_TOKEN` match (`authorization: Bearer <token>` or `x-admin-token`).
   */
  app.get("/reports", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : c.req.header("x-admin-token");
    if (!testHooksEnabled() && !adminTokenMatches(presented)) return fail("UNAUTHORIZED", "Admin only", 401);
    const deps = c.get("deps");
    const status = c.req.query("status");
    const rows = await deps.prisma.report.findMany({
      where: status === "open" || status === "triaged" || status === "actioned" || status === "dismissed" ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return ok({
      reports: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        target: r.target,
        targetId: r.targetId,
        generationId: r.generationId,
        reason: r.reason,
        note: r.note,
        snapshot: r.snapshot,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });

  return app;
}
