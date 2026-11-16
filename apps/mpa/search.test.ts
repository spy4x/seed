import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "@spy4x/preact-server"
import { loadIndex } from "@spy4x/search"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import AppWrapper from "./routes/_app.tsx"
import Layout from "./routes/_layout.tsx"
import Admin from "./routes/[[lang]]/admin.tsx"
import Compare from "./routes/[[lang]]/compare.tsx"
import Features from "./routes/[[lang]]/features.tsx"
import Pricing, { handler as pricing } from "./routes/[[lang]]/pricing.tsx"
import { handler as searchPage } from "./routes/[[lang]]/search.tsx"
import { handler as searchJson } from "./routes/[[lang]]/search.json.ts"
import { API_DOCS_PATH } from "./api-docs.ts"
import { DOCS_PATH } from "./docs-site.ts"
import { pageMiddleware } from "./middleware.ts"
import { SITE_PAGES } from "./pages.ts"
import {
  markupText,
  MAX_QUERY_LENGTH,
  SEARCH_ALIASES,
  searchQuery,
  SECTION_PAGES,
  siteSearchEntries,
  siteSearchIndex,
} from "./search.ts"
import type { MpaConfig } from "./config.ts"
import type { State } from "./utils.ts"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const site = config.webAppOrigin
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

/** The pages the search covers and its own routes, behind the site's middleware, as served. */
function siteWith(newsletter: boolean, siteConfig: MpaConfig = config) {
  return new App<State>()
    .use(pageMiddleware(siteConfig, () => Promise.reject(new Error("api")), () => newsletter))
    .appWrapper(view(AppWrapper))
    .layout("*", view(Layout))
    .route("/features", { component: view(Features) })
    .route("/admin", { component: view(Admin) })
    .route("/compare", { component: view(Compare) })
    .route("/pricing", { component: view(Pricing), handler: pricing })
    .get("{/:lang}?/search", searchPage.GET!)
    .get("{/:lang}?/search.json", searchJson.GET!)
    .handler()
}
const handler = siteWith(true)

async function get(path: string, app = handler) {
  const response = await app(new Request(`${site}${path}`), info)
  return { status: response.status, headers: response.headers, body: await response.text() }
}

const everything = { language: `en`, newsletter: true, notes: true } as const

/** The address of the best result for `query` in the English index with everything on. */
function best(query: string): string | undefined {
  return siteSearchIndex(everything).index.search(query, { limit: 1 }).hits[0]?.entry.href
}

/** The links of `html`'s results list on `/search`. */
function results(html: string): string[] {
  const list = html.match(/<ul[^>]*data-e2e="search-page-results"[\s\S]*?<\/ul>/)?.[0] ?? ``
  return [...list.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
}

describe("the site search index", () => {
  it("lists every page of SITE_PAGES", () => {
    const hrefs = siteSearchEntries(everything).map((entry) => entry.href)
    for (const page of SITE_PAGES) expect(hrefs, page.path).toContain(page.path)
  })

  it("has an entry for every h2 and h3 with an id that Features, Pricing, Compare and /admin render", async () => {
    const hrefs = new Set(siteSearchEntries(everything).map((entry) => entry.href))
    expect(SECTION_PAGES.map((page) => page.path)).toEqual([
      `/features`,
      `/pricing`,
      `/compare`,
      `/admin`,
    ])
    for (const { path } of SECTION_PAGES) {
      const { body } = await get(path)
      const main = body.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? ``
      const ids = [...main.matchAll(/<h[23]\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1])
        .filter((id) => id !== `cta-title`)
      expect(ids.length, path).toBeGreaterThan(2)
      for (const id of ids) expect(hrefs.has(`${path}#${id}`), `${path}#${id}`).toBe(true)
    }
  })

  it("puts every alias on an entry that exists", () => {
    const hrefs = siteSearchEntries(everything).map((entry) => entry.href)
    for (const key of Object.keys(SEARCH_ALIASES)) expect(hrefs, key).toContain(key)
  })

  it("leaves out the newsletter page while subscriptions are off, and the API reference while the notes are off", () => {
    const hrefs = (newsletter: boolean, notes: boolean) =>
      siteSearchEntries({ language: `en`, newsletter, notes }).map((entry) => entry.href)
    expect(hrefs(true, true)).toContain(FORM_ACTIONS.subscribe)
    expect(hrefs(false, true)).not.toContain(FORM_ACTIONS.subscribe)
    expect(hrefs(true, true)).toContain(API_DOCS_PATH)
    expect(hrefs(true, false)).not.toContain(API_DOCS_PATH)
  })

  it("answers “free” with Pricing", () => {
    expect(best(`free`)).toBe(`/pricing`)
  })

  it("answers “stripe” with the billing section of Features", () => {
    expect(best(`stripe`)).toBe(`/features#billing-title`)
  })

  it("answers “self-host” with the deploy section of Features", () => {
    expect(best(`self-host`)).toBe(`/features#deploy-title`)
  })

  it("answers a compared starter's name with its section of Compare", () => {
    expect(best(`supastarter`)).toBe(`/compare#supastarter-title`)
  })

  it("finds a section by its text, not only its heading", () => {
    const entry = siteSearchEntries(everything).find((entry) => entry.href === `/pricing#way-run`)
    expect(entry?.label).toBe(`Run it in production`)
    expect(entry?.text?.length).toBeGreaterThan(entry!.label.length)
    expect(entry?.detail).toBe(`in Pricing`)
  })

  it("links to the visitor's language, and to the English address of a page that is English everywhere", () => {
    const hrefs = siteSearchEntries({ language: `de`, newsletter: true, notes: true })
      .map((entry) => entry.href)
    expect(hrefs).toContain(`/de/pricing`)
    expect(hrefs).toContain(`/de/features#billing-title`)
    expect(hrefs).toContain(DOCS_PATH)
    expect(hrefs).not.toContain(`/pricing`)
  })

  it("names its groups and the page a section is in in the visitor's language", () => {
    const entries = siteSearchEntries({ language: `de`, newsletter: true, notes: true })
    const section = entries.find((entry) => entry.href === `/de/pricing#way-run`)
    expect(section?.detail).toBe(`in „Preise“`)
    expect(new Set(entries.map((entry) => entry.group))).toEqual(new Set([`Seiten`, `Abschnitte`]))
  })
})

describe("markupText", () => {
  it("drops tags and drawings and reads entities", () => {
    expect(markupText(`<p>A &amp; B&#39;s <svg><title>x</title></svg><b>&lt;C&gt;</b></p>`))
      .toBe(`A & B's <C>`)
  })
})

describe("searchQuery", () => {
  it("trims the query and cuts it to MAX_QUERY_LENGTH characters without splitting one", () => {
    expect(searchQuery(null)).toBe(``)
    expect(searchQuery(`  stripe  `)).toBe(`stripe`)
    expect([...searchQuery(`😀`.repeat(500))]).toHaveLength(MAX_QUERY_LENGTH)
  })
})

describe("/search.json", () => {
  it("serves an index the browser can load, cacheable, with links in the address's language", async () => {
    const { status, headers, body } = await get(`/de/search.json`)
    expect(status).toBe(200)
    expect(headers.get(`content-type`)).toContain(`application/json`)
    expect(headers.get(`cache-control`)).toBe(`public, max-age=3600`)
    const hits = loadIndex(body).search(`stripe`, { limit: 1 }).hits
    expect(hits[0]?.entry.href).toBe(`/de/features#billing-title`)
  })

  it("leaves the newsletter page out while subscriptions are off", async () => {
    const { body } = await get(`/search.json`, siteWith(false))
    expect(JSON.parse(body).entries.map((entry: { href: string }) => entry.href))
      .not.toContain(FORM_ACTIONS.subscribe)
  })
})

describe("/search", () => {
  it("lists the results as links, for a visitor without JavaScript, and keeps out of search engines", async () => {
    const { status, body } = await get(`/search?q=stripe`)
    expect(status).toBe(200)
    expect(results(body)[0]).toBe(`/features#billing-title`)
    expect(body).toContain(`name="robots" content="noindex`)
    expect(body).toMatch(/<form method="get" action="\/search" role="search"/)
    expect(body).toContain(`value="stripe"`)
  })

  it("asks for a query when there is none", async () => {
    const { status, body } = await get(`/search`)
    expect(status).toBe(200)
    expect(results(body)).toEqual([])
    expect(body).toContain(`Type what you are looking for`)
  })

  it("offers the docs and the demo when nothing matches", async () => {
    const { body } = await get(`/search?q=zzqqxx`)
    const none = body.match(/data-e2e="search-page-none"[\s\S]*?<\/section>/)?.[0] ?? ``
    expect(none).toContain(`href="${DOCS_PATH}"`)
    expect(none).toContain(`href="https://app.example.com/try" rel="nofollow"`)
  })

  it("searches only the first MAX_QUERY_LENGTH characters of a long query", async () => {
    const { status, body } = await get(`/search?q=${`stripe `.repeat(2000)}`)
    expect(status).toBe(200)
    const value = body.match(/name="q"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="q"/)
    expect((value?.[1] ?? value?.[2] ?? ``).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH)
    expect(results(body)[0]).toBe(`/features#billing-title`)
  })

  it("links the results to the address's language", async () => {
    const { body } = await get(`/de/search?q=stripe`)
    expect(results(body)[0]).toBe(`/de/features#billing-title`)
    expect(body).toMatch(/action="\/de\/search"/)
  })
})
