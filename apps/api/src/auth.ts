import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { AGE } from "@rpgllm/shared";
import { jwtSecret } from "./env";
import { fail, unauthorized } from "./http";
import type { AppEnv } from "./types";

const ALG = "HS256";

/**
 * Sign a session for `userId`, stamped with the account's current session generation.
 *
 * The generation (`v`) is what makes a 30-day token revocable. Without it `verifySession` can only
 * ever answer "this signature is ours", and a token that leaks — a lost phone, a shared computer,
 * a copied `localStorage` — stays good for a month with nothing anybody can do about it. The
 * client's "Sign out" dropped the local copy and nothing else, so the button was honest only on
 * the device pressing it.
 */
export async function signSession(userId: string, tokenVersion = 0): Promise<string> {
  return await new SignJWT({ sub: userId, v: tokenVersion })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(jwtSecret());
}

export interface SessionClaims {
  userId: string;
  /** the generation this token was issued under; absent in tokens signed before this existed */
  tokenVersion: number;
}

export async function verifySessionClaims(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    /*
     * A token issued before this field existed has no `v`. Treating it as generation 0 keeps
     * every session alive across the deploy that adds the column (which also defaults to 0) —
     * and the first "sign out everywhere" moves the account to 1, after which those old tokens
     * are refused like any other. Rejecting them outright would have logged out every user on
     * deploy day to close a hole nobody was in.
     */
    const v = payload["v"];
    return { userId: payload.sub, tokenVersion: typeof v === "number" ? v : 0 };
  } catch {
    return null;
  }
}

/** The user id alone — for the rate limiter, which keys buckets before `requireAuth` runs. */
export async function verifySession(token: string): Promise<string | null> {
  return (await verifySessionClaims(token))?.userId ?? null;
}

/** birthYear 0 means "age gate not answered yet". */
export const ageOf = (birthYear: number, now: Date): number | null =>
  birthYear > 0 ? now.getUTCFullYear() - birthYear : null;

export const isBlockedAge = (birthYear: number, now: Date): boolean => {
  const age = ageOf(birthYear, now);
  return age !== null && age < AGE.MIN;
};

/** EventSource cannot set headers, so `?token=` is accepted — but ONLY on the SSE reads. */
export const allowsQueryToken = (method: string, path: string): boolean =>
  method === "GET" && /\/stream\/?$/.test(path);

/**
 * Bearer auth. `?token=` works only on `GET .../stream` (E2E web client uses `EventSource`);
 * a token in the query string of a mutating route is ignored, so it can never be replayed from a
 * referrer header, proxy log or browser history into a state-changing call.
 * Users who failed the age gate (<13) keep their row but every authenticated route answers 401 (E2E-001).
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const queryToken = allowsQueryToken(c.req.method, c.req.path) ? (c.req.query("token") ?? "") : "";
  const token = bearer || queryToken;
  if (!token) return unauthorized();
  const claims = await verifySessionClaims(token);
  if (!claims) return unauthorized();
  const deps = c.get("deps");
  const user = await deps.prisma.user.findUnique({ where: { id: claims.userId } });
  if (!user) return unauthorized();
  // Revoked: the account's session generation has moved past the one this token was signed with.
  if (user.tokenVersion !== claims.tokenVersion) return unauthorized();
  if (isBlockedAge(user.birthYear, deps.clock.now())) return fail("UNAUTHORIZED", "Account is not eligible", 401);
  // S1-1 (Agent G): a soft-deleted account keeps its row through the 30-day grace window but loses
  // every door except `POST /v1/account/restore`, which is how the user cancels the deletion.
  if (user.deletedAt && !c.req.path.endsWith("/account/restore")) {
    return fail("ACCOUNT_DELETED", "This account is scheduled for deletion", 410);
  }
  c.set("userId", user.id);
  c.set("user", user);
  await next();
};
