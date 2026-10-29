/**
 * Writes the lock of every translated catalog: for each namespace, one `<language>.lock` per
 * `<language>.ts`, as `stampLocks` from `@spy4x/platform/universal/i18n` makes it. Run it once
 * the translations match the English; `i18n.test.ts` then passes. `TRANSLATING.md` has the loop.
 *
 * ```bash
 * deno task i18n:stamp
 * ```
 *
 * @module
 */
import { type Catalog, stampLocks } from "@spy4x/platform/universal/i18n"

/** The namespaces: one folder each, `<namespace>/<language>.ts`. */
export const NAMESPACES = [`app`, `admin`, `site`, `mail`, `errors`] as const

/**
 * The catalog a module exports by default. A module that does not load, such as one with a missing
 * comma, or that exports no object, fails with the file's name and the fix, like the other catalog
 * checks, instead of a bare `SyntaxError`.
 */
export async function importCatalog(specifier: string, name: string): Promise<Catalog> {
  let catalog: unknown
  try {
    catalog = (await import(specifier)).default
  } catch (error) {
    throw new Error(
      `${name} does not load (${(error as Error).message}). Fix the file, usually a missing ` +
        `comma or quote, then run \`deno task test\` again.`,
    )
  }
  if (typeof catalog !== `object` || catalog === null || Array.isArray(catalog)) {
    throw new Error(
      `${name} exports no catalog. Start it with \`export default {\`, as \`en.ts\` does, then ` +
        `run \`deno task test\` again.`,
    )
  }
  return catalog as Catalog
}

/** The English catalog of the namespace folder at `dir`, and every translation in it. */
export async function readCatalogs(
  dir: URL,
): Promise<{ source: Catalog; languages: Record<string, Catalog> }> {
  const languages: Record<string, Catalog> = {}
  for await (const entry of Deno.readDir(dir)) {
    const language = entry.name.match(/^(.+)\.ts$/)?.[1]
    if (!entry.isFile || !language || language === `en`) continue
    languages[language] = await readCatalog(dir, entry.name)
  }
  const source = await readCatalog(dir, `en.ts`)
  return { source, languages }
}

/** One catalog module of the folder at `dir`, named `i18n/<namespace>/<file>` when it is broken. */
function readCatalog(dir: URL, file: string): Promise<Catalog> {
  const namespace = dir.pathname.split(`/`).filter(Boolean).at(-1)
  return importCatalog(new URL(file, dir).href, `i18n/${namespace}/${file}`)
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
