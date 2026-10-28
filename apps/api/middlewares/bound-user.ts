import type { MiddlewareHandler } from "hono"
import { isBoundToUser, REALTIME_USER_HEADER } from "@spy4x/realtime/operations"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"

/**
 * Refuses a request whose page names another user than the session's (ADR 003). A cookie can
 * change under a running page: another tab signs out and someone else signs in. The page sends the
 * id of the user it was started for in `X-Realtime-User` with every REST request and every call, and a
 * request as anyone else answers 401 `unauthorized`, which signs that page out.
 *
 * It is mounted once, in `createApiApp` (`apps/api/app.ts`), in front of every route.
 *
 * A request with no such header is let through, on purpose. The header is the page's claim, and a
 * caller that claims nothing has nothing to contradict: a page loaded before this check was
 * deployed, a script, the MPA's server, a personal API token. Refusing those would break them and
 * protect nobody, because the mix-up this stops needs a page that still shows another user. The
 * call route is stricter (`apps/api/routes/call.ts`): only this SPA calls it, so it requires the
 * header. A request with no session never contradicts one either; its route answers it.
 */
export const requireBoundUser: MiddlewareHandler<APIContext> = async (c, next) => {
  const claimed = c.req.header(REALTIME_USER_HEADER)
  const auth = c.get("auth")
  if (claimed !== undefined && auth && !isBoundToUser(claimed, auth.user.id)) {
    return errorResponse(c, `unauthorized`, { message: "The session belongs to another user" })
  }
  return await next()
}
