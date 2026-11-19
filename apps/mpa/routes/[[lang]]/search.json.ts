import { siteSearchIndex } from "../../search.ts"
import { define } from "../../utils.ts"

/**
 * The website's search index for the header's search, linking to the address's language
 * (`/de/search.json` links to `/de/pricing`). It changes only with a deploy, so a browser keeps it
 * for an hour.
 */
export const handler = define.handlers({
  GET(ctx) {
    return new Response(siteSearchIndex(ctx.state).json, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    })
  },
})
