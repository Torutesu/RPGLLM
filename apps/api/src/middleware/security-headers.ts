/**
 * The headers a browser needs in order to defend the people using this service.
 *
 * There were none. That mattered least for the JSON API — a bearer-token API is not
 * cookie-confusable and returns no HTML — and most for `/s/*`, the share pages, which are the
 * only HTML this product serves and were framable by anyone: a page with a big "Open it" button
 * and no `frame-ancestors` is a clickjacking target, and the whole point of those pages is that
 * strangers open them from links.
 *
 * What each one is here for:
 *
 *   - `X-Content-Type-Options: nosniff` — stops a browser deciding that our JSON is a script.
 *   - `Referrer-Policy: strict-origin-when-cross-origin` — share links carry ids in the path; a
 *     full referrer hands those to whatever the reader clicks next.
 *   - `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'` — the old header and the current
 *     one, because the browsers that need each are still both out there.
 *   - `Permissions-Policy` — nothing here needs a camera, a microphone or a location, so nothing
 *     embedded in a page of ours should be able to ask for one.
 *   - `Strict-Transport-Security` in production only. On localhost it would pin a developer's
 *     browser to HTTPS for the next two years against a service that does not speak it.
 *
 * The share pages get their own CSP: `default-src 'none'` and then exactly what the page uses —
 * its own poster image and one inline `<style>`. No script at all, which is true (there is none)
 * and is the strongest thing a page can say.
 */
import type { MiddlewareHandler } from "hono";
import { isProduction } from "../env";
import type { AppEnv } from "../types";

/** A year, in seconds — the usual HSTS max-age once a deployment is sure about its certificate. */
export const HSTS_MAX_AGE = 31_536_000;

export const SHARE_CSP = [
  "default-src 'none'",
  // The poster is served from this same origin; data: so a future inlined placeholder still works.
  "img-src 'self' data:",
  // One inline <style> block, written by this service, with no user content interpolated into it.
  "style-src 'unsafe-inline'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

/** The CSP for everything else: JSON, and nothing a browser should ever render. */
export const API_CSP = ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"].join("; ");

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    h.set("x-content-type-options", "nosniff");
    h.set("referrer-policy", "strict-origin-when-cross-origin");
    h.set("x-frame-options", "DENY");
    h.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    h.set("content-security-policy", c.req.path.startsWith("/s/") ? SHARE_CSP : API_CSP);
    // Only where HTTPS is actually in front of us; see the note above.
    if (isProduction()) h.set("strict-transport-security", `max-age=${HSTS_MAX_AGE}; includeSubDomains`);
  };
}
