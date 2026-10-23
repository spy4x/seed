import { Hono } from "hono"
import { canOpenAdmin } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import type { MutationGuards } from "../../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { ADMIN_NOT_FOUND } from "./module.ts"
import { errorResponse } from "../../services/error-response.ts"

export { ADMIN_NOT_FOUND } from "./module.ts"

/** The gate of the operator area and the modules behind it. */
export interface AdminRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** Every module's routes (`adminModuleRoutes` in `registry.ts`), mounted behind the gate. */
  modules: readonly Hono<APIContext>[]
}

/**
 * The operator area (#146), mounted at `/api/admin` and reached on the admin app's host only
 * (`createAdminHostGate`). Only a signed-in session with its second factor reaches it. Below
 * operator, every path answers 404, so the area is invisible; a signed-out caller gets the 401
 * every session route gives. The gate runs before every module (#424), so no module route can
 * answer anyone below operator. The page hides nothing that this does not refuse.
 */
export function createAdminRoute(dependencies: AdminRouteDependencies): Hono<APIContext> {
  const route = new Hono<APIContext>()
    .use(dependencies.auth.isAuthenticated2FA)
    // Before anything else answers: below operator, no path tells anything apart.
    .use(async (c, next) => {
      if (!canOpenAdmin(c.get("auth")!.user.role)) {
        return errorResponse(c, `not_found`, { message: ADMIN_NOT_FOUND })
      }
      await next()
    })
    .use(dependencies.mutationGuards.signedIn)
  for (const module of dependencies.modules) route.route(`/`, module)
  // Every other path under the area, for operators too: the same 404 as below operator.
  route.all(`*`, (c) => errorResponse(c, `not_found`, { message: ADMIN_NOT_FOUND }))
  return route
}
