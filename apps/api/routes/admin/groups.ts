import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** The `groups` module of the operator area: registered, with no routes yet (#424). */
export const groupsAdminModule: AdminApiModule = {
  id: `groups`,
  routes: () => new Hono<APIContext>(),
}
