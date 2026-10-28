/// <reference lib="deno.ns" />
/**
 * Holds every catalog to its English source (#216): a missing, extra, empty, stale or malformed
 * translation fails with a message that ends in the command that fixes it, and an English key no
 * code names fails too. The failure list is the translator's work list (`TRANSLATING.md`).
 */
import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { checkCatalogs, findUnusedKeys } from "@spy4x/platform/universal/i18n"
import { LANGUAGES } from "@domain/identity"
import { NAMESPACES, parseCatalog, readCatalogs } from "./stamp.ts"

const root = new URL(`../`, import.meta.url)

/** Every non-test source file of the apps and the libraries, where a key is named. */
async function sourceTexts(): Promise<string[]> {
  const texts: string[] = []
  for (const folder of [`apps`, `libs`]) {
    for await (
      const entry of walk(new URL(folder, root), {
        exts: [`.ts`, `.tsx`],
        includeDirs: false,
        skip: [/\/(node_modules|dist|build|_fresh|\.vite)\//, /\.test\.tsx?$/],
      })
    ) texts.push(await Deno.readTextFile(entry.path))
  }
  // An empty walk would find every key unused, and a wrong root would pass nothing: require both.
  if (texts.length < 100) throw new Error(`The walk of apps and libs found ${texts.length} files.`)
  return texts
}

for (const namespace of NAMESPACES) {
  const dir = new URL(`${namespace}/`, import.meta.url)

  Deno.test(`i18n ${namespace}: every language translates every English key, in step with its lock`, async () => {
    const { source, languages } = await readCatalogs(dir)
    const locks: Record<string, string> = {}
    for (const language of Object.keys(languages)) {
      locks[language] = await Deno.readTextFile(new URL(`${language}.lock`, dir)).catch(() => ``)
    }
    const problems = await checkCatalogs({ source, languages, locks })
    expect(problems.map((problem) => problem.message)).toEqual([])
  })

  Deno.test(`i18n ${namespace}: ships exactly the languages the apps offer`, async () => {
    const { languages } = await readCatalogs(dir)
    expect([`en`, ...Object.keys(languages)].sort()).toEqual([...LANGUAGES].sort())
  })
}

Deno.test(`i18n: every English key is named somewhere in the code`, async () => {
  const texts = await sourceTexts()
  const unused: string[] = []
  // `errors` is keyed by the API's error codes, which a screen reads at run time.
  for (const namespace of NAMESPACES.filter((name) => name !== `errors`)) {
    const { source } = await readCatalogs(new URL(`${namespace}/`, import.meta.url))
    unused.push(...findUnusedKeys(source, texts).map((key) => `${namespace}: ${key}`))
  }
  expect(unused).toEqual([])
})

Deno.test(`i18n: a catalog that is not JSON is named, with the fix`, () => {
  expect(parseCatalog(`{ "Frame.notes": "Notizen" }`, `i18n/app/de.json`))
    .toEqual({ "Frame.notes": `Notizen` })
  expect(() => parseCatalog(`{ "Frame.notes": "Notizen", }`, `i18n/app/de.json`)).toThrow(
    /^i18n\/app\/de\.json is not valid JSON \(.+\)\. Fix the file.+`deno task test` again\.$/,
  )
})
