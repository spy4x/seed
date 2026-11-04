import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { fromFileUrl } from "@std/path"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { readSeedPosts } from "@server/blog/seed-posts.ts"

const read = (file: string) => Deno.readTextFile(fromFileUrl(new URL(file, import.meta.url)))
const fixtures = () =>
  readSeedPosts(denoFileSystem, fromFileUrl(new URL(`./posts/`, import.meta.url)))

describe(`the Lighthouse run's blog`, () => {
  it(`measures a published fixture post with a heading, a code block, a table and a link`, async () => {
    const posts = await fixtures()
    const measured = (JSON.parse(await read(`./lighthouserc.json`)).ci.collect.url as string[])
      .map((url) => new URL(url).pathname)
      .filter((path) => path.startsWith(`/blog/`))
    expect(measured).toHaveLength(1)
    expect(measured).toEqual(posts.map((post) => `/blog/${post.fields.slug}`))
    for (const post of posts) {
      expect(post.publishAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(post.fields.bodyMd).toMatch(/^## /m)
      expect(post.fields.bodyMd).toMatch(/^```/m)
      expect(post.fields.bodyMd).toMatch(/^\| .+ \|$/m)
      expect(post.fields.bodyMd).toMatch(/\]\(https:\/\//)
    }
  })

  it(`lets the blog API read only its fixture folder, never Seed's posts`, async () => {
    const script = await read(`./run.sh`)
    expect(script).toContain(`--allow-read="$HERE/posts" "$HERE/blog-api.ts"`)
    expect(script).not.toContain(`seed-posts`)
    expect(await read(`./blog-api.ts`)).toContain(
      `readSeedPosts(denoFileSystem, FIXTURE_POSTS_DIR)`,
    )
  })
})
