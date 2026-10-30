import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import AppWrapper from "./routes/_app.tsx"
import Home from "./routes/index.tsx"
import { contactLinksMiddleware, contactLinkText, readContactLinks } from "./contact-links.ts"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"
import type { PublicContactLink } from "@domain/contact-links"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

const LINKS = [
  { kind: "telegram", value: "my_shop", label: null },
  { kind: "zalo", value: "0912345678", label: "Order on Zalo" },
  { kind: "email", value: "hello@example.com", label: null },
]

/** The home page behind the website's middleware, over an API that answers `links`. */
async function home(links: unknown) {
  const fetch = ((input: string | URL | Request) => {
    const path = new URL(new Request(input).url).pathname
    return Promise.resolve(
      path === "/api/contact-links"
        ? Response.json({ links })
        : Response.json({ error: "Not found" }, { status: 404 }),
    )
  }) as typeof globalThis.fetch
  const handler = new App<State>()
    .use(pageMiddleware(config, fetch, () => false))
    .use(await contactLinksMiddleware(config, fetch))
    .appWrapper(view(AppWrapper))
    .route("/", { component: view(Home) })
    .handler()
  const response = await handler(new Request(`${config.webAppOrigin}/`), info)
  return await response.text()
}

function jsonLdGraph(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ]
  return scripts.flatMap((match) => JSON.parse(match[1])["@graph"])
}

/** The footer's "Contact" column: each link's text and address. */
function contactColumn(html: string): string[] {
  const footer = html.slice(html.lastIndexOf("<footer"))
  const column = footer.match(/>Contact<[\s\S]*?<\/ul>/)?.[0] ?? ""
  return [...column.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)</g)].map((m) => `${m[2]} ${m[1]}`)
}

describe("contact links on the website", () => {
  it("lists every link in the footer, in order, with its label or channel", async () => {
    expect(contactColumn(await home(LINKS))).toEqual([
      "Telegram @my_shop https://t.me/my_shop",
      "Order on Zalo https://zalo.me/0912345678",
      "hello@example.com mailto:hello@example.com",
    ])
  })

  it("names the organization with profiles in sameAs and numbers only as contact points", async () => {
    const organization = jsonLdGraph(await home(LINKS))
      .find((node) => node["@type"] === "Organization")
    expect(organization).toMatchObject({
      "@id": "https://www.example.com/#organization",
      sameAs: ["https://t.me/my_shop"],
      email: "hello@example.com",
    })
    expect(JSON.stringify(organization?.sameAs)).not.toContain("zalo")
  })

  it("names the organization as the site's publisher once it has links, else the person", async () => {
    const publisher = (graph: Record<string, unknown>[]) =>
      graph.find((node) => node["@type"] === "WebSite")?.publisher
    expect(publisher(jsonLdGraph(await home(LINKS))))
      .toEqual({ "@id": "https://www.example.com/#organization" })
    expect(publisher(jsonLdGraph(await home([])))).toEqual({
      "@id": "https://antonshubin.com/#person",
    })
  })

  it("draws no Contact column and no organization while there are no links", async () => {
    const html = await home([])
    expect(html.slice(html.lastIndexOf("<footer"))).not.toContain(">Contact<")
    expect(jsonLdGraph(html).map((node) => node["@type"])).not.toContain("Organization")
  })
})

describe("contactLinkText", () => {
  const text = (kind: string, value: string) =>
    contactLinkText({ kind, value, label: null } as PublicContactLink)

  it("writes a handle as the channel and @handle, with one @", () => {
    expect(text("telegram", "vishop_hn")).toBe("Telegram @vishop_hn")
    expect(text("instagram", "my.shop")).toBe("Instagram @my.shop")
  })

  it("keeps the channel, a colon and the value for a messenger number or a page", () => {
    expect(text("zalo", "0912345678")).toBe("Zalo: 0912345678")
    expect(text("whatsapp", "84912345678")).toBe("WhatsApp: 84912345678")
    expect(text("facebook", "myshop")).toBe("Facebook: myshop")
  })

  it("shows a phone number or an address as it is, a web address as its host, a label as is", () => {
    expect(text("phone", "+84912345678")).toBe("+84912345678")
    expect(text("email", "hello@example.com")).toBe("hello@example.com")
    expect(text("url", "https://shop.example.com/order")).toBe("shop.example.com")
    expect(contactLinkText({ kind: "telegram", value: "my_shop", label: "Order on Telegram" }))
      .toBe("Order on Telegram")
  })
})

describe("readContactLinks", () => {
  it("drops a link whose value its kind refuses, and a body of another shape", () => {
    expect(
      readContactLinks({ links: [...LINKS, { kind: "url", value: "javascript:x", label: null }] }),
    )
      .toEqual(LINKS)
    expect(readContactLinks({ posts: [] })).toBeUndefined()
  })
})
