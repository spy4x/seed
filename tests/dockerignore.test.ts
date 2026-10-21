/// <reference lib="deno.ns" />
/**
 * Holds `.dockerignore` to one rule: nothing under `infra/envs` or `infra/configs` enters a build
 * context. On the server those folders hold the env file and the Web Push private key, and every
 * image copies its whole context (`COPY . .`), so a gap here bakes secrets into an image layer.
 */

import { expect } from "@std/expect"
import { fromFileUrl } from "@std/path"

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

Deno.test("keeps the demo video and its raw take out of every build context", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (const path of ["media/demo/demo.mp4", "media/demo/.take/take.mkv"]) {
    expect({ path, ignored: isIgnored(rules, path) }).toEqual({ path, ignored: true })
  }
})

Deno.test("still sends what the images need", async () => {
  const rules = await Deno.readTextFile(`${ROOT}.dockerignore`)
  for (
    const path of [
      "apps/api/index.ts",
      "libs/ui/frame.tsx",
      "infra/scripts/db-migrate.ts",
      "deno.lock",
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
