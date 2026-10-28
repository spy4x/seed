import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { sitemapXml } from "@spy4x/platform/universal/seo"
import { BLOG_PATH, blogPages } from "../blog.ts"
import { SITE_PAGES } from "../pages.ts"
import { define } from "../utils.ts"
import { localePath, SITE_LANGUAGES } from "../languages.ts"

/**
 * Lists the website's public pages, each at its address on this website's own origin, with the
 * day it last changed where the page states one. A page is listed once per language (`/pricing`,
 * `/de/pricing`, …), except one that is English at every address: the legal pages, the API
 * reference and the blog's posts are listed at their English address only. The newsletter page is left out while
 * subscriptions are off. The blog and its live posts follow, each post with the day it was
 * published or last significantly updated; with no live post, or while the API cannot answer, the
 * blog is left out. The admin panel video has its own sitemap, `/video-sitemap.xml`.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const everyLanguage = (path: string, oneLanguage = false) =>
      oneLanguage ? [path] : SITE_LANGUAGES.map((language) => localePath(language, path))
    const body = sitemapXml([
      ...SITE_PAGES
        .filter(({ path }) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
        .flatMap(({ path, updated, oneLanguage }) =>
          everyLanguage(path, oneLanguage).map((address) => ({
            url: `${origin}${address}`,
            lastmod: updated === undefined ? undefined : new Date(`${updated}T00:00:00Z`),
          }))
        ),
      ...(await blogPages(ctx.state.api)).flatMap(({ path, lastmod }) =>
        everyLanguage(path, path !== BLOG_PATH).map((address) => ({
          url: `${origin}${address}`,
          lastmod: new Date(lastmod),
        }))
      ),
    ])
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
