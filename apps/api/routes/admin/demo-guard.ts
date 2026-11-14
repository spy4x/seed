import type { MiddlewareHandler } from "hono"
import type { APIContext } from "../../_types.ts"
import { ADMIN_API_PREFIX } from "../../middlewares/admin-host.ts"
import { errorResponse } from "../../services/error-response.ts"

/** The answer to an action the public demo's admin account may not take. */
export const DEMO_REFUSED = `Not available in the public demo`

/**
 * The operator area's actions that reach past the demo's own data, which the nightly reset puts
 * back (docs/demo.md), as paths under the area:
 *
 * - the blog (posts, channels and shares) and the contact links are the real website, kept by the
 *   wipe, and a share posts to a real social network;
 * - the catalog's published items, photos and tracking links show on the public website, and a
 *   tracking link redirects from it to any address;
 * - billing's refund, free time and cancel act through the provider, which on a production server
 *   is Stripe or off, never the fake one (`BILLING_PROVIDER=fake` stops a production API);
 * - the newsletter's remove and resend drop or mail real subscribers;
 * - a job retried, run now or cancelled can send mail;
 * - a password-reset mail reaches a real visitor's inbox, and a new operator makes the worker wipe
 *   the demo.
 */
const REFUSED_PATHS: readonly RegExp[] = [
  /^\/blog(\/|$)/,
  /^\/contact-links(\/|$)/,
  /^\/catalog(\/|$)/,
  /^\/billing(\/|$)/,
  /^\/newsletter\/subscribers\/(remove|resend)$/,
  /^\/jobs(\/|$)/,
  /^\/users\/[^/]+\/(role|password-reset)$/,
]

/** Whether the public demo's admin account is refused `method` on `path` (the full API path). */
export function isRefusedInDemo(method: string, path: string): boolean {
  if (method === `GET` || method === `HEAD` || !path.startsWith(`${ADMIN_API_PREFIX}/`)) {
    return false
  }
  // Compared as the router could read it: decoded, lower case, without repeated or trailing slashes.
  let inArea = path.slice(ADMIN_API_PREFIX.length)
  try {
    inArea = decodeURIComponent(inArea)
  } catch {
    // A malformed escape stays as written; the router finds no route for it either.
  }
  inArea = inArea.toLowerCase().replace(/\/{2,}/g, `/`).replace(/(.)\/$/, `$1`)
  return REFUSED_PATHS.some((pattern) => pattern.test(inArea))
}

/**
 * Marks a request of the public demo's admin account (`publicDemoAdmin`), which the newsletter
 * reads to show only the fake subscribers, and refuses it every action {@link isRefusedInDemo}
 * names with 403. Mount it behind the area's role check, which sets `auth`.
 */
export function createDemoGuard(
  isPublicDemoAdmin: (userId: number) => Promise<boolean>,
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    if (!await isPublicDemoAdmin(c.get(`auth`)!.user.id)) return await next()
    if (isRefusedInDemo(c.req.method, c.req.path)) {
      return errorResponse(c, `forbidden`, { message: DEMO_REFUSED, reason: `DEMO_REFUSED` })
    }
    c.set(`publicDemoAdmin`, true)
    await next()
  }
}
