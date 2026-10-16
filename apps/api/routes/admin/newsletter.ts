import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** The `newsletter` module of the operator area: registered, with no routes yet (#424). */
export const newsletterAdminModule: AdminApiModule = {
  id: `newsletter`,
  routes: () => new Hono<APIContext>(),
}
