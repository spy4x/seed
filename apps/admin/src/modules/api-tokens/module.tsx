import { IconKey } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage, comingSoonTab } from "../coming-soon.tsx"

/**
 * API tokens, and a person's devices and notifications. Registered, not built yet (#424): its page
 * and its three person tabs say so.
 */
export const apiTokensModule: AdminModule = {
  id: `api-tokens`,
  nav: { name: `API tokens`, href: `/api-tokens`, Icon: IconKey },
  routes: [
    comingSoonPage({
      path: `/api-tokens`,
      title: `API tokens`,
      description: `Every API token, who made it and when it was last used.`,
      Icon: IconKey,
    }),
  ],
  personTabs: [
    comingSoonTab({
      id: `api-tokens`,
      label: `API tokens`,
      description: `The person's API tokens and when each was last used.`,
    }),
    comingSoonTab({
      id: `devices`,
      label: `Devices`,
      description: `The devices that receive the person's push notifications.`,
    }),
    comingSoonTab({
      id: `notifications`,
      label: `Notifications`,
      description: `What the product has told the person, and what they have read.`,
    }),
  ],
}
