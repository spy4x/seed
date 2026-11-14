import { Hono } from "hono"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule, AdminModuleContext } from "./module.ts"
import { dashboardAdminModule } from "./dashboard.ts"
import { statsAdminModule } from "./stats.ts"
import { usersAdminModule } from "./users.ts"
import { groupsAdminModule } from "./groups.ts"
import { billingAdminModule } from "./billing.ts"
import { newsletterAdminModule } from "./newsletter.ts"
import { blogAdminModule } from "./blog.ts"
import { contactLinksAdminModule } from "./contact-links.ts"
import { catalogAdminModule } from "./catalog.ts"
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
  statsAdminModule,
  usersAdminModule,
  groupsAdminModule,
  billingAdminModule,
  newsletterAdminModule,
  blogAdminModule,
  contactLinksAdminModule,
  catalogAdminModule,
  auditAdminModule,
  jobsAdminModule,
  systemAdminModule,
  apiTokensAdminModule,
]

/** The modules that are on over `context`: every one without `enabled`, and those it allows. */
export function enabledAdminModules(context: AdminModuleContext): AdminApiModule[] {
  return ADMIN_API_MODULES.filter((module) => module.enabled?.(context) ?? true)
}

/**
 * The id `GET /modules` adds while the notes are on (`readNotesSetup`). The notes have no admin
 * module of their own: the admin app reads it to hide the group page's note widgets and Files tab.
 */
const NOTES_FEATURE_ID = `notes`

/**
 * The routes of every module that is on, built over `context`, and `GET /modules`: the ids of
 * those modules, so the admin app shows only them, and `notes` while the notes are on.
 */
export function adminModuleRoutes(context: AdminModuleContext): Hono<APIContext>[] {
  const modules = enabledAdminModules(context)
  const ids = modules.map((module) => module.id)
  // Left out, the notes are on (`AdminModuleContext.notes`).
  if (context.notes?.on ?? true) ids.push(NOTES_FEATURE_ID)
  return [
    new Hono<APIContext>().get(`/modules`, context.limit, (c) => c.json({ ids })),
    ...modules.map((module) => module.routes(context)),
  ]
}
