import { IconFolder } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** Every group, its members and its owner. Registered, not built yet (#424). */
export const groupsModule: AdminModule = {
  id: `groups`,
  nav: { name: `Groups`, href: `/groups`, Icon: IconFolder },
  routes: [
    comingSoonPage({
      path: `/groups`,
      title: `Groups`,
      description: `Every group, with its members and its owner.`,
      Icon: IconFolder,
    }),
  ],
}
