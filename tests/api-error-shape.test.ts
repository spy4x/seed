/// <reference lib="deno.ns" />
/**
 * Every error the API answers has one body, `{ error: { code, message, … } }`, built by
 * `errorResponse` (`apps/api/services/error-response.ts`, docs/api-errors.md). This test walks
 * `apps/api` and fails on a route that builds an error answer of its own: a `c.json` whose body
 * starts with an `error` key, or one sent with a 4xx or 5xx status. Tests and the test helpers may.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** The one file that may build an error body. */
const HELPER = `apps/api/services/error-response.ts`

/** The arguments of the call whose `(` is at `open`, split at their top-level commas. */
function argumentsAt(source: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ``
  for (let index = open; index < source.length; index++) {
    const char = source[index]
    if (quote) {
      current += char
      if (char === `\\`) current += source[++index] ?? ``
      else if (char === quote) quote = null
      continue
    }
    if (char === `"` || char === `'` || char === "`") quote = char
    if (char === `(` || char === `{` || char === `[`) depth++
    if (char === `)` || char === `}` || char === `]`) depth--
    if (depth === 0) break
    if (depth === 1 && char === `,`) {
      args.push(current)
      current = ``
    } else if (!(depth === 1 && char === `(` && index === open)) current += char
  }
  args.push(current)
  return args.map((arg) => arg.trim()).filter((arg) => arg !== ``)
}

/** The calls in a source that answer an error without `errorResponse`, as `line: call`. */
export function ownErrorAnswers(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/\bc\.json\(/g)) {
    const [body = ``, status = ``] = argumentsAt(source, match.index + match[0].length - 1)
    if (/^\{\s*error\b/.test(body) || /^[45]\d\d\b/.test(status)) {
      const line = source.slice(0, match.index).split(`\n`).length
      found.push(`${line}: c.json(${body.split(`\n`)[0]}`)
    }
  }
  return found
}

Deno.test(`ownErrorAnswers finds each error answer built by hand`, () => {
  expect(ownErrorAnswers(`a\nreturn c.json({ error: "Nope" }, 400)`)).toEqual([
    `2: c.json({ error: "Nope" }`,
  ])
  expect(ownErrorAnswers(`c.json(\n  { error: { code: "x", message: "y" } },\n  403,\n)`))
    .toHaveLength(1)
  expect(ownErrorAnswers(`c.json({ state: \`invalid\` }, 400)`)).toHaveLength(1)
  expect(ownErrorAnswers(`c.json({ error }, status)`)).toHaveLength(1)
  expect(ownErrorAnswers(`c.json({ notes: [] })`)).toEqual([])
  expect(ownErrorAnswers(`c.json({ post }, 201)`)).toEqual([])
  expect(ownErrorAnswers(`c.json(f(a, b), 200)`)).toEqual([])
})

Deno.test(`every API route answers an error with errorResponse`, async () => {
  const offenders: string[] = []
  let read = 0
  for await (const entry of walk(`${ROOT}apps/api`, { exts: [`.ts`], includeDirs: false })) {
    const path = relative(ROOT, entry.path)
    if (path === HELPER || path.endsWith(`.test.ts`) || path.includes(`/_testing/`)) continue
    read++
    for (const call of ownErrorAnswers(await Deno.readTextFile(entry.path))) {
      offenders.push(`${path}:${call}`)
    }
  }
  // A walk that found nothing would pass for the wrong reason.
  expect(read).toBeGreaterThan(50)
  expect(offenders).toEqual([])
})
