import { expect } from "@std/expect"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { readSeedPosts } from "@server/blog/seed-posts.ts"
import { featurePage } from "./features-data.tsx"

Deno.test("every Seed post's related feature is a page at /features/<slug> (#733)", async () => {
  const posts = await readSeedPosts(denoFileSystem)
  const unknown = posts
    .filter(({ fields }) => fields.relatedFeature !== null && !featurePage(fields.relatedFeature))
    .map(({ file, fields }) => `${file}: ${fields.relatedFeature}`)
  expect(unknown).toEqual([])
  // A test that finds no post proves nothing.
  expect(posts.some(({ fields }) => fields.relatedFeature !== null)).toBe(true)
})
