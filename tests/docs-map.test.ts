/// <reference lib="deno.ns" />
/**
 * Holds `docs/README.md`, the docs map, to the files under `docs/`: every Markdown file there is
 * linked from the map, and every Markdown file the map links to exists. An agent reads the map to
 * find the doc for its task, so a doc missing from it is a doc nobody finds.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs"
import { fromFileUrl, relative } from "@std/path"

const DOCS = fromFileUrl(new URL(`../docs`, import.meta.url))
const MAP = `README.md`

/** Every Markdown file under `docs/`, as a path relative to it, the map itself left out. */
async function docFiles(): Promise<string[]> {
  const files: string[] = []
  for await (const entry of walk(DOCS, { exts: [`.md`], includeDirs: false })) {
    const path = relative(DOCS, entry.path).replaceAll(`\\`, `/`)
    if (path !== MAP) files.push(path)
  }
  return files.sort()
}

/** The Markdown files the map links to, relative to `docs/`, anchors dropped. */
async function mapLinks(): Promise<Set<string>> {
  const text = await Deno.readTextFile(`${DOCS}/${MAP}`)
  const links = [...text.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)].map((match) =>
    match[1].replace(/^\.\//, ``)
  )
  return new Set(links.filter((link) => !link.startsWith(`../`) && !link.includes(`://`)))
}

Deno.test(`docs map: links every Markdown file under docs/`, async () => {
  const links = await mapLinks()
  const missing = (await docFiles()).filter((file) => !links.has(file))
  expect(missing).toEqual([])
})

Deno.test(`docs map: every Markdown file it links to exists`, async () => {
  const files = new Set(await docFiles())
  const dead = [...await mapLinks()].filter((link) => !files.has(link))
  expect(dead).toEqual([])
})
