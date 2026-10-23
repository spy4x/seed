import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { sitemapXml } from "@spy4x/platform/universal/seo"
import { blogPages } from "../blog.ts"
import { SITE_PAGES } from "../pages.ts"
import { define } from "../utils.ts"

/**
 * Lists the website's public pages, each at its address on this website's own origin, with the
 * day it last changed where the page states one. The newsletter page is left out while
 * subscriptions are off. The blog and its live posts follow, each post with the day it was
 * published or last significantly updated; with no live post, or while the API cannot answer, the
 * blog is left out. The admin panel video has its own sitemap, `/video-sitemap.xml`.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const body = sitemapXml([
      ...SITE_PAGES
        .filter(({ path }) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
        .map(({ path, updated }) => ({
          url: `${origin}${path}`,
          lastmod: updated === undefined ? undefined : new Date(`${updated}T00:00:00Z`),
        })),
      ...(await blogPages(ctx.state.api)).map(({ path, lastmod }) => ({
        url: `${origin}${path}`,
        lastmod: new Date(lastmod),
      })),
    ])
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
