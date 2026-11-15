import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import {
  ADMIN_IMPORTS_PAGE_SIZE,
  type AdminImportFilter,
  type AdminImportListResponse,
  parseAdminImportFilter,
} from "@domain/imports"
import { type AdminImportPage, listAdminImports } from "@server/imports/admin-imports.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** What the Imports routes call. */
export interface AdminImportsRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  list(filter: AdminImportFilter): Promise<AdminImportPage>
}

/**
 * `GET /imports`: every group's imports, one page at a time, newest first, with the count of each
 * status chip. Mounted at `/api/admin` behind the gate in `+routes.ts`, as the Jobs routes are: only
 * an operator with a full session reaches it. It answers where each import is, its counts and its
 * timing, never the file, its name, its cells or the options a person gave (`AdminImportRow`).
 */
export function createAdminImportsRoutes(
  { limit, list }: AdminImportsRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>().get(`/imports`, limit, async (c) => {
    const filter = parseAdminImportFilter(new URL(c.req.url).searchParams)
    const page = await list(filter)
    const body: AdminImportListResponse = {
      imports: page.imports,
      counts: page.counts,
      total: page.total,
      page: filter.page,
      pageSize: ADMIN_IMPORTS_PAGE_SIZE,
    }
    return c.json(body)
  })
}

/** Every group's file imports, for an operator who looks into a failed or slow one. */
export const importsAdminModule: AdminApiModule = {
  id: `imports`,
  // `sql` is read at call time: the routes are built before any request, and with no database in
  // tests.
  routes: (context) =>
    createAdminImportsRoutes({
      limit: context.limit,
      list: (filter) => listAdminImports(context.sql, filter),
    }),
}
