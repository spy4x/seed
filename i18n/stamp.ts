/**
 * Writes the lock of every translated catalog: for each namespace, one `<language>.lock` per
 * `<language>.json`, as `stampLocks` from `@spy4x/platform/universal/i18n` makes it. Run it once
 * the translations match the English; `i18n.test.ts` then passes. `TRANSLATING.md` has the loop.
 *
 * ```bash
 * deno task i18n:stamp
 * ```
 *
 * @module
 */
import { type Catalog, stampLocks } from "@spy4x/platform/universal/i18n"

/** The namespaces: one folder each, `<namespace>/<language>.json`. */
export const NAMESPACES = [`app`, `admin`, `site`, `mail`, `errors`] as const

/**
 * A catalog file's text as a catalog. Text that is not JSON fails with the file's name and the fix,
 * like the other catalog checks, instead of a bare `SyntaxError`.
 */
export function parseCatalog(text: string, name: string): Catalog {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${name} is not valid JSON (${(error as Error).message}). Fix the file, usually a missing ` +
        `comma or quote, then run \`deno task test\` again.`,
    )
  }
}

/** The English catalog of the namespace folder at `dir`, and every translation in it. */
export async function readCatalogs(
  dir: URL,
): Promise<{ source: Catalog; languages: Record<string, Catalog> }> {
  const languages: Record<string, Catalog> = {}
  for await (const entry of Deno.readDir(dir)) {
    const language = entry.name.match(/^(.+)\.json$/)?.[1]
    if (!entry.isFile || !language || language === `en`) continue
    languages[language] = await readCatalog(dir, entry.name)
  }
  const source = await readCatalog(dir, `en.json`)
  return { source, languages }
}

/** One catalog file of the folder at `dir`, named `i18n/<namespace>/<file>` when it is broken. */
async function readCatalog(dir: URL, file: string): Promise<Catalog> {
  const namespace = dir.pathname.split(`/`).filter(Boolean).at(-1)
  return parseCatalog(await Deno.readTextFile(new URL(file, dir)), `i18n/${namespace}/${file}`)
}

if (import.meta.main) {
  for (const namespace of NAMESPACES) {
    const dir = new URL(`${namespace}/`, import.meta.url)
    const { source, languages } = await readCatalogs(dir)
    const locks = await stampLocks(source, languages)
    for (const [language, lock] of Object.entries(locks)) {
      await Deno.writeTextFile(new URL(`${language}.lock`, dir), lock)
      console.log(`i18n/${namespace}/${language}.lock`)
    }
  }
}
