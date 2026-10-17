/// <reference lib="deno.ns" />
/**
 * Every date and time the apps and `libs/ui` show goes through the one formatter (#163): ts-libs
 * `createFormatters` (`@spy4x/time/format`), handed to the screens by preact-components'
 * `FormatContext` (`@spy4x/preact-ui/format`). It follows the person's region format, time zone and
 * clock. A direct `toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()` or
 * `new Intl.DateTimeFormat` ignores them and shows the device's instead. This test walks `apps/`
 * and `libs/ui/` and fails on any of those calls. Tests may call them, to work out what a screen
 * should show.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** The calls that format a date or a time on their own (`toLocaleString()` too, on any value). */
export const FORBIDDEN = /\.toLocale(?:Date|Time)?String\s*\(|\bIntl\.DateTimeFormat\s*\(/

/** Built or installed code, which no person writes. */
const SKIPPED = [/[\\/]node_modules[\\/]/, /[\\/]dist[\\/]/, /[\\/]_fresh[\\/]/, /[\\/]\.vite[\\/]/]

/** The lines of a source that format a date on their own, as `line: text`. */
export function directCalls(source: string): string[] {
  return source.split(`\n`).flatMap((line, index) =>
    FORBIDDEN.test(line) && !line.trimStart().startsWith(`*`) && !line.trimStart().startsWith(`//`)
      ? [`${index + 1}: ${line.trim()}`]
      : []
  )
}

Deno.test(`directCalls finds each call that bypasses the formatter`, () => {
  expect(directCalls(`a\nconst s = d.toLocaleDateString("en")`)).toEqual([
    `2: const s = d.toLocaleDateString("en")`,
  ])
  expect(directCalls(`n.toLocaleString()`)).toHaveLength(1)
  expect(directCalls(`d.toLocaleTimeString([], {})`)).toHaveLength(1)
  expect(directCalls(`new Intl.DateTimeFormat(locale)`)).toHaveLength(1)
  expect(directCalls(` * \`new Intl.DateTimeFormat\` is not allowed`)).toEqual([])
  expect(directCalls(`format.date(at)`)).toEqual([])
})

Deno.test(`no screen formats a date or a time on its own`, async () => {
  const seen: string[] = []
  const found: string[] = []
  for (const directory of [`apps`, `libs/ui`]) {
    for await (
      const entry of walk(`${ROOT}${directory}`, { exts: [`.ts`, `.tsx`], skip: SKIPPED })
    ) {
      if (!entry.isFile) continue
      const path = relative(ROOT, entry.path).replaceAll(`\\`, `/`)
      seen.push(path)
      if (/\.test\.tsx?$/.test(path)) continue
      for (const call of directCalls(await Deno.readTextFile(entry.path))) {
        found.push(`${path}:${call}`)
      }
    }
  }
  // An empty walk would pass silently, so require files the apps cannot lose.
  expect(seen).toContain(`apps/spa/src/app.tsx`)
  expect(seen).toContain(`libs/ui/notes-screen.tsx`)
  expect(found).toEqual([])
})
