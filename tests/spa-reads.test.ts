/// <reference lib="deno.ns" />
/**
 * Keeps every read of the SPA bound to the user the page was started for (ADR 003). The SPA has
 * one REST function, `apiFetch` in `apps/spa/src/state/api.ts`, and it sends every `GET` through
 * `apiRead`, which names the user and signs the page out on `unauthorized`. A store or view that
 * reads an `/api` route any other way (the library's `apiFetch`, or the browser's `fetch`) skips
 * both, so it fails this test.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))
const SPA_SOURCE = "apps/spa/src/"
const LIBRARY = "@spy4x/platform/api"
/** The two files that are the one way: the wrapper, and the read it sends a `GET` through. */
const THE_ONE_WAY = ["apps/spa/src/state/api.ts", "apps/spa/src/state/realtime-call.ts"]
/**
 * Files that may call the browser's `fetch` without a `method`: the newsletter's routes are public
 * and have no session, so there is no user to name.
 */
const PUBLIC_READS = ["apps/spa/src/state/subscribers.ts"]

/** Whether `source` imports a value, not only types, from the library's REST module. */
function importsTheLibraryFunction(source: string): boolean {
  const imports = source.matchAll(
    /\b(?:import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
  )
  return [...imports].some((match) => match[2] === LIBRARY && match[1] === undefined) ||
    /\bimport\s*\(\s*["'`]@spy4x\/platform\/api["'`]/.test(source)
}

/** The argument text of every call of the browser's own `fetch` in `source`. */
function browserFetchCalls(source: string): string[] {
  const calls: string[] = []
  for (const match of source.matchAll(/(?<![\w.$])(?:globalThis\.|window\.|self\.)?fetch\(/g)) {
    let depth = 1
    let end = match.index + match[0].length
    while (end < source.length && depth > 0) {
      if (source[end] === "(") depth++
      if (source[end] === ")") depth--
      end++
    }
    calls.push(source.slice(match.index + match[0].length, end - 1))
  }
  return calls
}

/** SPA source files, tests left out, with their text. */
async function spaSources(): Promise<[string, string][]> {
  const sources: [string, string][] = []
  const entries = walk(`${ROOT}${SPA_SOURCE}`, {
    includeDirs: false,
    exts: [".ts", ".tsx"],
    skip: [/\.test\.tsx?$/],
  })
  for await (const entry of entries) {
    sources.push([relative(ROOT, entry.path), await Deno.readTextFile(entry.path)])
  }
  return sources.sort(([a], [b]) => a.localeCompare(b))
}

Deno.test("only the SPA's one REST function uses the library's apiFetch", async () => {
  const users = (await spaSources())
    .filter(([, source]) => importsTheLibraryFunction(source))
    .map(([file]) => file)
  // Both must be found: an empty walk, or a moved wrapper, would otherwise pass silently.
  expect(users).toEqual(THE_ONE_WAY)
})

Deno.test("the SPA's one REST function sends a read through apiRead", async () => {
  const wrapper = await Deno.readTextFile(`${ROOT}${THE_ONE_WAY[0]}`)
  expect(wrapper).toMatch(/===\s*"GET"\s*\?\s*apiRead</)
})

/** A call whose options name a method other than `GET` in so many words. */
const LITERAL_WRITE = /\bmethod\s*:\s*["'`](?!GET["'`])[A-Z]+["'`]/
/** A file that sends its `GET` through one of the two bound reads and only the rest with `fetch`. */
const SPLITS_READS = /===\s*"GET"\s*\?\s*(?:await\s+)?(?:apiRead|fetchRead)\s*[<(]/

Deno.test("no SPA file reads with the browser's fetch", async () => {
  const readers: string[] = []
  let writers = 0
  for (const [file, source] of await spaSources()) {
    for (const call of browserFetchCalls(source)) {
      // `fetch()` with no arguments is a method of a store's own port, not the browser's.
      if (call.trim() === "") continue
      // A write says so in the call, or the file sends its reads another way in so many words.
      if (LITERAL_WRITE.test(call) || SPLITS_READS.test(source)) writers++
      else if (!PUBLIC_READS.includes(file)) readers.push(file)
    }
  }
  // The transfer and the invitation are writes sent with `fetch`: finding them proves the scan.
  expect(writers).toBeGreaterThanOrEqual(2)
  expect(readers).toEqual([])
})
