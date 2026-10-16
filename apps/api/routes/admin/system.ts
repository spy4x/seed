import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** The `system` module of the operator area: registered, with no routes yet (#424). */
export const systemAdminModule: AdminApiModule = {
  id: `system`,
  routes: () => new Hono<APIContext>(),
}
