import { HttpError } from "@spy4x/preact-server"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { define } from "../../../../utils.ts"

/** A stored width's file name, as the API names them: `960.webp`, `480.avif`. */
const WIDTH_FILE = /^[1-9][0-9]{0,4}\.(avif|webp)$/

/**
 * One width of a published catalog photo (`/catalog/photos/<id>/<file>`), from the API's
 * `/api/catalog/photos/:id/:file`. The website serves it from its own host: the API's answers may
 * be read by its own origin only, and the website's pages load images from theirs. The bytes,
 * their type and the API's cache rule pass on; anything the API does not answer with a photo is
 * the 404 page, or the error page for an API that cannot be reached.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const id = ctx.params.id ?? ``
    const file = ctx.params.file ?? ``
    if (!isUuid(id) || !WIDTH_FILE.test(file)) throw new HttpError(404)
    const answer = await ctx.state.api.file(`/api/catalog/photos/${id.toLowerCase()}/${file}`)
    if (answer.status === 404) throw new HttpError(404)
    // Only an image type leaves, so nothing the API answers can be served as a page of this site.
    if (answer.bytes === null || !/^image\/(avif|webp)$/.test(answer.type ?? ``)) {
      throw new HttpError(answer.status === 429 ? 429 : 502)
    }
    return new Response(answer.bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        "content-type": answer.type!,
        "x-content-type-options": `nosniff`,
        ...(answer.cacheControl ? { "cache-control": answer.cacheControl } : {}),
      },
    })
  },
})
