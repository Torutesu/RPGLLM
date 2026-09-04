import type { ErrorCode } from "@rpgllm/shared";
import type { z } from "zod";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), { status, headers: JSON_HEADERS });
}
export function fail(code: ErrorCode, message: string, status: number): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), { status, headers: JSON_HEADERS });
}

export const validationError = (message: string): Response => fail("VALIDATION", message, 400);
export const notFound = (what: string): Response => fail("NOT_FOUND", `${what} not found`, 404);
export const unauthorized = (): Response => fail("UNAUTHORIZED", "Missing or invalid session", 401);

/** Parse a JSON body with a zod schema. Returns either the value or a 400 VALIDATION response. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: { json(): Promise<unknown> },
  schema: S,
): Promise<{ ok: true; value: z.infer<S> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
  return { ok: true, value: parsed.data as z.infer<S> };
}

/** Parse a query object with a zod schema. */
export function parseQuery<S extends z.ZodTypeAny>(
  raw: Record<string, string | undefined>,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; res: Response } {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, res: validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")) };
  return { ok: true, value: parsed.data as z.infer<S> };
}
