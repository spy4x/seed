import { IconServer } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** The health of the services behind the product. Registered, not built yet (#424). */
export const systemModule: AdminModule = {
  id: `system`,
  nav: { name: `System`, href: `/system`, Icon: IconServer },
  routes: [
    comingSoonPage({
      path: `/system`,
      title: `System`,
      description: `The health of the database, the queue and the other services.`,
      Icon: IconServer,
    }),
  ],
}
