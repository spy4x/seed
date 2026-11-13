/// <reference lib="deno.ns" />
/**
 * Seed's tests run on a plan catalog of their own (`libs/domain/billing/test-plans.ts`), so a
 * product edits `PLANS` and keeps every test passing. That catalog must never reach a running app:
 * only a test file may import it.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs/walk"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

Deno.test("no file but a test imports the test plan catalog", async () => {
  const importers: string[] = []
  let read = 0
  for (const directory of ["apps", "libs"]) {
    for await (const entry of walk(`${ROOT}${directory}`, { exts: [".ts", ".tsx"] })) {
      read++
      const path = relative(ROOT, entry.path)
      if (/\.test\.tsx?$/.test(path)) continue
      if (/test-plans\.ts["']/.test(await Deno.readTextFile(entry.path))) importers.push(path)
    }
  }
  // An empty walk would pass silently.
  expect(read).toBeGreaterThan(100)
  expect(importers).toEqual([])
})
