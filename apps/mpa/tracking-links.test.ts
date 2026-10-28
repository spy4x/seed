import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { handler as trackingLink } from "./routes/s/[code].ts"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const CODE = "AbCdEfGh_-1"
const UMAMI = `https://stats.example.com/q/${CODE}`
const ITEM = "https://www.example.com/shirts/linen?utm_source=zalo-a&utm_medium=share"

/** The website's `/s/:code` over a fake API that answers by path with its query. */
function site(answers: Record<string, () => Response>) {
  const asked: string[] = []
  const fetch = ((input: string | URL | Request) => {
    const url = new URL(new Request(input).url)
    asked.push(`${url.pathname}${url.search}`)
    const answer = answers[`${url.pathname}${url.search}`]
    return Promise.resolve(
      answer ? answer() : Response.json({ error: `Not found` }, { status: 404 }),
    )
  }) as typeof globalThis.fetch
  const handler = new App<State>()
    .use(pageMiddleware(config, fetch, () => false))
    .get("/s/:code", trackingLink.GET!)
    .handler()
  const get = (path: string) => handler(new Request(`${config.webAppOrigin}${path}`), info)
  return { get, asked }
}

describe("tracking links on the website", () => {
  it("answers 302 to where the API says, never cached", async () => {
    const { get, asked } = site({
      [`/api/catalog/links/${CODE}`]: () => Response.json({ location: UMAMI }),
    })
    const response = await get(`/s/${CODE}`)
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe(UMAMI)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(asked).toEqual([`/api/catalog/links/${CODE}`])
  })

  it("passes Umami's counted mark on, and nothing else from the address", async () => {
    const { get, asked } = site({
      [`/api/catalog/links/${CODE}?counted=1`]: () => Response.json({ location: ITEM }),
    })
    const response = await get(`/s/${CODE}?counted=1&next=https://evil.example`)
    expect(response.headers.get("location")).toBe(ITEM)
    expect(asked).toEqual([`/api/catalog/links/${CODE}?counted=1`])
  })

  it("answers 404 for an unknown code, and for one of another shape without asking", async () => {
    const { get, asked } = site({})
    expect((await get("/s/ZZZZZZZZZZZ")).status).toBe(404)
    expect((await get(`/s/${encodeURIComponent("//evil.example")}`)).status).toBe(404)
    expect((await get("/s/short")).status).toBe(404)
    expect(asked).toEqual(["/api/catalog/links/ZZZZZZZZZZZ"])
  })

  it("redirects nowhere when the API's answer is not a web address", async () => {
    const { get } = site({
      [`/api/catalog/links/${CODE}`]: () => Response.json({ location: "javascript:alert(1)" }),
    })
    const response = await get(`/s/${CODE}`)
    expect(response.status).toBe(502)
    expect(response.headers.get("location")).toBeNull()
  })
})
