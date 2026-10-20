import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { sitemapXml } from "@spy4x/platform/universal/seo"
import { SITE_PAGES } from "../pages.ts"
import { define } from "../utils.ts"

/**
 * Lists the website's public pages, each at its address on this website's own origin, with the
 * day it last changed where the page states one. The newsletter page is left out while
 * subscriptions are off. The admin panel video has its own sitemap, `/video-sitemap.xml`.
 */
export const handler = define.handlers({
  GET(ctx) {
    const body = sitemapXml(
      SITE_PAGES
        .filter(({ path }) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
        .map(({ path, updated }) => ({
          url: `${ctx.state.webAppOrigin}${path}`,
          lastmod: updated === undefined ? undefined : new Date(`${updated}T00:00:00Z`),
        })),
    )
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
