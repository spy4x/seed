/// <reference lib="deno.ns" />
/**
 * Holds `.dockerignore` to one rule: nothing under `infra/envs` or `infra/configs` enters a build
 * context. On the server those folders hold the env file and the Web Push private key, and every
 * image copies its whole context (`COPY . .`), so a gap here bakes secrets into an image layer.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"
import { DOC_SLUGS } from "../apps/mpa/docs-site.ts"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/**
 * One `.dockerignore` rule as a regular expression, following Docker's matcher rather than a
 * general glob: `**` crosses folders, `*` and `?` stay inside one, `[...]` negates only with `^`,
 * `\\` escapes the next character, and everything else (braces, `@(...)`, `!` in a set) is literal.
 * A leading `/` or `./` and a trailing `/` are dropped, as Docker does.
 */
export function dockerPattern(rule: string): RegExp {
  const pattern = rule.replace(/^\.?\/+/, "").replace(/\/+$/, "")
  let out = ""
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/"
      out += slash ? "(?:.*/)?" : ".*"
      i += slash ? 2 : 1
    } else if (char === "*") out += "[^/]*"
    else if (char === "?") out += "[^/]"
    else if (char === "\\" && i + 1 < pattern.length) out += escape(pattern[++i])
    else if (char === "[" && pattern.indexOf("]", i + 2) !== -1) {
      const end = pattern.indexOf("]", i + 2)
      const body = pattern.slice(i + 1, end)
      const negated = body.startsWith("^")
      out += `[${negated ? "^" : ""}${
        [...(negated ? body.slice(1) : body)].map((c) => (c === "-" ? c : escape(c))).join("")
      }]`
      i = end
    } else out += escape(char)
  }
  return new RegExp(`^${out}$`)
}

function escape(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\/!-]/g, "\\$&")
}

/**
 * Whether `.dockerignore` content keeps `path` out of the build context. The last matching rule
 * wins, `!` re-includes, and a rule that matches a folder also matches everything inside it.
 */
export function isIgnored(dockerignore: string, path: string): boolean {
  const parts = path.split("/")
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join("/"))
  let ignored = false
  for (const raw of dockerignore.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const negated = line.startsWith("!")
    const pattern = dockerPattern(negated ? line.slice(1).trim() : line)
    if (candidates.some((candidate) => pattern.test(candidate))) ignored = !negated
  }
  return ignored
}

Deno.test("keeps the server's env files and key files out of every build context", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const path of [
      "infra/envs/.env",
      "infra/envs/.env.prod",
      "infra/configs/vapid.json",
      "infra/configs/nested/secret.json",
      "apps/api/.env",
      "apps/spa/.env.local",
      "libs/server/.env",
    ]
  ) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: true })
  }
})

Deno.test("lets in the demo video the home page plays, and keeps its raw take and recipe out", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const [path, ignored] of [
      ["media/demo/demo.webm", false],
      ["media/demo/demo.mp4", false],
      ["media/demo/.take/take.mkv", true],
      ["media/demo/music.opus", true],
      ["media/demo/poster.webp", true],
      ["media/demo/recipe/record.ts", true],
    ] as const
  ) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored })
  }
})

Deno.test("deploys the demo video files the build context lets in", async () => {
  // The server builds the MPA image from what rsync copied; a file missing there is a 500 on `/`.
  const include = (await Deno.readTextFile(`${ROOT}infra/deploy/include.txt`)).split("\n")
  for (const path of ["media/", "media/demo/", "media/demo/demo.webm", "media/demo/demo.mp4"]) {
    expect({ path, deployed: include.includes(path) }).toEqual({ path, deployed: true })
  }
})

Deno.test("keeps the browser tests' folders out of every build context", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (const path of ["e2e/fixtures/users.ts", "e2e/results/trace.zip", "e2e/spa/page.ts"]) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: true })
  }
})

Deno.test("writes every exception as a path or a path/**, so BuildKit reads only those folders", async () => {
  // Any other wildcard in a `!` line makes BuildKit open every folder of the context to match
  // it, and the server's `.volumes/` holds folders the deploy user may not read.
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  const exceptions = rules.split("\n").map((line) => line.trim()).filter((line) =>
    line.startsWith("!")
  )
  expect(exceptions.filter((line) => !/^![^*?[\\]+(\/\*\*)?$/.test(line))).toEqual([])
})

Deno.test("still sends what the images need", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const path of [
      "apps/api/index.ts",
      "libs/ui/frame.tsx",
      "infra/scripts/db-migrate.ts",
      "deno.lock",
      "e2e/plan-limits.e2e.ts",
    ]
  ) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: false })
  }
})

Deno.test("reads a rule the way Docker does, not as a general glob", () => {
  const cases: [rule: string, path: string, ignored: boolean][] = [
    ["infra/{envs,configs}", "infra/envs/.env", false],
    ["infra/@(envs|configs)", "infra/envs/.env", false],
    ["infra/[!x]nvs", "infra/envs/.env", false],
    ["infra/[^x]nvs", "infra/envs/.env", true],
    ["infra/[d-f]nvs", "infra/envs/.env", true],
    ["/infra/envs", "infra/envs/.env", true],
    ["./infra/envs", "infra/envs/.env", true],
    ["infra/envs/", "infra/envs/.env", true],
    ["infra/e?vs", "infra/envs/.env", true],
    ["infra/*", "infra/envs/.env", true],
    ["*/.env", "infra/envs/.env", false],
    ["**/.env", "infra/envs/.env", true],
    ["infra\\/envs", "infra/envs/.env", true],
    ["infra/envs\n! infra/envs/.env", "infra/envs/.env", false],
    ["**/.env", ".env", true],
  ]
  for (const [rule, path, ignored] of cases) {
    expect({ rule, ignored: isIgnored(rule, path) }).toEqual({ rule, ignored })
  }
})

Deno.test("deploys every folder the image builds from", async () => {
  // A folder the build context lets in but rsync never copies breaks the build on the server only.
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  const include = (await Deno.readTextFile(`${ROOT}infra/deploy/include.txt`)).split("\n")
  const folders = [...rules.matchAll(/^!([\w-]+)\/\*\*$/gm)].map((match) => match[1])
  expect(folders.length).toBeGreaterThan(0)
  for (const folder of folders) {
    // `<folder>/*/**` after it lets in only the folder's own files, which rsync copies by name.
    const topOnly = rules.split("\n").includes(`${folder}/*/**`)
    const deployed = topOnly
      ? include.includes(`${folder}/`) && include.some((line) => line.startsWith(`${folder}/*`))
      : include.includes(`${folder}/***`)
    expect({ folder, deployed }).toEqual({ folder, deployed: true })
  }
})

Deno.test("sends exactly the published guides of docs/, and deploys each one", async () => {
  // The website renders these (PUBLISHED_DOCS); the internal docs, such as the handoff, stay out.
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  const include = (await Deno.readTextFile(`${ROOT}infra/deploy/include.txt`)).split("\n")
  const sent = [...rules.matchAll(/^!docs\/(.+)$/gm)].map((match) => match[1]).sort()
  expect(sent).toEqual([...DOC_SLUGS.map((slug) => `${slug}.md`), "token-api.md"].sort())
  for (const slug of DOC_SLUGS) {
    const path = `docs/${slug}.md`
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: false })
    expect({ path, deployed: include.includes(path) }).toEqual({ path, deployed: true })
  }
  for (const path of ["docs/handoff.md", "docs/design/ui-layout.md", "docs/README.md"]) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: true })
  }
})

Deno.test("lets the changelog the build reads into the build context", async () => {
  // `deno task changelog` writes it before the build; it is gitignored, not dockerignored.
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  expect(isIgnored(rules, "apps/mpa/changelog.json")).toBe(false)
})
