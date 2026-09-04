import type { Prisma, PrismaClient } from "@prisma/client";
import { ACHIEVEMENTS, t, type AchievementDef, type StringKey } from "@rpgllm/shared";
import type { LocaleKey } from "./locale";
import { notify, unlockText } from "./notify";

/**
 * Achievements (SCR-044) — the collection drive.
 *
 * The catalogue lives in `packages/shared` (`ACHIEVEMENTS`); only the metrics live here. Every
 * metric is an **aggregate query** — `evaluate()` runs after each energy-spending action, so it may
 * never load rows. All ten counts go out in one `Promise.all`.
 */
export type MetricName = AchievementDef["metric"];
export type Metrics = Record<MetricName, number>;

export const achievementTitle = (locale: LocaleKey, key: string): string =>
  t(locale, `ach_${key}_title` as StringKey);
export const achievementDescription = (locale: LocaleKey, key: string): string =>
  t(locale, `ach_${key}_desc` as StringKey);

/** 0..1 toward the threshold. Locked rows show a bar instead of nothing. */
export const progressFor = (def: AchievementDef, metrics: Metrics): number =>
  Math.max(0, Math.min(1, metrics[def.metric] / Math.max(1, def.threshold)));

export async function computeMetrics(prisma: PrismaClient, personaId: string): Promise<Metrics | null> {
  const persona = await prisma.persona.findUnique({
    where: { id: personaId },
    select: { followers: true, aura: true, humor: true, level: true },
  });
  if (!persona) return null;

  const [posts, eventsResolved, dmsSent, memories, affinity, cancels] = await Promise.all([
    prisma.post.count({ where: { personaId, authorPersonaId: personaId, kind: "user" } }),
    prisma.event.count({ where: { personaId, resolvedAt: { not: null } } }),
    prisma.dMMessage.count({ where: { fromCharacter: false, thread: { personaId } } }),
    prisma.memoryEntry.count({ where: { relationship: { personaId } } }),
    prisma.relationshipState.aggregate({ where: { personaId }, _max: { affinity: true } }),
    // "cancelled" = a resolved event whose stat snapshot cost followers.
    prisma.statSnapshot.count({ where: { personaId, cause: { startsWith: "event:" }, followersDelta: { lt: 0 } } }),
  ]);

  return {
    posts,
    followers: persona.followers,
    aura: persona.aura,
    humor: persona.humor,
    level: persona.level,
    affinityMax: affinity._max.affinity ?? 0,
    eventsResolved,
    dmsSent,
    memories,
    cancels,
  };
}

export interface Unlocked {
  key: string;
  value: number;
}

/**
 * Unlocks everything newly crossed and notifies once per unlock.
 * `AchievementUnlock` is unique on `(personaId, key)`, so a race (two actions finishing at once)
 * can only ever produce one row — the P2002 branch swallows the loser instead of 500-ing.
 */
export async function evaluate(
  prisma: PrismaClient,
  personaId: string,
  locale: LocaleKey,
): Promise<{ metrics: Metrics; unlocked: Unlocked[] } | null> {
  const metrics = await computeMetrics(prisma, personaId);
  if (!metrics) return null;

  const existing = await prisma.achievementUnlock.findMany({ where: { personaId }, select: { key: true } });
  const have = new Set(existing.map((r) => r.key));
  const newly = ACHIEVEMENTS.filter((def) => !have.has(def.key) && metrics[def.metric] >= def.threshold);
  if (newly.length === 0) return { metrics, unlocked: [] };

  const unlocked: Unlocked[] = [];
  for (const def of newly) {
    const value = metrics[def.metric];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.achievementUnlock.create({ data: { personaId, key: def.key, value } });
        await notify(tx, {
          personaId,
          kind: "unlock",
          target: `achievement:${def.key}`,
          text: unlockText(locale, achievementTitle(locale, def.key)),
          payload: { key: def.key, tier: def.tier, icon: def.icon, value },
        });
      });
      unlocked.push({ key: def.key, value });
    } catch (err) {
      // P2002 = another in-flight action unlocked the same key first. Nothing to do.
      if ((err as Prisma.PrismaClientKnownRequestError).code !== "P2002") throw err;
    }
  }
  return { metrics, unlocked };
}

/** Fire-and-forget wrapper for the action routes: never let the collection drive fail an action. */
export function evaluateQuietly(prisma: PrismaClient, personaId: string, locale: LocaleKey): Promise<void> {
  return evaluate(prisma, personaId, locale).then(
    () => undefined,
    (err: unknown) => {
      console.error("[api] achievement evaluation failed", err);
    },
  );
}
