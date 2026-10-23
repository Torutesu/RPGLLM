/**
 * A ceiling on how much body this service will read.
 *
 * Validation happens *after* the body is in memory: `parseBody` hands Hono the request, Hono
 * buffers it, and only then does zod discover that `text` was supposed to be 280 characters. A
 * 100 MB POST to any endpoint therefore cost 100 MB of heap before anything rejected it, and the
 * cheapest version of that attack does not even need an account — the limiter keys unauthenticated
 * requests by IP, and an IP is free.
 *
 * The limit is deliberately small. Every request body in this API is a handful of short fields;
 * the largest legitimate one is a world premise plus its options, which is under a kilobyte. 64 KB
 * leaves two orders of magnitude of headroom and still refuses anything that could matter.
 *
 * `content-length` is a claim, not a fact, so a chunked body with no length is read and counted —
 * and abandoned the moment it goes over, rather than after it finishes arriving.
 */
import type { MiddlewareHandler } from "hono";
import { envNum } from "../env";
import { fail } from "../http";
import type { AppEnv } from "../types";

export const maxBodyBytes = (): number => envNum("MAX_BODY_BYTES", 64 * 1024);

/** The store's webhook is signed and can legitimately carry a larger payload. */
const EXEMPT = new Set(["/v1/billing/webhook", "/billing/webhook"]);

const tooLarge = (limit: number): Response =>
  fail("VALIDATION", `Request body is larger than ${Math.floor(limit / 1024)} KB`, 413);

export function bodyLimit(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || EXEMPT.has(c.req.path)) return await next();
    const limit = maxBodyBytes();

    /*
     * `Number("")` is 0, not NaN — so a missing header has to be `null` rather than a falsy
     * number, or "no content-length" reads as "zero bytes declared" and every streamed body
     * walks straight past this. That was the first version of this file, and the streaming case
     * in the test is what found it.
     */
    const header = c.req.header("content-length");
    const declared = header === undefined || header === "" ? null : Number(header);
    const known = declared !== null && Number.isFinite(declared);
    if (known && (declared as number) > limit) return tooLarge(limit);

    const body = c.req.raw.body;
    // A declared length at or under the limit is trustworthy: the HTTP parser frames the request
    // by it, so the body cannot be longer than it claims. Only an *absent* one needs counting.
    if (!body || known) return await next();

    /*
     * No (or an unbelievable) content-length: count as it arrives and give up early. The request
     * is rebuilt around the counting stream so the handler still sees an ordinary body.
     */
    let seen = 0;
    let over = false;
    const counted = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          if (seen > limit) {
            over = true;
            controller.error(new Error("body too large"));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    const init: RequestInit & { duplex: "half" } = {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body: counted,
      duplex: "half",
    };
    c.req.raw = new Request(c.req.raw.url, init);
    /*
     * The stream error does not necessarily surface as a throw: `parseBody` catches a failed
     * `req.json()` and answers 400 on its own, which is a worse answer than 413 and hides the
     * reason. So the flag is checked on **both** exits — the thrown one and the ordinary one.
     */
    try {
      await next();
    } catch (err: unknown) {
      if (!over) throw err;
    }
    /*
     * After `next()` a middleware's **return value is ignored** — Hono has already decided what
     * the response is, and the only way to change it is to assign `c.res`. Returning a 413 here
     * looked right, typechecked, and let `parseBody`'s 400 through to the caller: a worse status
     * that hides the reason.
     */
    if (over) c.res = tooLarge(limit);
  };
}
