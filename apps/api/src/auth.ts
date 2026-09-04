import { SignJWT, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import { AGE } from "@rpgllm/shared";
import { jwtSecret } from "./env";
import { fail, unauthorized } from "./http";
import type { AppEnv } from "./types";

const ALG = "HS256";

export async function signSession(userId: string): Promise<string> {
  return await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(jwtSecret());
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: [ALG] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
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
  const userId = await verifySession(token);
  if (!userId) return unauthorized();
  const deps = c.get("deps");
  const user = await deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user) return unauthorized();
  if (isBlockedAge(user.birthYear, deps.clock.now())) return fail("UNAUTHORIZED", "Account is not eligible", 401);
  c.set("userId", user.id);
  c.set("user", user);
  await next();
};
