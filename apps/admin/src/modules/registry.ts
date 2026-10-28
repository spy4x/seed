/**
 * Every module of the operator area, in the sidebar's order (`docs/admin-modules.md`). The API's
 * list (`apps/api/routes/admin/registry.ts`) names the same ids in the same order.
 *
 * @module
 */

import { apiTokensModule } from "./api-tokens/module.tsx"
import { auditModule } from "./audit/module.tsx"
import { billingModule } from "./billing/module.tsx"
import { blogModule } from "./blog/module.tsx"
import { catalogModule } from "./catalog/module.tsx"
import { contactLinksModule } from "./contact-links/module.tsx"
import { dashboardModule } from "./dashboard/module.tsx"
import { groupsModule } from "./groups/module.tsx"
import { jobsModule } from "./jobs/module.tsx"
import { newsletterModule } from "./newsletter/module.tsx"
import { systemModule } from "./system/module.tsx"
import type { AdminModule, AdminPersonTab } from "./types.ts"
import { usersModule } from "./users/module.tsx"

export const ADMIN_MODULES: readonly AdminModule[] = [
  dashboardModule,
  usersModule,
  groupsModule,
  billingModule,
  newsletterModule,
  blogModule,
  contactLinksModule,
  catalogModule,
  auditModule,
  jobsModule,
  systemModule,
  apiTokensModule,
]

/** The modules to show: every one that is not optional, and the optional ones `on` lists. */
export function shownModules(
  modules: readonly AdminModule[],
  on: ReadonlySet<string>,
): AdminModule[] {
  return modules.filter((module) => !module.optional || on.has(module.id))
}

/** Every module's person tabs, in registry order. */
export function adminPersonTabs(modules: readonly AdminModule[]): AdminPersonTab[] {
  return modules.flatMap((module) => module.personTabs ?? [])
}
