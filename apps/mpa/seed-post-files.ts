import { HttpError } from "@spy4x/preact-server"
import { runtimeFileSystem } from "@spy4x/platform/server/runtime-fs"
import { serveFile } from "@spy4x/server/static"
import { fromFileUrl } from "@std/path"

/**
 * Pictures kept next to Seed's own posts (`libs/server/blog/seed-posts/<folder>/`), which the
 * website serves itself: the covers and the link-preview cards.
 *
 * @module
 */

/** A file name this module serves: a slug (a cover's `-640` or `-960` too), then the extension. */
const FILE_NAME = (extension: string) => new RegExp(`^[a-z0-9]+(?:-[a-z0-9]+)*\\.${extension}$`)

/**
 * A month in caches, then a check against the file's ETag: these pictures rarely change, and a
 * redrawn one reaches visitors within the month without a new name.
 */
const CACHE_CONTROL = `public, max-age=2592000, must-revalidate`

/** One folder's files and how to answer a request for one. */
export interface SeedPostFiles {
  /** The names it serves, read once at start. */
  names: ReadonlySet<string>
  /** The file `name` with its type and caching, or a 404 for a name the folder does not hold. */
  serve(request: Request, name: string): Promise<Response>
}

/**
 * The files with `extension` in `libs/server/blog/seed-posts/<folder>/`. `root` is that folder's
 * parent seen from the calling route, which must sit at the same depth in the source and the build.
 * Any other name is a 404, so no request reaches a path the folder does not hold; a missing folder
 * stops the server, as a missing video does.
 */
export async function seedPostFiles(folder: URL, extension: string): Promise<SeedPostFiles> {
  const path = fromFileUrl(folder)
  if (!await runtimeFileSystem.exists(path)) throw new Error(`${path} is missing`)
  const pattern = FILE_NAME(extension)
  const names = new Set(
    (await runtimeFileSystem.readDir(path))
      .filter((entry) => entry.isFile && pattern.test(entry.name))
      .map((entry) => entry.name),
  )
  return {
    names,
    async serve(request, name) {
      if (!names.has(name)) throw new HttpError(404)
      const path = fromFileUrl(new URL(name, folder))
      const response = await serveFile(request, path, { cacheControl: CACHE_CONTROL })
      if (!response) throw new HttpError(404)
      return response
    },
  }
}
