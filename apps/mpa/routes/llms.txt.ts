import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { llmsTxt } from "@spy4x/platform/universal/seo"
import { REPOSITORY_URL, SITE_NAME } from "../brand.ts"
import { SITE_PAGES } from "../pages.ts"
import { define } from "../utils.ts"
import { HOME_HEAD } from "./index.tsx"

/**
 * The website for AI assistants (llmstxt.org): what Seed is, then every public page with its
 * description, on this website's own origin. The newsletter page is left out while subscriptions
 * are off.
 */
export const handler = define.handlers({
  GET(ctx) {
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
        {
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
