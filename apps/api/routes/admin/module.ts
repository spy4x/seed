import type { Hono, MiddlewareHandler } from "hono"
import type { UserSignedOutEvent } from "@api/cqrs/events.ts"
import type { AppDbBase } from "@api/services/db-base.ts"
import type { APIContext } from "../../_types.ts"

/** The answer to anyone below operator, on every path: the area does not exist for them. */
export const ADMIN_NOT_FOUND = "Not found"

/** What every operator-area module may build its routes from. `index.ts` passes the singletons. */
export interface AdminModuleContext {
  db: AppDbBase
  /** The normal per-user budget the session routes spend too. Every module route spends it. */
  limit: MiddlewareHandler<APIContext>
  /** Closes a person's sockets after their sessions end. */
  emit(event: UserSignedOutEvent): void
  now(): Date
}

/**
 * One module of the operator area's API (`docs/admin-modules.md`). Its routes are mounted under
 * `/api/admin` behind the gate in `+routes.ts`, which has already refused anyone below operator
 * and every cross-site write, so a module adds no check of its own for either.
 */
export interface AdminApiModule {
  /** The same id as the admin app's module (`apps/admin/src/modules/`). */
  id: string
  routes(context: AdminModuleContext): Hono<APIContext>
}
