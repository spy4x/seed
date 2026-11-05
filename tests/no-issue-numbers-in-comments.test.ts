/// <reference lib="deno.ns" />
/// <reference lib="deno.unstable" />
/**
 * No comment under `apps/`, `libs/` or `e2e/` cites an issue as `(#123)`. Many such numbers named
 * issues of another repository, so an agent that followed one read an unrelated issue; the history
 * a citation points at is in git. A decision that still holds keeps its reason in words.
 *
 * TypeScript files are parsed (`Deno.lint.runPlugin`), so only their comments are checked: a test
 * name or a string may still hold a number. Other text files (SQL, HTML, Dockerfiles, JSON with
 * comments) are checked line by line, from the comment marker on. The migrations are left out:
 * they are applied history, and the migration runner checksums each file.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))
const DIRECTORIES = [`apps`, `libs`, `e2e`]
const CITATION = /\(#\d+\)/

/** Build output, dependencies, reports and the applied migrations, by name or exact path. */
const SKIPPED =
  /(^|\/)(node_modules|dist|\.vite|report|results|playwright-report)$|^libs\/server\/db\/migrations$/
const PARSED = /\.(ts|tsx|mts|js|jsx|mjs)$/
const LINE_CHECKED = /\.(sql|html|json|jsonc|txt|sh|yml|yaml|css|toml)$|(^|\/)dockerfile[^/]*$/i
/** Where a comment starts on a line of a non-TypeScript file. */
const COMMENT_START = /^\s*(#|--|\/\/|\*|<!--)|\s(--|\/\/)\s|<!--/

/** Every file under `directory` that is not skipped, as its path from the root. */
async function* files(directory: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(`${ROOT}${directory}`)) {
    const path = `${directory}/${entry.name}`
    if (SKIPPED.test(path)) continue
    if (entry.isDirectory) yield* files(path)
    else if (entry.isFile) yield path
  }
}

/** The comments of a TypeScript or JavaScript source, as `[line, text]`. */
function comments(path: string, source: string): [number, string][] {
  const found: [number, string][] = []
  const plugin: Deno.lint.Plugin = {
    name: `comments`,
    rules: {
      all: {
        create: (context) => ({
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const line = source.slice(0, comment.range[0]).split(`\n`).length
              found.push([line, comment.value])
            }
          },
        }),
      },
    },
  }
  Deno.lint.runPlugin(plugin, path, source)
  return found
}

/** `path:line: text` for every comment of `path` that cites an issue number. */
export function citationsIn(path: string, source: string): string[] {
  if (PARSED.test(path)) {
    return comments(path, source)
      .filter(([, text]) => CITATION.test(text))
      .map(([line, text]) => `${path}:${line}: ${text.match(CITATION)![0]}`)
  }
  return source.split(`\n`).flatMap((line, index) => {
    const start = line.search(COMMENT_START)
    const match = start === -1 ? null : line.slice(start).match(CITATION)
    return match ? [`${path}:${index + 1}: ${match[0]}`] : []
  })
}

Deno.test(`no comment under apps, libs or e2e cites an issue number`, async () => {
  const found: string[] = []
  let parsed = 0
  for (const directory of DIRECTORIES) {
    for await (const path of files(directory)) {
      if (!PARSED.test(path) && !LINE_CHECKED.test(path)) continue
      if (PARSED.test(path)) parsed++
      found.push(...citationsIn(path, await Deno.readTextFile(`${ROOT}${path}`)))
    }
  }
  // A wrong root or a too-greedy skip must not pass by reading nothing: over 1,100 sources today.
  expect(parsed).toBeGreaterThan(1100)
  expect(found).toEqual([])
})

Deno.test(`a citation counts in a comment and not in a string`, () => {
  expect(citationsIn(`a.ts`, `// keeps it (#12)\nit(\`keeps it (#12)\`, () => {})`)).toEqual([
    `a.ts:1: (#12)`,
  ])
  expect(citationsIn(`a.tsx`, `/**\n * A screen (#7).\n */\nconst a = <p>(#8)</p>`)).toEqual([
    `a.tsx:1: (#7)`,
  ])
  expect(citationsIn(`schema.sql`, `select 1; -- a lock (#3)\nselect '(#4)';`)).toEqual([
    `schema.sql:1: (#3)`,
  ])
  expect(citationsIn(`apps/api/dockerfile`, `# shows them (#429).\nRUN echo`)).toEqual([
    `apps/api/dockerfile:1: (#429)`,
  ])
})
