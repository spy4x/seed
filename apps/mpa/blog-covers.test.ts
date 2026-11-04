import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "@spy4x/preact-server"
import { COVERS, handler } from "./routes/blog/covers/[file].ts"
import { coverImage } from "./blog-covers.ts"
import type { State } from "./utils.ts"

const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const serve = new App<State>().get("/blog/covers/:file", handler.GET!).handler()
const get = (name: string) =>
  serve(new Request(`https://www.example.com/blog/covers/${name}`), info)

describe("the blog's cover files (#733)", () => {
  it("serves each cover as WebP with a month in caches and an ETag", async () => {
    const [name] = [...COVERS.names]
    expect(name).toBeDefined()
    const response = await get(name)
    expect(response.status).toBe(200)
    expect(response.headers.get(`content-type`)).toBe(`image/webp`)
    expect(response.headers.get(`cache-control`)).toBe(`public, max-age=2592000, must-revalidate`)
    expect(response.headers.get(`etag`)).toBeTruthy()
    await response.body?.cancel()
  })

  it("serves every width a post's srcset names, the 960 px copy among them", async () => {
    const coverFile = `welcome-to-the-seed-blog.webp`
    const srcset = coverImage({ coverFile, coverUrl: null })!.srcset!
    const names = srcset.split(`, `).map((entry) => entry.split(` `)[0].split(`/`).pop()!)
    expect(names).toEqual([
      `welcome-to-the-seed-blog-640.webp`,
      `welcome-to-the-seed-blog-960.webp`,
      coverFile,
    ])
    for (const name of names) {
      const response = await get(name)
      expect(response.status).toBe(200)
      await response.body?.cancel()
    }
  })

  it("answers 404 for a name it does not hold, and for one that climbs out of the folder", async () => {
    for (const name of [`no-such-post.webp`, `README.md`, `..%2F..%2Fseed-posts.ts`]) {
      const response = await get(name)
      expect(response.status).toBe(404)
      await response.body?.cancel()
    }
  })
})
