import { askReserved, mintCastHandles, type CastHandleRename, type ReserveCastHandles } from "../../cast-handles.js";
import { G9ConceptZ, type G9Concept, type G9Input } from "./types.js";

/**
 * Move a cast handle out of the way of a name that already belongs to somebody.
 *
 * This runs in exactly one window: after the concept stage has named the eight accounts, and
 * before the bible, the cards, the events and the texture are written from them. Inside that
 * window a handle has no references anywhere, so changing it costs nothing and loses nothing —
 * outside it, every rename would have to chase the name through 60kB of two-locale prose.
 *
 * See `cast-handles.ts` for why the namespaces are reconciled here rather than made disjoint by
 * shape.
 */

export interface CastRenameOutcome {
  renamed: CastHandleRename[];
  /** what the reservation hook did: `absent` when apps/api supplied none */
  status: "ok" | "absent" | "timeout" | "error";
  concept: G9Concept;
}

/** `@old` -> `@new` in prose, without matching a longer handle that starts with the same letters. */
function rewriteMentions(json: string, moves: ReadonlyMap<string, string>): string {
  if (moves.size === 0) return json;
  const alternation = [...moves.keys()]
    .sort((a, b) => b.length - a.length)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return json.replace(new RegExp(`@(${alternation})(?![a-z0-9_])`, "g"), (whole, name: string) =>
    moves.has(name) ? `@${moves.get(name) ?? name}` : whole,
  );
}

/**
 * Ask the hook, and re-mint whatever it claims. Total: any failure of the hook, of the rewrite or
 * of re-validation leaves the concept exactly as the model wrote it, because a colliding handle is
 * a display defect and a lost world is a refunded purchase.
 */
export async function resolveCastHandles(
  base: G9Input,
  concept: G9Concept,
  hook: ReserveCastHandles | undefined,
): Promise<CastRenameOutcome> {
  const proposed = concept.cast.map((c) => c.handle);
  const asked = await askReserved(hook, proposed);
  if (asked.reserved.length === 0) return { renamed: [], status: asked.status, concept };

  const mint = mintCastHandles({
    candidates: proposed,
    reserved: asked.reserved,
    seed: `${base.slug}|${base.seed}`,
  });
  const moves = new Map<string, string>();
  proposed.forEach((from, i) => {
    const to = mint.handles[i];
    if (to !== undefined && to !== from) moves.set(from, to);
  });
  if (moves.size === 0) return { renamed: [], status: asked.status, concept };

  try {
    const rewritten = JSON.parse(rewriteMentions(JSON.stringify(concept), moves)) as unknown;
    const check = G9ConceptZ.safeParse(rewritten);
    if (!check.success) return { renamed: [], status: asked.status, concept };
    const next = check.data;
    next.cast.forEach((member, i) => {
      const to = mint.handles[i];
      const from = proposed[i];
      if (to === undefined || from === undefined || to === from) return;
      member.avatarKey = member.avatarKey.split(from).join(to);
      member.handle = to;
    });
    return { renamed: mint.renamed, status: asked.status, concept: next };
  } catch {
    return { renamed: [], status: asked.status, concept };
  }
}
