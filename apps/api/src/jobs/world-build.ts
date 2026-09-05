/**
 * `world-build` — the World Studio generator, as a job (AIF-003).
 *
 * `POST /v1/worlds` does not generate anything. It takes the gems, writes a `World` row in
 * `generating` and returns; one G9 call at the high tier producing two full locales is far too long
 * to hold a request open, and far too expensive to lose to a dropped connection. This job is what
 * turns those rows into playable worlds, under the same advisory lock and `JobRun` discipline as
 * every other scheduled job.
 *
 * Two passes, in this order:
 *
 *  1. **Sweep.** Any world still `generating` past `WORLD_BUILD_TIMEOUT_MS` failed, whatever the
 *     reason — a crashed worker, a redeploy mid-build, a gateway that never came back. A world must
 *     never be stuck in `generating`, because the player is staring at a progress bar for it.
 *  2. **Build.** Claim, generate, validate, write, notify.
 *
 * Failure is a first-class outcome, not an exception: the world goes back to `draft` with a
 * user-facing `failureReason`, the 120 gems come back in the same transaction, and the creator is
 * told. `refundWorldOnce` makes that refund exactly-once no matter how many times this runs.
 */
import type { PrismaClient, World } from "@prisma/client";
import type { Gateway } from "@rpgllm/llm";
import { LOCALES, WORLD_STUDIO, WorldSeedZ, t, type Locale, type WorldGenre, type WorldSeed } from "@rpgllm/shared";
import type { Clock } from "../clock";
import { loadEstimateTokens } from "../llm-loader";
import { logLine } from "../middleware/request-log";
import { seedWorld } from "../seed";
import { g9Of } from "../services/g9";
import { logGeneration } from "../services/generation";
import type { LocaleKey } from "../services/locale";
import { notify } from "../services/notify";
import { seedFrom } from "../services/rng";
import { refundWorldOnce, worldBuildBatchSize, worldBuildTimeoutMs } from "../services/world-studio";

export interface WorldBuildResult {
  considered: number;
  built: number;
  failed: number;
  swept: number;
}

export interface WorldBuildOptions {
  /** build only this world (the test hook and `POST /v1/jobs/run` narrowing) */
  worldId?: string;
  limit?: number;
}

const localeOf = (world: World, fallback: LocaleKey): LocaleKey =>
  (world.genLocale ?? fallback) as LocaleKey;

const genreOf = (world: World): WorldGenre => (world.genre || "fame") as WorldGenre;

/**
 * The creator's most recent persona is where a notification can land — `Notification` hangs off a
 * persona, not a user. A brand-new account building its first world may not have one yet; the world
 * row's own `status` is the surface in that case, so this is best-effort by design.
 */
async function tellCreator(
  prisma: PrismaClient,
  world: World,
  locale: LocaleKey,
  key: "studioReady" | "studioFailed",
): Promise<void> {
  if (!world.createdBy) return;
  const persona = await prisma.persona.findFirst({
    where: { userId: world.createdBy },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!persona) return;
  await notify(prisma, {
    personaId: persona.id,
    kind: "unlock",
    target: `world:${world.id}`,
    text: t(locale as Locale, key),
    payload: { worldId: world.id, slug: world.slug },
  });
}

/** Back to `draft`, gems returned once, creator told. Never throws. */
export async function failWorld(
  prisma: PrismaClient,
  world: World,
  now: Date,
  locale: LocaleKey,
  detail: string,
): Promise<boolean> {
  const reason = t(locale as Locale, "studioFailedHint");
  const refunded = await prisma.$transaction(async (tx) => await refundWorldOnce(tx, world, now, reason));
  logLine({ level: "warn", msg: "world.build.failed", worldId: world.id, slug: world.slug, reason: detail, refunded });
  if (refunded) await tellCreator(prisma, world, locale, "studioFailed");
  return refunded;
}

/** Worlds that have been `generating` longer than any real build could take. */
async function sweepStuck(prisma: PrismaClient, now: Date): Promise<World[]> {
  const deadline = new Date(now.getTime() - worldBuildTimeoutMs());
  return await prisma.world.findMany({
    where: {
      status: "generating",
      OR: [
        { buildStartedAt: { lt: deadline } },
        { buildStartedAt: null, createdAt: { lt: deadline } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}

async function buildOne(
  prisma: PrismaClient,
  gateway: Gateway,
  world: World,
  now: Date,
  estimate: (text: string) => number,
): Promise<"built" | "failed"> {
  const locale = localeOf(world, "en");
  const g9 = g9Of(gateway);
  if (!g9) {
    // Nothing to generate with. Release the claim rather than burning the world: the sweep will
    // fail and refund it if the generator never arrives.
    await prisma.world.updateMany({ where: { id: world.id, status: "generating" }, data: { buildStartedAt: null } });
    logLine({ level: "error", msg: "world.build.no_generator", worldId: world.id });
    return "failed";
  }

  let result;
  try {
    result = await g9({
      slug: world.slug,
      // The premise reaches the generator as a *field of the generator's input* and nowhere else.
      premise: world.premise,
      genre: genreOf(world),
      locale: locale as Locale,
      seed: seedFrom(`world:${world.id}`),
    });
  } catch (err: unknown) {
    await failWorld(prisma, world, now, locale, `g9 threw: ${(err as Error).message}`);
    return "failed";
  }

  // One row per G9 call, written before anything else can go wrong with it (CLAUDE.md rule 5).
  const generationId = await logGeneration(prisma, result.meta, world.createdBy);
  if (result.meta.fallback) {
    await failWorld(prisma, world, now, locale, "g9 fallback");
    return "failed";
  }

  const parsed = WorldSeedZ.safeParse(result.output);
  if (!parsed.success) {
    await failWorld(prisma, world, now, locale, `WorldSeedZ: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    return "failed";
  }
  // The bible is the cached prompt prefix every later generator reads; below the floor the world
  // would be cheap to make and bad to play, so it is refused before anyone can meet it.
  const short = LOCALES.filter((l) => estimate(parsed.data.bible[l] ?? "") < WORLD_STUDIO.MIN_BIBLE_TOKENS);
  if (short.length > 0) {
    await failWorld(prisma, world, now, locale, `bible below ${WORLD_STUDIO.MIN_BIBLE_TOKENS} tokens (${short.join(",")})`);
    return "failed";
  }

  // The row already exists (the create route wrote it), and `seedWorld` upserts by slug — so the
  // generator's own slug is overridden with the one the player was already given.
  const seed: WorldSeed = { ...parsed.data, slug: world.slug };
  try {
    await seedWorld(prisma, seed, estimate, {
      isPreset: false,
      status: "ready",
      storeSeed: true,
      generationId,
      failureReason: "",
      buildStartedAt: null,
    });
  } catch (err: unknown) {
    await failWorld(prisma, world, now, locale, `persist failed: ${(err as Error).message}`);
    return "failed";
  }

  logLine({ level: "info", msg: "world.build.ready", worldId: world.id, slug: world.slug });
  await tellCreator(prisma, world, locale, "studioReady");
  return "built";
}

export async function runWorldBuild(
  prisma: PrismaClient,
  gateway: Gateway,
  clock: Clock,
  opts: WorldBuildOptions = {},
): Promise<WorldBuildResult> {
  const now = clock.now();
  const out: WorldBuildResult = { considered: 0, built: 0, failed: 0, swept: 0 };

  for (const stuck of await sweepStuck(prisma, now)) {
    if (opts.worldId && stuck.id !== opts.worldId) continue;
    if (await failWorld(prisma, stuck, now, localeOf(stuck, "en"), "build timed out")) out.swept += 1;
  }

  const estimate = await loadEstimateTokens();
  const pending = await prisma.world.findMany({
    where: { status: "generating", buildStartedAt: null, ...(opts.worldId ? { id: opts.worldId } : {}) },
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? worldBuildBatchSize(),
  });

  for (const world of pending) {
    // Claim it. Under the job lock this can only lose to the world moving on by another path.
    const claimed = await prisma.world.updateMany({
      where: { id: world.id, status: "generating", buildStartedAt: null },
      data: { buildStartedAt: now },
    });
    if (claimed.count === 0) continue;
    out.considered += 1;
    const outcome = await buildOne(prisma, gateway, { ...world, buildStartedAt: now }, now, estimate);
    if (outcome === "built") out.built += 1;
    else out.failed += 1;
  }

  return out;
}
