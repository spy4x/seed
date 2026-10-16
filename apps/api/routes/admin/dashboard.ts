import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import type { AdminStats } from "@domain/identity"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** What the dashboard route calls. */
export interface AdminStatsRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  /** Reads the numbers now. */
  stats(): Promise<AdminStats>
}

/**
 * `GET /stats` answers the dashboard's {@link AdminStats} (#424): counts and two 30-day series,
 * never a name, an address or any content.
 */
export function createAdminStatsRoutes(
  dependencies: AdminStatsRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .get(`/stats`, dependencies.limit, async (c) => c.json(await dependencies.stats()))
}

/** The dashboard module: the numbers on the operator area's first page. */
export const dashboardAdminModule: AdminApiModule = {
  id: `dashboard`,
  routes: ({ db, limit, now }) =>
    createAdminStatsRoutes({ limit, stats: () => db.admin.stats(now()) }),
}
