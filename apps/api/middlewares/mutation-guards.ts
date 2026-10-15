import type { MiddlewareHandler } from "hono"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import type { APIContext } from "../_types.ts"
import { isAdminHost } from "./admin-host.ts"

/**
 * The two same-origin guards every mutating route mounts. Both let GET, HEAD and OPTIONS through
 * and refuse any other request with 403 unless `Origin` is the web app's origin and
 * `Sec-Fetch-Site` is `same-origin`, so another site cannot make a signed-in browser change state.
 */
export interface MutationGuards {
  /**
   * Also requires the session cookie. Mount it after `isAuthenticated1FA` or `isAuthenticated2FA`,
   * so a request with an expired or missing session gets their 401, which sends the front end to
   * sign-in, instead of this guard's 403.
   */
  signedIn: MiddlewareHandler<APIContext>
  /**
   * Does not require the session cookie: for sign-in, sign-up and sign-out, which must work without
   * one. It still stops another site from signing the browser in to an attacker's account.
   */
  anonymous: MiddlewareHandler<APIContext>
}

/**
 * Builds the guards for the web app at `webAppUrl`, such as `https://app.example.com`. With
 * `adminAppUrl`, a request that came to the admin app's host must come from the admin app's origin
 * instead, and from nowhere else; `createAdminHostGate` limits which routes that host reaches.
 *
 * The expected origin comes from configuration, never from the request: behind the proxy that
 * terminates TLS the API sees `http://…` while the browser sends `Origin: https://…`, so the
 * request URL's own origin would refuse every mutation.
 */
export function createMutationGuards(
  webAppUrl: string,
  adminAppUrl: string | null = null,
): MutationGuards {
  const app = guardsFor(webAppUrl)
  if (adminAppUrl === null) return app
  const admin = guardsFor(adminAppUrl)
  const adminHost = new URL(adminAppUrl).host
  const pick = (name: keyof MutationGuards): MiddlewareHandler<APIContext> => (c, next) =>
    (isAdminHost(c.req.url, adminHost) ? admin : app)[name](c, next)
  return { signedIn: pick("signedIn"), anonymous: pick("anonymous") }
}

function guardsFor(url: string): MutationGuards {
  const expectedOrigin = new URL(url).origin
  return {
    signedIn: createSameOriginMutationGuard<APIContext>({ expectedOrigin }),
    anonymous: createSameOriginMutationGuard<APIContext>({
      expectedOrigin,
      requireSessionCookie: false,
    }),
  }
}
