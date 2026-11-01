import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import AppWrapper from "./routes/_app.tsx"
import Layout from "./routes/_layout.tsx"
import Features from "./routes/[[lang]]/features.tsx"
import { FEATURE_NOT_FOUND, handler as feature } from "./routes/[[lang]]/features/[slug].tsx"
import {
  type Feature,
  FEATURE_PAGES,
  type FeaturePage,
  featurePageSections,
} from "./features-data.tsx"
import { pageMiddleware } from "./middleware.ts"
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

const handler = new App<State>()
  .use(
    pageMiddleware(config, () => Promise.reject(new Error("the page called the API")), () => true),
  )
  .appWrapper(view(AppWrapper))
  .layout("*", view(Layout))
  .route("{/:lang}?/features", { component: view(Features) })
  .get("{/:lang}?/features/:slug", feature.GET!)
  .handler()

async function get(path: string) {
  const response = await handler(new Request(`${site}${path}`), info)
  return {
    status: response.status,
    location: response.headers.get("location"),
    html: await response.text(),
  }
}

function jsonLdGraph(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .flatMap((match) => JSON.parse(match[1])["@graph"])
}

/** The sections a page draws: the ids of its `<section>`s, in order. */
function sectionIds(html: string): string[] {
  return [...html.matchAll(/<section id="([^"]+)"/g)].map((match) => match[1])
}

/** The fragments the page's "On this page" list links to. */
function onThisPage(html: string): string[] {
  const nav = html.match(/<nav aria-label="On this page"[\s\S]*?<\/nav>/)?.[0] ?? ``
  return [...new Set([...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]))]
}

describe("the feature pages", () => {
  it("draws each feature page in its fixed order, with On this page listing exactly those sections", async () => {
    for (const page of FEATURE_PAGES) {
      const { status, html } = await get(`/features/${page.slug}`)

      expect(status, page.slug).toBe(200)
      const drawn = sectionIds(html).filter((id) =>
        [`what`, `how`, `limits`, `questions`].includes(id)
      )
      expect(onThisPage(html), page.slug).toEqual(drawn)
      expect(drawn[0], page.slug).toBe(`what`)
    }
  })

  it("leaves out Limits, and its On this page entry, when the feature has nothing not built yet", async () => {
    const signIn = await get(`/features/sign-in`)
    const billing = await get(`/features/billing`)

    expect(sectionIds(signIn.html)).not.toContain(`limits`)
    expect(onThisPage(signIn.html)).not.toContain(`limits`)
    expect(sectionIds(billing.html)).toContain(`limits`)
    expect(onThisPage(billing.html)).toContain(`limits`)
    expect(billing.html).toContain(`Payment providers other than Stripe`)
  })

  it("lists only the sections that have something to say", () => {
    const page = FEATURE_PAGES[0]
    const feature: Feature = {
      id: page.slug,
      nav: page.name,
      eyebrow: ``,
      title: ``,
      lead: ``,
      facts: [`One fact`],
      code: { label: ``, href: `` },
    }
    const empty: FeaturePage = { ...page, how: [], questions: [] }

    expect(featurePageSections(empty, feature).map(({ id }) => id)).toEqual([`what`])
    expect(
      featurePageSections(page, { ...feature, notYet: [{ label: `X` }] }).map(({ id }) => id),
    ).toEqual([`what`, `how`, `limits`, `questions`])
  })

  // `/features/admin` itself never reaches this handler on the built server: Fresh routes it to
  // `routes/features/admin.ts` (e2e/mpa/features.mpa.ts checks it there).
  it("sends another language's /features/admin to the admin panel's page in that language", async () => {
    expect(await get(`/de/features/admin`)).toMatchObject({ status: 301, location: `/de/admin` })
  })

  it("answers a slug that names a property every object has with a 404, not a crash", async () => {
    for (const slug of [`constructor`, `toString`, `__proto__`, `hasOwnProperty`]) {
      expect((await get(`/features/${slug}`)).status, slug).toBe(404)
    }
  })

  it("keeps the code link's arrow on the line of the path's last part", async () => {
    for (const page of FEATURE_PAGES) {
      const { html } = await get(`/features/${page.slug}`)
      const link = html.match(/data-e2e="feature-page-code"[\s\S]*?<\/a>/)?.[0] ?? ``

      expect(link, page.slug).toMatch(/<span class="whitespace-nowrap">[^/<\s]+\/?<svg[^>]*>/)
    }
  })

  it("sends another language's address to the English page, the only one there is", async () => {
    expect(await get(`/de/features/sign-in`)).toMatchObject({
      status: 301,
      location: `/features/sign-in`,
    })
  })

  it("answers an unknown feature with a 404 that leads to every feature", async () => {
    const { status, html } = await get(`/features/not-a-feature`)

    expect(status).toBe(404)
    const text = html.replaceAll(`&#39;`, `'`)
    expect(text).toMatch(new RegExp(`<h1[^>]*>${FEATURE_NOT_FOUND.title}</h1>`))
    expect(text).toContain(FEATURE_NOT_FOUND.description)
    expect(html).toMatch(/<a [^>]*href="\/features"[^>]*>[\s\S]*?See all features/)
    expect(html).toMatch(/<meta name="robots" content="noindex/)
  })

  it("names no other language version, since each page is English only", async () => {
    const { html } = await get(`/features/offline`)

    expect(html).not.toMatch(/<link rel="alternate"[^>]*hreflang=/)
  })

  it("describes each page as about Seed, with its trail and its visible questions", async () => {
    for (const page of FEATURE_PAGES) {
      const graph = jsonLdGraph((await get(`/features/${page.slug}`)).html)
      const types = graph.map((entity) => entity["@type"])

      expect(types, page.slug).toEqual(
        expect.arrayContaining([`WebPage`, `BreadcrumbList`, `FAQPage`]),
      )
      const webPage = graph.find((entity) => entity["@type"] === `WebPage`)!
      const software = graph.find((entity) =>
        [entity["@type"]].flat().includes(`SoftwareApplication`)
      )!
      expect(webPage.about, page.slug).toEqual({ "@id": software["@id"] })
      const faq = graph.find((entity) => entity["@type"] === `FAQPage`) as {
        mainEntity: { name: string }[]
      }
      expect(faq.mainEntity.map(({ name }) => name)).toEqual(page.questions.map((q) => q.question))
    }
  })

  it("starts every answer with Yes, No or Not yet", () => {
    for (const page of FEATURE_PAGES) {
      expect(page.questions.length, page.slug).toBeGreaterThanOrEqual(3)
      expect(page.questions.length, page.slug).toBeLessThanOrEqual(5)
      for (const { answer } of page.questions) {
        expect(answer, page.slug).toMatch(/^(Yes|No|Not yet)\. /)
      }
    }
  })

  it("links each feature on /features that has a page of its own, in every language", async () => {
    for (const path of [`/features`, `/de/features`]) {
      const { html } = await get(path)
      for (const page of FEATURE_PAGES) {
        expect(html, path).toMatch(
          new RegExp(
            `<a href="/features/${page.slug}" hreflang="en"[^>]*data-e2e="feature-more-link"`,
          ),
        )
      }
    }
    expect((await get(`/de/features`)).html).toMatch(
      /<a href="\/de\/admin"[^>]*data-e2e="feature-more-link"/,
    )
  })
})
