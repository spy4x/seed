/// <reference lib="deno.ns" />
/**
 * Holds `minimumDependencyAge.exclude` in `deno.jsonc` to the @spy4x packages in `deno.lock`. The
 * Deno CLI honours the `jsr:@spy4x/*` glob, but `@deno/loader` 0.5.0, which the Vite dev servers
 * resolve through, matches exact names only. A package missing by name cannot load in the SPA or
 * the admin panel for a day after each release, with no hint of why.
 */

import { expect } from "@std/expect"
import { parse } from "@std/jsonc"
import { fromFileUrl } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Each @spy4x package in a `deno.lock`, as `jsr:@spy4x/time` or `npm:@jsr/spy4x__time`. */
export function lockedSpy4xPackages(lock: string): string[] {
  const { jsr = {}, npm = {} } = JSON.parse(lock) as {
    jsr?: Record<string, unknown>
    npm?: Record<string, unknown>
  }
  const names = (section: Record<string, unknown>, scope: string, prefix: string) =>
    Object.keys(section)
      .filter((key) => key.startsWith(scope))
      .map((key) => `${prefix}${key.slice(0, key.indexOf(`@`, 1))}`)
  return [...new Set([...names(jsr, `@spy4x/`, `jsr:`), ...names(npm, `@jsr/spy4x__`, `npm:`)])]
    .sort()
}

/** The `minimumDependencyAge.exclude` list of a `deno.jsonc`. */
export function ageExclude(jsonc: string): string[] {
  const config = parse(jsonc) as { minimumDependencyAge?: { exclude?: unknown } }
  const exclude = config.minimumDependencyAge?.exclude
  if (!Array.isArray(exclude)) throw new Error(`deno.jsonc has no minimumDependencyAge.exclude`)
  return exclude.map(String)
}

/** Locked @spy4x packages that `exclude` does not name exactly. */
export function missingFromExclude(lock: string, jsonc: string): string[] {
  const exclude = ageExclude(jsonc)
  return lockedSpy4xPackages(lock).filter((name) => !exclude.includes(name))
}

const config = (exclude: string[]) =>
  JSON.stringify({ minimumDependencyAge: { age: `1440`, exclude } })
const lock = JSON.stringify({
  jsr: { "@spy4x/time@1.95.0": {}, "@spy4x/time@1.125.0": {}, "@std/path@1.1.6": {} },
  npm: {
    "@jsr/spy4x__time@1.125.0": {},
    // A peer dependency after the version: the name still ends at its own version.
    "@jsr/spy4x__time@1.125.0_preact@10.27.0": {},
    "preact@10.27.0": {},
  },
})

Deno.test(`the age exclude names every @spy4x package in deno.lock exactly`, async () => {
  const missing = missingFromExclude(
    await Deno.readTextFile(`${ROOT}deno.lock`),
    await Deno.readTextFile(`${ROOT}deno.jsonc`),
  )
  expect(missing).toEqual([])
})

Deno.test(`a locked @spy4x package listed by exact name in both forms is not missing`, () => {
  expect(missingFromExclude(lock, config([`jsr:@spy4x/time`, `npm:@jsr/spy4x__time`])))
    .toEqual([])
})

Deno.test(`a jsr @spy4x package covered only by the glob is reported missing`, () => {
  expect(missingFromExclude(lock, config([`jsr:@spy4x/*`, `npm:@jsr/spy4x__time`])))
    .toEqual([`jsr:@spy4x/time`])
})

Deno.test(`an npm @spy4x package covered only by the glob is reported missing`, () => {
  expect(missingFromExclude(lock, config([`jsr:@spy4x/time`, `npm:@jsr/spy4x__*`])))
    .toEqual([`npm:@jsr/spy4x__time`])
})

Deno.test(`a lock without @spy4x packages needs no exclude entry`, () => {
  const other = JSON.stringify({ jsr: { "@std/path@1.1.6": {} }, npm: { "preact@10.27.0": {} } })
  expect(missingFromExclude(other, config([]))).toEqual([])
})

Deno.test(`a deno.jsonc without an age exclude list fails loudly`, () => {
  expect(() => missingFromExclude(lock, `{}`)).toThrow(`no minimumDependencyAge.exclude`)
})
