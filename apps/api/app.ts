import { Hono } from "hono"
import {
  applyBaseMiddleware,
  type BaseMiddlewareOptions,
} from "@spy4x/server/request-log/base-middleware"
import { securityHeaders } from "@spy4x/server/http/security-headers"
import { requireBoundUser } from "./middlewares/bound-user.ts"
import type { APIContext } from "./_types.ts"

/**
 * The API's app before any route is mounted: the base path, the security headers, the request log
 * and session parser, and the one check every route stands behind (`requireBoundUser`): a request
 * whose page names another user than the session's is refused, whatever it asks for (ADR 003). It
 * is here, and not in each route, so a new route cannot forget it.
 *
 * The security headers go first, so no middleware can answer in front of them: they are on a
 * route's answer, on the refusal of the page-user check, on the 404 of an unknown address and on
 * the 500 of an error. The API answers JSON and no page, so the policy is the library's strictest,
 * with nothing added (docs/security-headers.md).
 */
export async function createApiApp(options: BaseMiddlewareOptions): Promise<Hono<APIContext>> {
  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", await securityHeaders())
  applyBaseMiddleware(app, options)
  app.use("*", requireBoundUser)
  return app
}
