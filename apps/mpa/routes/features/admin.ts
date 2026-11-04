// Seed's own site: see docs/start-a-product.md
import { define } from "../../utils.ts"

/**
 * `/features/admin` answers 301 to `/admin`, the admin panel's page. The address also fits
 * `routes/[[lang]]/admin.tsx`, which reads `features` as a language and answers 404; a route with
 * no parameter is tried first (`@spy4x/preact-server`), so this one answers it. Another
 * language's address (`/de/features/admin`) reaches `features/[slug].tsx`, which redirects it.
 */
export const handler = define.handlers({
  GET(ctx) {
    return ctx.redirect(`/admin`, 301)
  },
})
