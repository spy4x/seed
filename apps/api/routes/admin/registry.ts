import type { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule, AdminModuleContext } from "./module.ts"
import { dashboardAdminModule } from "./dashboard.ts"
import { usersAdminModule } from "./users.ts"
import { groupsAdminModule } from "./groups.ts"
import { billingAdminModule } from "./billing.ts"
import { newsletterAdminModule } from "./newsletter.ts"
import { blogAdminModule } from "./blog.ts"
import { contactLinksAdminModule } from "./contact-links.ts"
import { auditAdminModule } from "./audit.ts"
import { jobsAdminModule } from "./jobs.ts"
import { systemAdminModule } from "./system.ts"
import { apiTokensAdminModule } from "./api-tokens.ts"

/**
 * Every module of the operator area's API, in the admin app's sidebar order. A new module is one
 * file here plus one line in this list (`docs/admin-modules.md`).
 */
export const ADMIN_API_MODULES: readonly AdminApiModule[] = [
  dashboardAdminModule,
  usersAdminModule,
  groupsAdminModule,
  billingAdminModule,
  newsletterAdminModule,
  blogAdminModule,
  contactLinksAdminModule,
  auditAdminModule,
  jobsAdminModule,
  systemAdminModule,
  apiTokensAdminModule,
]

/** The routes of every registered module, built over `context`. */
export function adminModuleRoutes(context: AdminModuleContext): Hono<APIContext>[] {
  return ADMIN_API_MODULES.map((module) => module.routes(context))
}
