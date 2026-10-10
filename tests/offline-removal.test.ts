/// <reference lib="deno.ns" />
/**
 * Keeps `docs/offline.md`'s removal steps true. A product deletes the offline layer by following
 * them, so every file outside `apps/spa/src/offline/` that imports the folder must be named there,
 * and so must every file that imports the shared offline-shell cache into the service worker.
 * Only the composition root, `apps/spa/src/modules.ts`, may import the folder (ADR 003).
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

const MODULE_ROOT = "apps/spa/src/offline/"
const SHELL_CACHE = "@spy4x/platform/browser/offline-shell"

/** Every specifier a source file imports: `from "…"`, `import "…"`, `import("…")`, `export … from`. */
function specifiersOf(source: string): string[] {
  const found = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'`]([^"'`]+)["'`]/g)
  return [...found].map((match) => match[1])
}

/** SPA files outside the offline folder, each with whether it imports the folder or the cache. */
async function spaFiles(): Promise<{ file: string; folder: boolean; shell: boolean }[]> {
  const found: { file: string; folder: boolean; shell: boolean }[] = []
  const entries = walk(`${ROOT}apps/spa`, {
    includeDirs: false,
    exts: [".ts", ".tsx", ".js"],
    skip: [/[\\/](node_modules|dist)[\\/]/, /[\\/]src[\\/]offline[\\/]/],
  })
  for await (const entry of entries) {
    const file = relative(ROOT, entry.path)
    const from = file.slice(0, file.lastIndexOf("/") + 1)
    const specifiers = specifiersOf(await Deno.readTextFile(entry.path))
    found.push({
      file,
      folder: specifiers.some((specifier) =>
        specifier.startsWith(".") &&
        new URL(specifier, `file:///${from}`).pathname.startsWith(`/${MODULE_ROOT}`)
      ),
      shell: specifiers.some((specifier) => specifier.startsWith(SHELL_CACHE)),
    })
  }
  return found.sort((a, b) => a.file.localeCompare(b.file))
}

Deno.test("docs/offline.md names every file that uses the offline layer", async () => {
  const docs = await Deno.readTextFile(`${ROOT}docs/offline.md`)
  const removal = docs.slice(docs.indexOf("## Removing the layer"))
  const users = (await spaFiles()).filter((entry) => entry.folder || entry.shell)
    .map((entry) => entry.file)
  // An empty walk would pass silently, so require the files the layer cannot lose.
  expect(users).toContain("apps/spa/src/modules.ts")
  expect(users).toContain("apps/spa/src/sw.ts")
  const unnamed = users.filter((file) => !removal.includes(`\`${file}\``))
  expect(unnamed).toEqual([])
})

Deno.test("only the composition root imports the offline folder", async () => {
  const importers = (await spaFiles()).filter((entry) => entry.folder).map((entry) => entry.file)
  expect(importers).toEqual(["apps/spa/src/modules.ts"])
})
