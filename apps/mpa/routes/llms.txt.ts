import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { llmsTxt } from "@spy4x/platform/universal/seo"
import { REPOSITORY_URL, SITE_NAME } from "../brand.ts"
import { blogPages } from "../blog.ts"
import { SITE_PAGES } from "../pages.ts"
import { define } from "../utils.ts"
import { HOME_HEAD } from "./index.tsx"

/**
 * The website for AI assistants (llmstxt.org): what Seed is, then every public page with its
 * description, on this website's own origin. The newsletter page is left out while subscriptions
 * are off. The blog's live posts follow in a section of their own, which is left out while no post
 * is live or the API cannot answer.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const blog = await blogPages(ctx.state.api)
    const body = llmsTxt({
      title: SITE_NAME,
      summary: HOME_HEAD.description,
      sections: [
        {
          title: `Pages`,
          links: SITE_PAGES
            .filter(({ path }) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
            .map(({ path, title, description }) => ({
              title,
              url: `${ctx.state.webAppOrigin}${path}`,
              description,
            })),
        },
        ...(blog.length === 0 ? [] : [{
          title: `Blog`,
          links: blog.map(({ path, title, description }) => ({
            title,
            url: `${ctx.state.webAppOrigin}${path}`,
            description,
          })),
        }]),
        {
          // Seed's own site: see docs/start-a-product.md
          title: `Source code`,
          links: [{
            title: `${SITE_NAME} on GitHub`,
            url: REPOSITORY_URL,
            description: `The code, the README and the docs, under the MIT licence.`,
          }],
        },
      ],
    })
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } })
  },
})
