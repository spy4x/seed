import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "@spy4x/preact-server"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { readSeedPosts } from "@server/blog/seed-posts.ts"
import { CARDS, handler } from "./routes/blog/og/[file].ts"
import { ogCard } from "./blog-covers.ts"
import type { State } from "./utils.ts"

const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const serve = new App<State>().get("/blog/og/:file", handler.GET!).handler()
const get = (name: string) => serve(new Request(`https://www.example.com/blog/og/${name}`), info)

describe("the link-preview cards of Seed's posts (#733)", () => {
  it("has a card for every Seed post, at the address its page shares", async () => {
    const posts = await readSeedPosts(denoFileSystem)
    // A test that finds no post proves nothing.
    expect(posts.length).toBeGreaterThan(0)
    const missing = posts.filter(({ fields, coverFile }) => {
      const card = ogCard({ slug: fields.slug, coverFile })
      return card === null || !CARDS.names.has(card.src.replace(`/blog/og/`, ``))
    }).map(({ file }) => file)
    expect(missing).toEqual([])
  })

  it("serves a card as JPEG with a month in caches and an ETag", async () => {
    const response = await get(`welcome-to-the-seed-blog.jpg`)
    expect(response.status).toBe(200)
    expect(response.headers.get(`content-type`)).toBe(`image/jpeg`)
    expect(response.headers.get(`cache-control`)).toBe(`public, max-age=2592000, must-revalidate`)
    expect(response.headers.get(`etag`)).toBeTruthy()
    await response.body?.cancel()
  })

  it("answers 404 for a name it does not hold, and for one that climbs out of the folder", async () => {
    for (
      const name of [`no-such-post.jpg`, `welcome-to-the-seed-blog.png`, `..%2FREADME.md`]
    ) {
      const response = await get(name)
      expect(response.status).toBe(404)
      await response.body?.cancel()
    }
  })
})
