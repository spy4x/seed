import { HttpError } from "fresh"
import { serveFile } from "@std/http/file-server"
import { fromFileUrl } from "@std/path"
import { LOOP_FILES } from "../../loops.ts"
import { define } from "../../utils.ts"

/**
 * The first of `paths` that is a folder, seen from where this module runs: the source
 * (`routes/video/`), or the build, which bundles it into `_fresh/server/assets/`.
 */
function folder(paths: readonly string[], name: string): URL {
  const found = paths.map((path) => new URL(path, import.meta.url)).find((url) => {
    try {
      return Deno.statSync(url).isDirectory
    } catch {
      return false
    }
  })
  if (!found) throw new Error(`${name} is missing`)
  return found
}

/** `apps/mpa/media/video/`: the admin panel video and the feature loops. */
const SITE = folder([`../../media/video/`, `../../../media/video/`], `apps/mpa/media/video/`)

/**
 * `media/demo/` at the repository root: the README's demo video, which the home page plays too.
 * Its one copy stays there (`.dockerignore` lets in only its two files).
 */
const DEMO = folder([`../../../../media/demo/`, `../../../../../media/demo/`], `media/demo/`)

/** The files this route serves, by name, and their folder; any other name is a 404. */
export const VIDEO_FILES: Readonly<Record<string, URL>> = Object.fromEntries([
  ...[`admin-panel.webm`, `admin-panel.mp4`, ...LOOP_FILES].map((name) => [name, SITE]),
  ...[`demo.webm`, `demo.mp4`].map((name) => [name, DEMO]),
])

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
    const dir = Object.hasOwn(VIDEO_FILES, name) ? VIDEO_FILES[name] : undefined
    if (!dir) throw new HttpError(404)
    const response = await serveFile(ctx.req, fromFileUrl(new URL(name, dir)))
    response.headers.set(`cache-control`, CACHE_CONTROL)
    return response
  },
})
