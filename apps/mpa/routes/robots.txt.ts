import { ROBOTS_POLICY } from "../config.ts"
import { define } from "../utils.ts"

/**
 * The crawler policy from {@link ROBOTS_POLICY}: one group for every crawler, one for each named
 * bot, then the sitemaps, on this website's own origin.
 */
export const handler = define.handlers({
  GET(ctx) {
    const rules = [...ROBOTS_POLICY.disallow.map((path) => `Disallow: ${path}`), `Allow: /`]
    const groups = [`*`, ...ROBOTS_POLICY.allowBots]
      .map((agent) => [`User-agent: ${agent}`, ...rules].join(`\n`))
    const origin = ctx.state.webAppOrigin
    const body = `${groups.join(`\n\n`)}\n\n` +
      `Sitemap: ${origin}/sitemap.xml\nSitemap: ${origin}/video-sitemap.xml\n`
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } })
  },
})
