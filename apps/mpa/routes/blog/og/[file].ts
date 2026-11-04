import { define } from "../../../utils.ts"
import { seedPostFiles } from "../../../seed-post-files.ts"

/**
 * The link-preview cards of Seed's own posts, `<slug>.jpg` in `libs/server/blog/seed-posts/og/`,
 * made by `deno task og:blog` (`screenshots/blog-og.ts`). The source (`routes/blog/og/`) and the
 * build (`_fresh/server/assets/`) sit at the same depth, so the path holds in both.
 */
export const CARDS = seedPostFiles(
  new URL(`../../../../../libs/server/blog/seed-posts/og/`, import.meta.url),
  `jpg`,
)

export const handler = define.handlers({
  GET: (ctx) => CARDS.serve(ctx.req, ctx.params.file),
})
