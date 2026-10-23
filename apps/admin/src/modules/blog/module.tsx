import { IconPencilSquare } from "@spy4x/preact-icons"
import type { AdminModule } from "../types.ts"
import { comingSoonPage } from "../coming-soon.tsx"

/** Posts on the public website. The API is built (#395); its pages are not yet. */
export const blogModule: AdminModule = {
  id: `blog`,
  nav: { name: `Blog`, href: `/blog`, Icon: IconPencilSquare },
  routes: [
    comingSoonPage({
      path: `/blog`,
      title: `Blog`,
      description: `Posts on the public website, from draft to published.`,
      Icon: IconPencilSquare,
    }),
  ],
}
