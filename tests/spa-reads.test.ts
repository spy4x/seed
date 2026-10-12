/// <reference lib="deno.ns" />
/**
 * Keeps every REST request of the SPA, read or write, bound to the user the page was started for
 * (ADR 003). The SPA has one REST function, `apiFetch` in `apps/spa/src/state/api.ts`, and it sends
 * every request through `apiAsUser`, which names the user and signs the page out on
 * `unauthorized`. A store or view that calls an `/api` route any other way (the library's
 * `apiFetch`, or the browser's `fetch`) skips both, so it fails this test.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))
const SPA_SOURCE = "apps/spa/src/"
const LIBRARY = "@spy4x/platform/api"
/** The two files that are the one way: the wrapper, and the bound request it sends every call through. */
const THE_ONE_WAY = ["apps/spa/src/state/api.ts", "apps/spa/src/state/realtime-call.ts"]
/**
 * Files that may call the browser's `fetch`: the newsletter's routes are public and have no
 * session, so there is no user to name.
 */
const PUBLIC_REQUESTS = ["apps/spa/src/state/subscribers.ts"]

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

Deno.test("the SPA's one REST function sends every request, read or write, through apiAsUser", async () => {
  const wrapper = await Deno.readTextFile(`${ROOT}${THE_ONE_WAY[0]}`)
  expect(wrapper).toMatch(/return\s+apiAsUser</)
  // The library's function is imported but never called: a branch that sends a write as it is
  // would name nobody.
  expect(wrapper).not.toMatch(/\bsend\s*(<[^>]*>)?\s*\(/)
})

Deno.test("no SPA file reads or writes with the browser's fetch", async () => {
  const callers: string[] = []
  for (const [file, source] of await spaSources()) {
    for (const call of browserFetchCalls(source)) {
      // `fetch()` with no arguments is a method of a store's own port, not the browser's.
      if (call.trim() === "") continue
      if (!PUBLIC_REQUESTS.includes(file)) callers.push(file)
    }
  }
  expect(callers).toEqual([])
})

Deno.test("the scan finds a browser fetch that writes, and leaves a store's own request alone", () => {
  const source = "await fetch(`/api/x`, { method: `POST` })\nawait request(`/api/y`, {})"
  const calls = browserFetchCalls(source)
  expect(calls).toEqual(["`/api/x`, { method: `POST` }"])
})

Deno.test("the SPA draws every route from the route table", async () => {
  // `PAGES` in `app.tsx` is typed by the table, so the type check holds the two together. A
  // `<Route>` written by hand beside it would be a page the sign-in gate and the unsaved-changes
  // guard never heard of.
  const drawn = (await spaSources())
    .map(([file, source]) => [file, source.match(/<Route[\s/>](?!`)/g)?.length ?? 0])
    .filter(([, count]) => count !== 0)
  expect(drawn).toEqual([["apps/spa/src/app.tsx", 1]])
  const app = await Deno.readTextFile(`${ROOT}apps/spa/src/app.tsx`)
  expect(app).toMatch(/SPA_ROUTE_PATHS\.map\(\(path\) => \(\s*<Route key=\{path\} path=\{path\}>/)
})
