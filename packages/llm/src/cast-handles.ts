import { PRESET_PERSONA_HANDLES } from "./generators/g9/blueprint.js";
import { GENRE_PACKS } from "./generators/g9/vocab.js";
import { HANDLE_RE, bareHandle } from "./handles.js";
import { fnv1a } from "./tokens.js";

/**
 * The cast-handle namespace, and how it stays out of the creator-handle namespace.
 *
 * The open defect (build-notes, Agent CREATOR-ID §2.3): both writes of a `User.creatorHandle`
 * refuse a name that some world's cast already uses, but a cast is minted **later**, by G9, which
 * cannot see the database. So `@rina` the author and `@rina` the character can both come to exist,
 * in either order, and the second one is the one nobody checked.
 *
 * Two ways to close it, and why this file does the second:
 *
 *  1. **Disjoint by shape.** Carve the string space — every generated handle carries a marker no
 *     creator handle may have (a `_bot` suffix, a reserved leading character, a fixed length).
 *     Rejected. The marker is on the wrong side of the product: a cast handle is read by players
 *     as a person's name in a feed, so a marker that is reliable enough to be a rule is loud
 *     enough to make every character look like a service account. It is also unappliable
 *     backwards — the three hand-authored worlds and every world already generated carry
 *     unmarked handles that are quoted by name throughout their bibles, so the rule would hold for
 *     new worlds only, i.e. it would not actually be an invariant.
 *
 *  2. **Decidable, and resolved at the one moment renaming is free.** A cast handle is chosen by
 *     the *concept* stage — call 1 of 14 — and only then written into the bible, the cards, the
 *     ambient pool and the welcome posts by calls 2..14. Between those two points the name has no
 *     references and can be changed for nothing. So G9 accepts an optional, asynchronous
 *     `reserveCastHandles` hook, calls it once with the eight proposed handles, and deterministically
 *     re-mints whichever come back taken **before any other stage runs**. Zero extra model calls,
 *     zero extra cost, and no stage ever sees the discarded name.
 *
 * What this file owns: the re-mint (pure, deterministic, total) and the enumerable half of the
 * generated space. What `apps/api` owns is written up in `CAST_HANDLE_CONTRACT` below.
 */

/** Human-readable account suffixes, tried before digits. They read as names, not as escapes. */
const SUFFIXES: readonly string[] = [
  "_hq", "_irl", "_live", "_here", "_now", "_daily", "_pls", "_tv", "_fm", "_x",
  "2", "3", "7", "9", "_01", "_02", "_07", "_11", "_21", "_99",
];

const MAX_HANDLE = 15;
const MIN_HANDLE = 3;

/** Trim a stem so `stem + suffix` still fits, without ending on an underscore. */
function fit(stem: string, suffix: string): string {
  const room = MAX_HANDLE - suffix.length;
  let head = stem.slice(0, Math.max(MIN_HANDLE, room));
  while (head.length > MIN_HANDLE && head.endsWith("_")) head = head.slice(0, -1);
  return `${head}${suffix}`;
}

/** A legal stem from anything: lowercased, illegal characters dropped, padded if too short. */
export function handleStem(raw: string): string {
  const cleaned = bareHandle(raw.trim().toLowerCase()).replace(/[^a-z0-9_]/g, "");
  const trimmed = cleaned.replace(/^_+/, "").slice(0, MAX_HANDLE);
  if (trimmed.length >= MIN_HANDLE) return trimmed;
  return `${trimmed}acct`.slice(0, MAX_HANDLE);
}

/**
 * Every alternative for one stem, in a stable order that depends on the world's seed — so two
 * worlds that both have to move a `@rina` do not both land on `@rina_hq`.
 */
export function handleLadder(stem: string, seed: string): string[] {
  const base = handleStem(stem);
  const rotation = fnv1a(`${seed}|${base}`) % SUFFIXES.length;
  const rotated = [...SUFFIXES.slice(rotation), ...SUFFIXES.slice(0, rotation)];
  const out = [base, ...rotated.map((s) => fit(base, s))];
  // Last resort: a hash tail. 65,536 of them, so the ladder cannot run out in practice.
  for (let i = 0; i < 4; i += 1) {
    const tail = (fnv1a(`${seed}|${base}|${i}`) % 0x10000).toString(16).padStart(4, "0");
    out.push(fit(base, `_${tail}`));
  }
  return out.filter((h) => HANDLE_RE.test(h));
}

export type CastHandleRenameReason = "reserved" | "duplicate" | "illegal";

export interface CastHandleRename {
  from: string;
  to: string;
  reason: CastHandleRenameReason;
}

export interface CastHandleMint {
  /** the final handles, in the order the candidates came in */
  handles: string[];
  renamed: CastHandleRename[];
}

/**
 * Resolve a proposed cast against everything it may not be: a name taken outside this world
 * (a creator handle), a name already used by an earlier member of this same cast, or a string
 * that is not a legal handle at all. Pure, total and deterministic in `seed`.
 *
 * `reserved` is compared case-insensitively and with or without a leading "@", because the two
 * namespaces spell themselves differently in the database (`WorldCharacter.handle` keeps the "@",
 * `User.creatorHandle` does not).
 */
export function mintCastHandles(args: {
  candidates: readonly string[];
  reserved?: Iterable<string>;
  seed: string;
}): CastHandleMint {
  const reserved = new Set<string>();
  for (const r of args.reserved ?? []) reserved.add(bareHandle(r.trim().toLowerCase()));

  const used = new Set<string>();
  const handles: string[] = [];
  const renamed: CastHandleRename[] = [];

  for (const candidate of args.candidates) {
    const from = bareHandle(candidate.trim().toLowerCase());
    const legal = HANDLE_RE.test(from);
    const ladder = handleLadder(from, args.seed);
    let chosen = ladder.find((h) => !reserved.has(h) && !used.has(h));
    if (chosen === undefined) chosen = ladder[ladder.length - 1] ?? handleStem(from);
    used.add(chosen);
    handles.push(chosen);
    if (chosen !== from) {
      renamed.push({
        from: candidate,
        to: chosen,
        reason: !legal ? "illegal" : reserved.has(from) ? "reserved" : "duplicate",
      });
    }
  }
  return { handles, renamed };
}

/**
 * The hook `apps/api` supplies. Given the handles a world is about to mint, return the subset that
 * is taken somewhere the generator cannot see. One indexed query; no model call.
 *
 * Contract: it must **never throw and never hang forever** — G9 treats a rejection or a timeout as
 * "nothing is reserved" and keeps the model's own names, because a colliding handle is a display
 * defect and losing the world is not.
 */
export type ReserveCastHandles = (handles: readonly string[]) => Promise<readonly string[]>;

/** How long G9 waits for that hook before giving up on it and keeping the model's names. */
export const RESERVE_HANDLES_TIMEOUT_MS = 2_000;

/**
 * Ask the hook, defensively. Resolves to the reserved subset, or an empty list if the hook is
 * absent, slow, throwing, or answers with something that is not a list of strings.
 */
export async function askReserved(
  hook: ReserveCastHandles | undefined,
  handles: readonly string[],
  timeoutMs: number = RESERVE_HANDLES_TIMEOUT_MS,
): Promise<{ reserved: string[]; status: "ok" | "absent" | "timeout" | "error" }> {
  if (hook === undefined) return { reserved: [], status: "absent" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answer = await Promise.race([
      Promise.resolve(hook(handles)),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    if (answer === null) return { reserved: [], status: "timeout" };
    if (!Array.isArray(answer)) return { reserved: [], status: "error" };
    return {
      reserved: answer.filter((h): h is string => typeof h === "string"),
      status: "ok",
    };
  } catch {
    return { reserved: [], status: "error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * What `apps/api` must do with the above. Kept as a string constant so it travels with the code
 * rather than only with the build notes.
 */
export const CAST_HANDLE_CONTRACT = `
G9 -> apps/api, the cast/creator handle namespace:

1. Pass a "reserveCastHandles" hook into gateway.g9(input, { reserveCastHandles }). Implement it as
   one query per world build:
     SELECT "creatorHandle" FROM "User" WHERE "creatorHandle" IN ($handles)
     UNION SELECT handle FROM "CreatorHandleRelease" WHERE handle IN ($handles)
   Return the rows found (bare, lowercase). Never throw; G9 keeps the model's names if you do.
2. Keep refusing a creator handle that a cast already uses (services/creator-handle.ts
   collidesWithCast) - this hook closes the other direction, not that one.
3. Reserve the deterministic space once. generatedHandleUniverse() enumerates every handle the
   blueprint (the no-API-key / fallback path) can mint. A world that falls back mints from that set
   with no hook involved, so seeding those names as unavailable creator handles is what makes the
   fallback path safe too.
4. Renames are recorded in the world build log via the meta returned by the studio; a handle that
   moved never reached a bible, a card or an ambient post, so nothing downstream needs migrating.
`.trim();

/* --------------------------------------------- the enumerable half of the space ---- */

/**
 * Every handle the **deterministic** generator can mint: the eight genre packs' character handles,
 * their press handles, and the seven preset-persona handles. That is the whole namespace of a
 * world built with no API key (the fallback path), so it is finite, frozen and listable — and
 * therefore reservable by `apps/api` once, with no query per build.
 *
 * The model-authored half is not enumerable, which is exactly why the `reserveCastHandles` hook
 * exists alongside this.
 */
export function generatedHandleUniverse(): string[] {
  const out = new Set<string>();
  for (const pack of Object.values(GENRE_PACKS)) {
    for (const h of pack.handles) out.add(bareHandle(h.toLowerCase()));
    out.add(bareHandle(pack.pressHandle.toLowerCase()));
  }
  for (const h of PRESET_PERSONA_HANDLES) out.add(bareHandle(h.toLowerCase()));
  return [...out].sort();
}
