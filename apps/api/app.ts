import { Hono } from "hono"
import {
  applyBaseMiddleware,
  type BaseMiddlewareOptions,
} from "@spy4x/server/request-log/base-middleware"
import { securityHeaders } from "@spy4x/server/http/security-headers"
import { requireBoundUser } from "./middlewares/bound-user.ts"
import { createAdminHostGate } from "./middlewares/admin-host.ts"
import { type IsProxyPeer, requireProxyForForwardedHeaders } from "@spy4x/server/http/trusted-proxy"
import { denoServeRemoteAddr } from "@spy4x/platform/rate-limit/hono"
import type { APIContext } from "./_types.ts"
import {
  errorResponse,
  libraryRefusals,
  unhandledErrorResponse,
} from "./services/error-response.ts"

/**
 * The API's app before any route is mounted: the base path, the security headers, the request log
 * and session parser, and the one check every route stands behind (`requireBoundUser`): a request
 * whose page names another user than the session's is refused, whatever it asks for (ADR 003). It
 * is here, and not in each route, so a new route cannot forget it.
 *
 * A request that names its client in `X-Real-IP` or a like header is refused unless it comes from
 * a trusted proxy (`isProxyPeer`), so a container beside the API cannot pick the address the rate
 * limits count it under (`requireProxyForForwardedHeaders`).
 *
 * The admin host gate stands there too: the admin app's host reaches the operator area and its
 * own sign-in only, and no other host reaches the operator area (`createAdminHostGate`). Without
 * the SPA (`spa: false`) no host but the admin host reaches the account routes either.
 *
 * The security headers go first, so no middleware can answer in front of them: they are on a
 * route's answer, on the refusal of the page-user check, on the 404 of an unknown address and on
 * the 500 of an error. The API answers JSON and no page, so the policy is the library's strictest,
 * with nothing added (docs/security-headers.md).
 *
 * The 404 of an unknown address and the answer to an error no route handled use the API's one
 * error body too (docs/api-errors.md), and so does every refusal of a shared library's middleware
 * (`libraryRefusals`), so a client never meets a second error shape.
 */
export async function createApiApp(
  options: BaseMiddlewareOptions & {
    adminHost?: string | null
    /** Whether the SPA runs (`SPA`); `false` closes its account routes. */
    spa?: boolean
    isProxyPeer: IsProxyPeer
  },
): Promise<Hono<APIContext>> {
  const { adminHost = null, spa = true, isProxyPeer, ...base } = options
  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", await securityHeaders())
  app.use("*", libraryRefusals)
  applyBaseMiddleware(app, base)
  // After the base middleware, which sets a plain-text handler of its own.
  app.onError((error, c) => unhandledErrorResponse(c, error))
  app.notFound((c) => errorResponse(c, `not_found`, { message: `Not found` }))
  app.use(
    "*",
    requireProxyForForwardedHeaders<APIContext>(isProxyPeer, { remoteAddr: denoServeRemoteAddr }),
  )
  app.use("*", createAdminHostGate(adminHost, { spa }))
  app.use("*", requireBoundUser)
  return app
}
