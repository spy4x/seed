import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { ADMIN_VIDEO } from "../admin-video.ts"
import { SITE_PAGES } from "../site.tsx"
import { define } from "../utils.ts"
import { ADMIN_HERO, ADMIN_UPDATED } from "./admin.tsx"

/** Escapes the five characters XML gives a meaning to. */
function xml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/** `/admin`'s extra lines: when it last changed, and its video, so search engines index both. */
function adminEntry(origin: string): string {
  return `<lastmod>${ADMIN_UPDATED}</lastmod><video:video>` +
    `<video:thumbnail_loc>${origin}${ADMIN_VIDEO.poster}</video:thumbnail_loc>` +
    `<video:title>${xml(ADMIN_HERO.title)}</video:title>` +
    `<video:description>${xml(ADMIN_HERO.lead)}</video:description>` +
    `<video:content_loc>${origin}${ADMIN_VIDEO.mp4}</video:content_loc>` +
    `<video:duration>${ADMIN_VIDEO.seconds}</video:duration>` +
    `<video:publication_date>${ADMIN_VIDEO.uploadDate}</video:publication_date>` +
    `</video:video>`
}

/**
 * Lists the website's public pages, each at its address on this website's own origin, and the
 * admin panel video on its page. The newsletter page is left out while subscriptions are off.
 */
export const handler = define.handlers({
  GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const urls = SITE_PAGES
      .filter((path) => ctx.state.newsletter || path !== FORM_ACTIONS.subscribe)
      .map((path) =>
        `  <url><loc>${origin}${path}</loc>${path === `/admin` ? adminEntry(origin) : ``}</url>`
      )
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
      `xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${urls.join("\n")}\n` +
      `</urlset>\n`
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
