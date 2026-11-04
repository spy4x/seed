/// <reference lib="deno.ns" />
/**
 * Holds `Dockerfile.base` to the workspace in `deno.jsonc`: older Deno versions fail
 * `deno install` when a workspace member's `deno.json` is missing from the image, and the failure
 * names a path nowhere near the cause. Every member needs a `COPY <member>/deno.json` line.
 */

import { expect } from "@std/expect"
import { parse } from "@std/jsonc"
import { fromFileUrl } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Workspace members listed in `deno.jsonc`, as `apps/api` (no leading `./`). */
export function workspaceMembers(jsonc: string): string[] {
  const config = parse(jsonc) as { workspace?: unknown }
  if (!Array.isArray(config.workspace)) throw new Error("deno.jsonc has no workspace list")
  return config.workspace.map((member) => String(member).replace(/^\.\//, ""))
}

/** Source paths of the `COPY` lines that copy a `deno.json`, as `apps/api/deno.json`. */
export function copiedConfigs(dockerfile: string): string[] {
  return [...dockerfile.matchAll(/^COPY\s+(\S+\/deno\.jsonc?)\s/gm)].map((m) => m[1])
}

Deno.test("Dockerfile.base copies the deno.json of every workspace member", async () => {
  const members = workspaceMembers(await Deno.readTextFile(`${ROOT}deno.jsonc`))
  const copied = copiedConfigs(await Deno.readTextFile(`${ROOT}Dockerfile.base`))
  expect(members.length).toBeGreaterThan(0)
  const missing = members.filter((member) => !copied.includes(`${member}/deno.json`))
  expect(missing).toEqual([])
})

Deno.test("Dockerfile.base copies no config of a directory that is not a workspace member", async () => {
  const members = workspaceMembers(await Deno.readTextFile(`${ROOT}deno.jsonc`))
  const copied = copiedConfigs(await Deno.readTextFile(`${ROOT}Dockerfile.base`))
  const stray = copied.filter((path) => !members.includes(path.replace(/\/deno\.json$/, "")))
  expect(stray).toEqual([])
})

Deno.test("workspaceMembers reads members past comments, even bracketed ones, and skips commented-out ones", () => {
  const source = `{
    "workspace": [
      "./apps/api", // the API
      // "./apps/old",
      // [split later]
      "./libs/x"
    ],
    "tasks": {}
  }`
  expect(workspaceMembers(source)).toEqual(["apps/api", "libs/x"])
})

/** Whether a `COPY . .` comes before the first `deno install`, so every member's config is there. */
export function copiesContextBeforeInstall(dockerfile: string): boolean {
  const lines = dockerfile.split(/\r?\n/).map((line) => line.trim())
  const install = lines.findIndex((line) => /^RUN\s.*\bdeno\s+install\b/.test(line))
  const copy = lines.findIndex((line) => /^COPY\s+(--\S+\s+)*\.\s+\.$/.test(line))
  return install !== -1 && copy !== -1 && copy < install
}

Deno.test("the Node and Bun images copy the whole build context before deno install", async () => {
  // They list no member, so a new member cannot be missing from them as it can from Dockerfile.base.
  for (const path of ["apps/api/dockerfile.node", "apps/api/dockerfile.bun"]) {
    const dockerfile = await Deno.readTextFile(`${ROOT}${path}`)
    expect({ path, copied: copiesContextBeforeInstall(dockerfile) }).toEqual({ path, copied: true })
  }
})

Deno.test("copiesContextBeforeInstall wants the copy before the install, and both present", () => {
  expect(copiesContextBeforeInstall(`COPY . .\nRUN deno install --frozen`)).toBe(true)
  expect(copiesContextBeforeInstall(`RUN deno install --frozen\nCOPY . .`)).toBe(false)
  expect(copiesContextBeforeInstall(`COPY deno.jsonc ./\nRUN deno install --frozen`)).toBe(false)
  expect(copiesContextBeforeInstall(`COPY . .`)).toBe(false)
})
