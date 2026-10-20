import { HttpError } from "fresh"
import { serveFile } from "@std/http/file-server"
import { fromFileUrl } from "@std/path"
import { define } from "../../utils.ts"

/** The files this route serves, by name; any other name is a 404, so no path comes from the URL. */
export const VIDEO_FILES: readonly string[] = [`admin-panel.webm`, `admin-panel.mp4`]

/**
 * `apps/mpa/media/video/`, seen from where this module runs: the source (`routes/video/`), or the
 * build, which bundles it into `_fresh/server/assets/`. The Docker image keeps both folders.
 */
const DIR = [`../../media/video/`, `../../../media/video/`]
  .map((path) => new URL(path, import.meta.url))
  .find((url) => {
    try {
      return Deno.statSync(url).isDirectory
    } catch {
      return false
    }
  })
if (!DIR) throw new Error(`apps/mpa/media/video/ is missing`)

/**
 * A week in caches, then a check against the file's ETag, so a re-recorded video reaches visitors
 * within days without a new name.
 */
const CACHE_CONTROL = `public, max-age=604800, must-revalidate`

/**
 * The website's videos. Fresh's static files ignore `Range`, and Safari plays a video only from a
 * server that answers byte ranges with 206; `serveFile` does, with `ETag` and `If-None-Match`.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const name = ctx.params.file
    if (!VIDEO_FILES.includes(name)) throw new HttpError(404)
    const response = await serveFile(ctx.req, fromFileUrl(new URL(name, DIR!)))
    response.headers.set(`cache-control`, CACHE_CONTROL)
    return response
  },
})
