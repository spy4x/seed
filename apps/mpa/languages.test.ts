import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import AppWrapper from "./routes/_app.tsx"
import Layout from "./routes/_layout.tsx"
import Pricing, { handler as pricing } from "./routes/[[lang]]/pricing.tsx"
import Terms from "./routes/[[lang]]/terms.tsx"
import { languageMiddleware, pageMiddleware } from "./middleware.ts"
import { localePath, pathLanguage, segmentLanguage, SITE_LANGUAGES } from "./languages.ts"
import type { MpaConfig } from "./config.ts"
import type { State } from "./utils.ts"

const config: MpaConfig = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const site = config.webAppOrigin
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

/** A page component, typed for `App.route`. */
const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

/** A page behind the language guard at the address shape `routes/[[lang]]/` gives it. */
const guarded = new App<State>()
  .get("{/:lang}?/pricing", languageMiddleware, (ctx) => ctx.text(`pricing`))
  .handler()

/** Real pages behind the website's middleware, `_app` and root layout, as in production. */
const pages = new App<State>()
  .use(pageMiddleware(config, () => Promise.reject(new Error(`no API`)), () => true))
  .appWrapper(view(AppWrapper))
  .layout("*", view(Layout))
  .route("{/:lang}?/pricing", { component: view(Pricing), handler: pricing })
  .route("{/:lang}?/terms", { component: view(Terms) })
  .handler()

/** The guard behind the website's middleware, with the home page at both its addresses. */
const routed = new App<State>()
  .use(pageMiddleware(config, () => Promise.reject(new Error(`no API`)), () => true))
  .get("/", (ctx) => ctx.text(`home`))
  .get("{/:lang}?/pricing", languageMiddleware, (ctx) => ctx.text(`pricing`))
  .post("{/:lang}?/pricing", languageMiddleware, (ctx) => ctx.text(`posted`))
  .get("/:lang", languageMiddleware, (ctx) => ctx.text(`home`))
  .handler()

async function get(app: typeof guarded, path: string) {
  const response = await app(new Request(`${site}${path}`), info)
  return {
    status: response.status,
    location: response.headers.get(`location`),
    html: await response.text(),
  }
}

describe("the language segment of an address (#276)", () => {
  it("serves each language at its own prefix and the default one without a prefix", () => {
    expect(segmentLanguage(undefined)).toEqual({ kind: `serve`, language: `en` })
    for (const language of SITE_LANGUAGES.filter((language) => language !== `en`)) {
      expect(segmentLanguage(language)).toEqual({ kind: `serve`, language })
    }
  })

  it("redirects the default language's own prefix", () => {
    expect(segmentLanguage(`en`)).toEqual({ kind: `redirect` })
  })

  it("refuses anything that is not exactly a served language", () => {
    for (
      const segment of [
        ``,
        `xx`,
        `..`,
        `.`,
        `%2E%2E`,
        `de%2F..`,
        `de/..`,
        `__proto__`,
        `constructor`,
        `toString`,
        `PT-br`,
        `pt-br`,
        `DE`,
        `de `,
        `en-US`,
      ]
    ) {
      expect(segmentLanguage(segment), segment).toEqual({ kind: `missing` })
    }
  })

  it("reads a page's language and its path from the address alone", () => {
    expect(pathLanguage(`/de/pricing`)).toEqual({ language: `de`, path: `/pricing` })
    expect(pathLanguage(`/pt-BR`)).toEqual({ language: `pt-BR`, path: `/` })
    expect(pathLanguage(`/pricing`)).toEqual({ language: `en`, path: `/pricing` })
    expect(pathLanguage(`/PT-br/pricing`)).toEqual({ language: `en`, path: `/PT-br/pricing` })
    expect(pathLanguage(`/__proto__/pricing`)).toEqual({
      language: `en`,
      path: `/__proto__/pricing`,
    })
  })

  it("builds each language's address of a page, keeping a fragment on the home page", () => {
    expect(localePath(`en`, `/pricing`)).toBe(`/pricing`)
    expect(localePath(`de`, `/pricing`)).toBe(`/de/pricing`)
    expect(localePath(`ar`, `/`)).toBe(`/ar`)
    expect(localePath(`ru`, `/#status`)).toBe(`/ru#status`)
  })
})

describe("languageMiddleware", () => {
  it("lets the default language and every served language through", async () => {
    for (const language of SITE_LANGUAGES) {
      const { status } = await get(guarded, localePath(language, `/pricing`))
      expect(status, language).toBe(200)
    }
  })

  it("answers /en/… with a 301 to the address without the prefix, keeping the query", async () => {
    const { status, location } = await get(guarded, `/en/pricing?plan=team`)

    expect(status).toBe(301)
    expect(location).toBe(`/pricing?plan=team`)
  })

  it("answers 404 for an unknown or wrongly written language, and for an empty segment", async () => {
    for (
      const path of [
        `/xx/pricing`,
        `/PT-br/pricing`,
        `/__proto__/pricing`,
        `/constructor/pricing`,
        `/de%2F..%2Fadmin/pricing`,
        `/%2E%2E%2Fde/pricing`,
      ]
    ) {
      const { status } = await get(guarded, path)
      expect(status, path).toBe(404)
    }
  })

  it("serves //pricing as /pricing, since Fresh collapses repeated slashes before it routes", async () => {
    expect((await get(guarded, `//pricing`)).status).toBe(200)
    expect((await get(pages, `//pricing`)).html).toContain(
      `<link rel="canonical" href="${site}/pricing"`,
    )
  })

  it("serves /../pricing as /pricing, since the URL parser resolves the dot segment first", async () => {
    expect(new URL(`${site}/%2E%2E/pricing`).pathname).toBe(`/pricing`)
    expect((await get(guarded, `/%2E%2E/pricing`)).status).toBe(200)
  })
})

describe("an address that ends in a slash", () => {
  it("answers 301 to the address without the slash, keeping the query, and that address answers 200", async () => {
    for (
      const [path, target] of [
        [`/pricing/`, `/pricing`],
        [`/de/pricing/?plan=team`, `/de/pricing?plan=team`],
        [`/de/`, `/de`],
      ]
    ) {
      const { status, location } = await get(routed, path)
      expect(status, path).toBe(301)
      expect(location, path).toBe(target)
      expect((await get(routed, target)).status, target).toBe(200)
    }
  })

  it("keeps the redirect on this site when the address starts with two slashes", async () => {
    const { status, location } = await get(routed, `//evil.com/`)

    expect(status).toBe(301)
    expect(location).toBe(`/evil.com`)
  })

  it("leaves a POST alone, since a 301 would turn it into a GET", async () => {
    const post = new Request(`${site}/pricing/`, {
      method: `POST`,
      headers: { origin: site, "sec-fetch-site": `same-origin` },
    })

    const response = await routed(post, info)

    expect(response.status).not.toBe(403)
    expect(response.status).not.toBe(301)
  })
})

describe("a page's head in each language", () => {
  it("names the page's language and direction on <html>", async () => {
    expect((await get(pages, `/pricing`)).html).toContain(`<html lang="en" dir="ltr"`)
    expect((await get(pages, `/de/pricing`)).html).toContain(`<html lang="de" dir="ltr"`)
    expect((await get(pages, `/ar/pricing`)).html).toContain(`<html lang="ar" dir="rtl"`)
  })

  it("links every language version and x-default, and points the canonical at its own language", async () => {
    const { html } = await get(pages, `/de/pricing`)

    for (const language of SITE_LANGUAGES) {
      expect(html).toContain(
        `<link rel="alternate" hreflang="${language}" href="${site}${
          localePath(language, `/pricing`)
        }"`,
      )
    }
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${site}/pricing"`)
    expect(html).toContain(`<link rel="canonical" href="${site}/de/pricing"`)
    expect(html).toContain(`<meta property="og:locale" content="de_DE"`)
  })

  it("translates the title and description", async () => {
    const { html } = await get(pages, `/de/pricing`)

    expect(html).toContain(
      `<title>Seed-Preise: ein kostenloser SaaS-Starter unter MIT-Lizenz</title>`,
    )
    expect(html).not.toContain(`Seed pricing: a free, MIT-licensed SaaS starter`)
  })

  it("keeps a legal page English at a translated address, says so, and names no alternates", async () => {
    const { status, html } = await get(pages, `/de/terms`)

    expect(status).toBe(200)
    expect(html).toContain(`<html lang="de" dir="ltr"`)
    expect(html).toContain(`Diese Seite gibt es nur auf Englisch.`)
    expect(html).toContain(`<link rel="canonical" href="${site}/terms"`)
    expect(html).not.toContain(`rel="alternate" hreflang=`)
  })
})
