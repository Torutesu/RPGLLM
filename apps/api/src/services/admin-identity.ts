/**
 * Who is on the other end of an admin request.
 *
 * Every admin surface — the review queue, the report queue, the cost dashboard, the job runner —
 * was gated by **one shared secret**, and the reviewer's name came from a header the client wrote
 * itself. Both halves of that are fine for a team of one and wrong for a queue with an SLA:
 *
 *   - a shared secret cannot be revoked for one person, so a reviewer leaving means rotating a
 *     token for everybody, which means it does not get rotated;
 *   - `reviewedBy` recorded a name anyone past the gate could type, so the audit trail answers
 *     "who approved this world" with a string, not with a person. A moderation record that can be
 *     written in someone else's name is not a record.
 *
 * `ADMIN_TOKENS` fixes both: `name:secret` pairs, one per reviewer, each revocable on its own, and
 * the name comes from **the secret that matched** rather than from anything the caller said.
 *
 * The old `ADMIN_TOKEN` still works, because taking it away would be a deployment break for a
 * gain that is already available by setting the new one. What it cannot do is pretend: a decision
 * made with the shared token is recorded as `shared:<whatever they called themselves>`, so the
 * queue's history says plainly which decisions are attributable to a person and which are not.
 */
import { timingSafeEqual } from "node:crypto";
import { envStr } from "../env";

export interface AdminIdentity {
  /** what goes in `reviewedBy` and what a claim is held by */
  name: string;
  /** false for the shared token: authenticated, but not attributable to a person */
  attributable: boolean;
}

/** The shared secret (legacy, still supported). */
export const adminToken = (): string => envStr("ADMIN_TOKEN", "");
/** `name:secret,name:secret` — one revocable credential per reviewer. */
export const adminTokensRaw = (): string => envStr("ADMIN_TOKENS", "");

export const SHARED_NAME = "shared";
const NAME_MAX = 64;

export interface AdminCredential { name: string; secret: string }

/**
 * Parses the pair list. A malformed entry is dropped rather than throwing: this is read on every
 * admin request, and one bad character in an env var must not turn the whole moderation surface
 * into a 500. An entry with an empty name or secret is not a credential.
 */
export function parseAdminTokens(raw: string): AdminCredential[] {
  const out: AdminCredential[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim().slice(0, NAME_MAX);
    const secret = trimmed.slice(colon + 1).trim();
    if (name === "" || secret === "") continue;
    out.push({ name, secret });
  }
  return out;
}

/** Constant-time compare that does not leak the length through an early return. */
export function secretMatches(presented: string, expected: string): boolean {
  if (expected === "" || presented === "") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still burn a comparison so a wrong length costs the same as a wrong value.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Resolves a presented secret to an identity, or `null` when it matches nothing.
 *
 * Every credential is compared even after a match, so the time this takes does not depend on
 * *which* reviewer's token was presented — a loop that returns early leaks the position of a
 * secret in the list to anyone who can time it.
 */
export function identifyAdmin(presented: string | undefined): AdminIdentity | null {
  const token = presented ?? "";
  if (token === "") return null;

  let found: AdminIdentity | null = null;
  for (const cred of parseAdminTokens(adminTokensRaw())) {
    if (secretMatches(token, cred.secret) && found === null) found = { name: cred.name, attributable: true };
  }
  if (secretMatches(token, adminToken()) && found === null) found = { name: SHARED_NAME, attributable: false };
  return found;
}

/** The gate: is this request allowed onto an admin surface at all? */
export const adminAuthorized = (presented: string | undefined): boolean => identifyAdmin(presented) !== null;

/**
 * The name a decision is recorded under.
 *
 * A per-reviewer token names itself and the header is ignored — the whole point is that the name
 * is not the caller's to choose. The shared token has no person behind it, so the header is used
 * as a label and prefixed, which makes "this decision cannot be pinned on anyone" a thing you can
 * grep for rather than something you have to know.
 */
export function reviewerNameFor(
  identity: AdminIdentity | null,
  claimedName: string,
  fallback: string,
): string {
  const claimed = claimedName.trim().slice(0, NAME_MAX);
  if (identity?.attributable === true) return identity.name;
  if (identity !== null) return claimed === "" ? SHARED_NAME : `${SHARED_NAME}:${claimed}`;
  // No credential at all: only reachable while TEST_HOOKS=1 (the harnesses have no tokens).
  return claimed === "" ? fallback : claimed;
}
