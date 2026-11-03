import { HttpError } from "fresh"
import { serveFile } from "@std/http/file-server"
import { fromFileUrl } from "@std/path"
import { define } from "../../../utils.ts"

/**
 * `libs/server/blog/seed-posts/covers/`, seen from where this module runs: the source
 * (`routes/blog/covers/`) and the build (`_fresh/server/assets/`) sit at the same depth.
 */
const COVERS = new URL(`../../../../../libs/server/blog/seed-posts/covers/`, import.meta.url)

/** A cover file's name, in both widths: `<slug>.webp` and `<slug>-640.webp`. */
const COVER_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/

/**
 * The files this route serves, read once at start; any other name is a 404, so no request reaches
 * a path the folder does not hold. A missing folder stops the server, as a missing video does.
 */
export const COVER_FILES: ReadonlySet<string> = new Set(
  [...Deno.readDirSync(COVERS)].filter((entry) => entry.isFile && COVER_FILE.test(entry.name))
    .map((entry) => entry.name),
)

/**
 * A month in caches, then a check against the file's ETag: covers rarely change, and a redrawn
 * one reaches visitors within the month without a new name.
 */
const CACHE_CONTROL = `public, max-age=2592000, must-revalidate`

/** The covers of Seed's own posts (`apps/mpa/blog-covers.ts`). */
export const handler = define.handlers({
  async GET(ctx) {
    const name = ctx.params.file
    if (!COVER_FILES.has(name)) throw new HttpError(404)
    const response = await serveFile(ctx.req, fromFileUrl(new URL(name, COVERS)))
    response.headers.set(`cache-control`, CACHE_CONTROL)
    return response
  },
})
