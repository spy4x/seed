import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type { VersionedPreferences } from "@domain/identity"
import type { APIContext } from "../../_types.ts"

/** What the operator's own preferences route calls. */
export interface AdminOwnPreferencesRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  /** The person's resolved preferences; the defaults at version `0` when they never saved. */
  read(userId: number): Promise<VersionedPreferences>
}

/**
 * `GET /me/preferences` answers the signed-in operator's own display preferences (#163), so the
 * admin app writes every date in the operator's region format, zone and clock. Read-only: the
 * operator changes them in the product's app. Mounted behind the gate in `+routes.ts`, beside the
 * modules; it is no module, so it has no page in the admin app's sidebar.
 */
export function createAdminOwnPreferencesRoute(
  dependencies: AdminOwnPreferencesRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .get(
      `/me/preferences`,
      dependencies.limit,
      async (c) => c.json(await dependencies.read(c.get("auth")!.user.id)),
    )
}
