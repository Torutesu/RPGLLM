/**
 * Building a world, once — for `POST /v1/worlds` and `POST /v1/worlds/:id/remix`.
 *
 * A remix is not a cheaper world. It is the same 120 gems, the same daily cap, the same premise
 * screen and the same build job; what a remix makes cheaper is **the deciding** — genre, language
 * and the shape of the thing are already answered by the world the player just came out of
 * (gtm.md 勝ち筋 A ④). That is the whole conversion trick, and it only works if the two paths are
 * literally the same code: a second copy of the three gates is a second place for the safety
 * screen or the refund to be forgotten.
 *
 * The order of the gates is the safety-and-economics story and does not change:
 *   1. **screen the premise** — a blocked one costs nothing: no gems, no tokens, no row;
 *   2. **the per-UTC-day cap** — a spend limit, not a quota of successes;
 *   3. **the price** — and only then does anything become durable, all of it together.
 */
import { Prisma, type World } from "@prisma/client";
import { WORLD_STUDIO, WorldVisibilityZ, type Locale, type WorldGenre } from "@rpgllm/shared";
import type { z } from "zod";
import { logLine } from "../middleware/request-log";
import { loadDeepPremiseScreen } from "../llm-loader";
import { tamePremise } from "../fake-world-seed";
import type { Deps } from "../types";
import { ensureWallet } from "./wallet";
import {
  GemsRequiredError, dailyWorldLimit, slugifyPremise, spendGems, uniqueSlug, worldsCreatedToday,
} from "./world-studio";

type WorldVisibility = z.infer<typeof WorldVisibilityZ>;

export interface CreateWorldInput {
  premise: string;
  genre: WorldGenre;
  locale: Locale;
  visibility: WorldVisibility;
  /** the world this one is derived from, already checked to be one the caller may play */
  remixOf?: World | null;
}

export type CreateWorldOutcome =
  | { ok: true; world: World; remaining: number }
  | { ok: false; code: "VALIDATION" | "SAFETY_BLOCKED" | "WORLD_LIMIT" | "GEMS_REQUIRED" | "INTERNAL"; message: string; status: number };

/** A premise is one line of prose; the world's working title is its first clause. */
export const titleFrom = (premise: string): string => {
  const tamed = tamePremise(premise);
  return ((tamed.split(/[,.;:—]/)[0] ?? tamed).trim() || tamed).slice(0, 60);
};

const bilingual = (text: string): Prisma.InputJsonValue => ({ en: text, ja: text });

const shortId = (): string => Math.random().toString(36).slice(2, 7);

export async function createWorld(
  deps: Deps,
  user: { id: string },
  input: CreateWorldInput,
): Promise<CreateWorldOutcome> {
  const now = deps.clock.now();
  const { genre, locale, visibility } = input;
  /**
   * `CreateWorldReqZ` measures the raw string, and the client trims before it measures — so ten
   * spaces was a valid 8-character premise, and a 120-gem purchase that built a world out of
   * nothing (QA-005). Trim on the side that takes the money.
   */
  const premise = input.premise.trim();
  if (premise.length < 8) {
    return { ok: false, code: "VALIDATION", message: "Give the world a little more to go on", status: 400 };
  }

  // 1. Safety, before a single token is spent on generation — the premise ends up inside a system
  //    prompt. Two layers: deterministic vocabulary always, and in live mode a light-tier model
  //    classifier after it. They are ANDed, so the model can tighten the verdict and never loosen
  //    it, and an outage degrades to the deterministic answer instead of closing the studio.
  const screen = await loadDeepPremiseScreen(deps.gateway);
  const verdict = await screen(premise, locale);
  if (verdict.verdict === "block") {
    logLine({ level: "warn", msg: "world.premise.blocked", userId: user.id, category: verdict.category ?? "unknown", layer: verdict.layer });
    return { ok: false, code: "SAFETY_BLOCKED", message: `We can't build that one (${verdict.category ?? "policy"}).`, status: 422 };
  }

  // 2. The daily cap, counted from `World` rows: a refunded failure still used its slot, because
  //    the cap is there to bound spend, not to guarantee three successes. A remix is a world.
  const subscription = await deps.prisma.subscription.findUnique({ where: { userId: user.id } });
  const limit = dailyWorldLimit(subscription, now);
  const today = await worldsCreatedToday(deps.prisma, user.id, now);
  if (today >= limit) {
    const headroom = limit < WORLD_STUDIO.DAILY_LIMIT_PLUS ? ` Plus raises it to ${WORLD_STUDIO.DAILY_LIMIT_PLUS}.` : "";
    return { ok: false, code: "WORLD_LIMIT", message: `You've built ${limit} worlds today — that's the daily limit.${headroom}`, status: 429 };
  }

  // 3. The price. Same 402 shape as running out of energy.
  const { wallet } = await ensureWallet(deps.prisma, deps.clock, user.id);
  if (wallet.gems < WORLD_STUDIO.GEM_COST) {
    return { ok: false, code: "GEMS_REQUIRED", message: `Not enough gems — a world costs ${WORLD_STUDIO.GEM_COST}.`, status: 402 };
  }

  // 4. Charge and enqueue, atomically. The slug comes from the premise so it can collide; the
  //    unique index is the arbiter, and the whole transaction (the debit included) is retried.
  const base = slugifyPremise(premise, genre);
  const title = titleFrom(premise);
  const source = input.remixOf ?? null;
  let created: { world: World; remaining: number } | null = null;
  for (let attempt = 0; attempt < 3 && created === null; attempt += 1) {
    const slug = await uniqueSlug(deps.prisma, base, shortId());
    try {
      created = await deps.prisma.$transaction(async (tx) => {
        const remaining = await spendGems(tx, wallet.id, WORLD_STUDIO.GEM_COST, `world:${slug}`);
        const world = await tx.world.create({
          data: {
            slug,
            title: bilingual(title),
            scenario: bilingual(tamePremise(premise)),
            bible: bilingual(""),
            bibleTokens: 0,
            isPreset: false,
            createdBy: user.id,
            premise,
            genre,
            genLocale: locale,
            status: "generating",
            visibility,
            createdAt: now,
            // The edge always points from a row being created now to a row that already exists, and
            // it is never rewritten — so the remix graph is a DAG by construction and a cycle
            // cannot be expressed, however long the chain of remixes-of-remixes gets.
            ...(source ? { remixOfId: source.id } : {}),
          },
        });
        // The source's tally moves in the same transaction as the derivative, so "remixed 12 times"
        // can never count a world that was not paid for.
        if (source) await tx.world.update({ where: { id: source.id }, data: { remixCount: { increment: 1 } } });
        return { world, remaining };
      });
    } catch (err: unknown) {
      if (err instanceof GemsRequiredError) {
        return { ok: false, code: "GEMS_REQUIRED", message: `Not enough gems — a world costs ${WORLD_STUDIO.GEM_COST}.`, status: 402 };
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  if (created === null) {
    return { ok: false, code: "INTERNAL", message: "Could not reserve a name for that world", status: 500 };
  }
  if (source) {
    logLine({ level: "info", msg: "world.remix.created", worldId: created.world.id, sourceId: source.id, userId: user.id });
  }
  return { ok: true, world: created.world, remaining: created.remaining };
}
