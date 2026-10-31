// Seed's own site: see docs/start-a-product.md
import type { ComponentType } from "preact"
import {
  IconChatBubble,
  IconClock,
  IconCreditCard,
  IconFolder,
  IconHome,
  IconKey,
  IconMail,
  IconPackage,
  IconPencilSquare,
  IconServer,
  IconShieldCheck,
  IconTrendingUp,
  IconUsers,
} from "@spy4x/preact-icons"
import type { IconProps } from "@spy4x/preact-icons"

/** One module of the admin app as the website describes it. */
export interface AdminTourModule {
  /** The module's id in the admin registry (`apps/admin/src/modules/registry.ts`). */
  id: string
  /** The key of its name. */
  name: string
  /** The rail's own icon for it. */
  Icon: ComponentType<IconProps>
  /** The key of one short line on what an operator does there, at most two lines on a card. */
  text: string
}

/**
 * Every module of the admin app, in its rail's order: `/admin`'s cards, and the count that page and
 * `/features` state. `admin-modules.test.ts` fails when this list and the admin registry differ.
 */
export const ADMIN_TOUR_MODULES: readonly AdminTourModule[] = [
  { id: `dashboard`, name: `AdminTour.dashboard`, Icon: IconHome, text: `AdminTour.dashboardText` },
  { id: `stats`, name: `AdminTour.stats`, Icon: IconTrendingUp, text: `AdminTour.statsText` },
  { id: `users`, name: `AdminTour.users`, Icon: IconUsers, text: `AdminTour.usersText` },
  { id: `groups`, name: `AdminTour.groups`, Icon: IconFolder, text: `AdminTour.groupsText` },
  { id: `billing`, name: `AdminTour.billing`, Icon: IconCreditCard, text: `AdminTour.billingText` },
  {
    id: `newsletter`,
    name: `AdminTour.newsletter`,
    Icon: IconMail,
    text: `AdminTour.newsletterText`,
  },
  { id: `blog`, name: `AdminTour.blog`, Icon: IconPencilSquare, text: `AdminTour.blogText` },
  {
    id: `contact-links`,
    name: `AdminTour.contactLinks`,
    Icon: IconChatBubble,
    text: `AdminTour.contactLinksText`,
  },
  { id: `catalog`, name: `AdminTour.catalog`, Icon: IconPackage, text: `AdminTour.catalogText` },
  { id: `audit`, name: `AdminTour.audit`, Icon: IconShieldCheck, text: `AdminTour.auditText` },
  { id: `jobs`, name: `AdminTour.jobs`, Icon: IconClock, text: `AdminTour.jobsText` },
  { id: `system`, name: `AdminTour.system`, Icon: IconServer, text: `AdminTour.systemText` },
  { id: `api-tokens`, name: `AdminTour.tokens`, Icon: IconKey, text: `AdminTour.tokensText` },
]
