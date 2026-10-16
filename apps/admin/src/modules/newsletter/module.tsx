import { IconMail } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** The newsletter's subscribers and sends. Registered, not built yet (#424). */
export const newsletterModule: AdminModule = {
  id: `newsletter`,
  nav: { name: `Newsletter`, href: `/newsletter`, Icon: IconMail },
  routes: [
    comingSoonPage({
      path: `/newsletter`,
      title: `Newsletter`,
      description: `The newsletter's subscribers and what was sent to them.`,
      Icon: IconMail,
    }),
  ],
}
