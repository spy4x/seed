import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { SITE_PAGES } from "../site.tsx"
import { define } from "../utils.ts"

/**
 * Lists the website's public pages, each at its address on this website's own origin. The
 * newsletter page is left out while subscriptions are off.
 */
export const handler = define.handlers({
  GET(ctx) {
    const urls = SITE_PAGES
      .filter((path) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
      .map((path) => `  <url><loc>${ctx.state.webAppOrigin}${path}</loc></url>`)
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        urls.join("\n")
      }\n</urlset>\n`
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
