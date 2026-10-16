import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"

/** The `api-tokens` module of the operator area: registered, with no routes yet (#424). */
export const apiTokensAdminModule: AdminApiModule = {
  id: `api-tokens`,
  routes: () => new Hono<APIContext>(),
}
