import { HttpError } from "fresh"
import { CATALOG_LINK_CODE_PATTERN } from "@domain/catalog"
import { define } from "../../utils.ts"

/**
 * A catalog item's tracking link (#483, docs/catalog.md): `/s/<code>` answers 302 to where the API
 * says, which is Umami's counting address, or the item's page tagged with the link's source. The
 * address comes from the API, which builds it from the code's own row, never from the request, so
 * this route cannot send anyone to an address a visitor picked. An unknown code, or one whose item
 * is not on the website, is the site's 404 page. `?counted=1` is Umami's way back after counting.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const code = ctx.params.code ?? ``
    if (!CATALOG_LINK_CODE_PATTERN.test(code)) throw new HttpError(404)
    const counted = ctx.url.searchParams.get(`counted`) === `1`
    const answer = await ctx.state.api.call(
      `GET`,
      `/api/catalog/links/${code}${counted ? `?counted=1` : ``}`,
    )
    if (answer.status === 404) throw new HttpError(404)
    const location = (answer.body as { location?: unknown } | null)?.location
    if (answer.status !== 200 || typeof location !== `string` || !/^https?:\/\//.test(location)) {
      throw new HttpError(502)
    }
    return new Response(null, {
      status: 302,
      headers: { location, "cache-control": `no-store`, "x-robots-tag": `noindex` },
    })
  },
})
