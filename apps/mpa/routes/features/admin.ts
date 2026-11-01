// Seed's own site: see docs/start-a-product.md
import { define } from "../../utils.ts"

/**
 * `/features/admin` answers 301 to `/admin`, the admin panel's page. The address also fits
 * `routes/[[lang]]/admin.tsx`, which Fresh tries before `features/[slug].tsx` and which reads
 * `features` as a language and answers 404; a route with no language segment comes first. Another
 * language's address (`/de/features/admin`) reaches `features/[slug].tsx`, which redirects it.
 */
export const handler = define.handlers({
  GET(ctx) {
    return ctx.redirect(`/admin`, 301)
  },
})
