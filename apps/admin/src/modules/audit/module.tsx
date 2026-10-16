import { IconShieldCheck } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** The audit trail across everyone. Registered, not built yet (#424). */
export const auditModule: AdminModule = {
  id: `audit`,
  nav: { name: `Audit log`, href: `/audit`, Icon: IconShieldCheck },
  routes: [
    comingSoonPage({
      path: `/audit`,
      title: `Audit log`,
      description: `Every sign-in and operator action across the product, searchable.`,
      Icon: IconShieldCheck,
    }),
  ],
}
