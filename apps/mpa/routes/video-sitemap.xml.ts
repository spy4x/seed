import { ADMIN_VIDEO } from "../admin-video.ts"
import { define } from "../utils.ts"
import { ADMIN_HERO } from "./admin.tsx"

/** Escapes the five characters XML gives a meaning to. */
function xml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

/**
 * The admin panel video on its page, so search engines index it. It is a sitemap of its own
 * because the page sitemap's builder writes plain `loc` and `lastmod` entries only.
 */
export const handler = define.handlers({
  GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
      `xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n` +
      `  <url><loc>${origin}/admin</loc><video:video>` +
      `<video:thumbnail_loc>${origin}${ADMIN_VIDEO.poster}</video:thumbnail_loc>` +
      `<video:title>${xml(ADMIN_HERO.title)}</video:title>` +
      `<video:description>${xml(ADMIN_HERO.lead)}</video:description>` +
      `<video:content_loc>${origin}${ADMIN_VIDEO.mp4}</video:content_loc>` +
      `<video:duration>${ADMIN_VIDEO.seconds}</video:duration>` +
      `<video:publication_date>${ADMIN_VIDEO.uploadDate}</video:publication_date>` +
      `</video:video></url>\n</urlset>\n`
    return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } })
  },
})
