import type { MiddlewareHandler } from "hono"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"

/** The operator area's routes, under the API's base path. */
export const ADMIN_API_PREFIX = "/api/admin"

/**
 * The only routes besides the operator area that the admin app's host reaches: who is signed in
 * and their address (the account cell shows it when they have no name), sign-in with a password,
 * its authenticator code, and sign-out. Everything else the product does
 * (sign-up, Google and GitHub, notes, groups) stays on the web app's host.
 */
export const ADMIN_HOST_AUTH_PATHS: readonly string[] = [
  "/api/auth/me",
  "/api/auth/email",
  "/api/auth/password/check",
  "/api/auth/totp/check",
  "/api/auth/sign-out",
]

/** Sign-up, sign-in and every other account route of the web app, under the API's base path. */
export const AUTH_API_PREFIX = "/api/auth"

/** Whether `path` is the operator area or a route under it. */
export function isAdminApiPath(path: string): boolean {
  return path === ADMIN_API_PREFIX || path.startsWith(`${ADMIN_API_PREFIX}/`)
}

/** Whether `path` is one of the web app's account routes. */
function isAuthApiPath(path: string): boolean {
  return path === AUTH_API_PREFIX || path.startsWith(`${AUTH_API_PREFIX}/`)
}

/**
 * Keeps the admin app (#146) and the web app apart on the API they share. The admin app runs on
 * its own host (`ADMIN_DOMAIN`), so its session cookie is that host's alone. This gate makes the
 * API hold the same line:
 *
 * - On the admin host, only the operator area and {@link ADMIN_HOST_AUTH_PATHS} answer; every
 *   other path is 404.
 * - On any other host, the operator area is 404: a session of the web app, or a script on its
 *   page, never reaches it.
 * - With no admin host configured, the operator area is 404 everywhere.
 * - Without the SPA (`spa: false`, `SPA=false`), every account route under `/api/auth` is 404 on
 *   every host but the admin host: sign-up, sign-in links, Google and GitHub, guests and passkeys.
 *   Nobody can make or enter an account there, and the admin host keeps its own sign-in.
 *
 * The path is the one the router matches, with its percent-escapes decoded, so an escaped letter
 * (`/api/%61dmin`) cannot reach a route the gate did not check. The host is the request's own, as
 * the proxy passed it on. The role check in the operator area's
 * route still decides who may use it; this gate only decides from where.
 */
export function createAdminHostGate(
  adminHost: string | null,
  { spa = true }: { spa?: boolean } = {},
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    // The decoded path, the one the router matches: `/api/%61dmin` is the operator area too.
    const path = c.req.path
    const allowed = isAdminHost(c.req.url, adminHost)
      ? isAdminApiPath(path) || ADMIN_HOST_AUTH_PATHS.includes(path)
      : !isAdminApiPath(path) && (spa || !isAuthApiPath(path))
    if (!allowed) return errorResponse(c, `not_found`, { message: "Not found" })
    await next()
  }
}

/** Whether the request came to the admin app's host. */
export function isAdminHost(url: string, adminHost: string | null): boolean {
  return adminHost !== null && new URL(url).host.toLowerCase() === adminHost.toLowerCase()
}
