/// <reference lib="deno.ns" />
/**
 * Keeps the WebSocket module swappable (ADR 003). Only the composition root,
 * `apps/spa/src/modules.ts`, may import `apps/spa/src/realtime/`: a product that never wants the
 * socket deletes the folder and its lines there, and every store and view goes on working over
 * HTTP. Any other importer is a file that would break, so it fails this test.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))
const MODULE_ROOT = "apps/spa/src/realtime/"
const COMPOSITION_ROOT = "apps/spa/src/modules.ts"

/** Every static, dynamic or re-exporting import specifier of a source file. */
function specifiersOf(source: string): string[] {
  const found = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]([^"'`]+)["'`]/g)
  return [...found].map((match) => match[1])
}

/** SPA files, outside the module's folder, that import from it. */
async function filesImportingTheModule(): Promise<string[]> {
  const found: string[] = []
  const entries = walk(`${ROOT}apps/spa`, {
    includeDirs: false,
    exts: [".ts", ".tsx", ".js"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /[\\/]src[\\/]realtime[\\/]/],
  })
  for await (const entry of entries) {
    const file = relative(ROOT, entry.path)
    const folder = file.slice(0, file.lastIndexOf("/") + 1)
    const specifiers = specifiersOf(await Deno.readTextFile(entry.path))
    const imports = specifiers.some((specifier) =>
      specifier.startsWith(".") &&
      new URL(specifier, `file:///${folder}`).pathname.startsWith(`/${MODULE_ROOT}`)
    )
    if (imports) found.push(file)
  }
  return found.sort()
}

Deno.test("only the composition root imports the WebSocket module", async () => {
  const importers = await filesImportingTheModule()
  // An empty walk would pass silently, so the one allowed importer must be found.
  expect(importers).toContain(COMPOSITION_ROOT)
  expect(importers.filter((file) => file !== COMPOSITION_ROOT)).toEqual([])
})

Deno.test("the WebSocket module's folder holds the socket's code", async () => {
  // The guard above proves nothing once the folder is empty or moved.
  const source = await Deno.readTextFile(`${ROOT}${MODULE_ROOT}index.ts`)
  expect(source).toContain("ClientTransport")
})
