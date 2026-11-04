import { define } from "../../../utils.ts"
import { seedPostFiles } from "../../../seed-post-files.ts"

/**
 * The covers of Seed's own posts (`apps/mpa/blog-covers.ts`), `<slug>.webp`, `<slug>-960.webp`
 * and `<slug>-640.webp` in `libs/server/blog/seed-posts/covers/`. The source (`routes/blog/covers/`) and the build
 * (`_fresh/server/assets/`) sit at the same depth, so the path holds in both.
 */
export const COVERS = seedPostFiles(
  new URL(`../../../../../libs/server/blog/seed-posts/covers/`, import.meta.url),
  `webp`,
)

export const handler = define.handlers({
  GET: (ctx) => COVERS.serve(ctx.req, ctx.params.file),
})
