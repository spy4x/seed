import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { formatMoney } from "@spy4x/platform/universal/money"
import { PLANS } from "@domain/billing"
import AppWrapper from "./routes/_app.tsx"
import Home, { HOME_HEAD } from "./routes/index.tsx"
import Mvp, { MVP_HEAD } from "./routes/mvp.tsx"
import Pricing, { handler as pricing, PRICING_HEAD } from "./routes/pricing.tsx"
import Privacy from "./routes/privacy.tsx"
import Terms from "./routes/terms.tsx"
import { handler as robots } from "./routes/robots.txt.ts"
import { handler as subscribe } from "./routes/subscribe/index.ts"
import { handler as theme } from "./routes/theme.js.ts"
import { handler as sitemap } from "./routes/sitemap.xml.ts"
import { handler as unsubscribe } from "./routes/unsubscribe.ts"
import { pageMiddleware } from "./middleware.ts"
import { BOOK_CALL_URL, BRIEF_URL } from "./hire.ts"
import { ogImageAlt, type OgImageKey, REPOSITORY_URL, SITE_PAGES } from "./site.tsx"
import type { State } from "./utils.ts"

/** The website on its own domain, so a link to the website and a link to the SPA differ. */
const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const site = config.webAppOrigin
const spa = config.apiOrigin
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const neverCalled = () => Promise.reject(new Error("the website called the API"))

/** A page component, typed for `App.route`: `define.page` types its props for one handler. */
const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

/** The website's pages behind its middleware and its `_app` document, as in production. */
function siteWith(newsletter: () => boolean) {
  return new App<State>()
    .use(pageMiddleware(config, neverCalled, newsletter))
    .appWrapper(view(AppWrapper))
    .route("/", { component: view(Home) })
    .route("/pricing", { component: view(Pricing), handler: pricing })
    .route("/mvp", { component: view(Mvp) })
    .route("/privacy", { component: view(Privacy) })
    .route("/terms", { component: view(Terms) })
    .get("/subscribe", subscribe.GET!)
    .get("/robots.txt", robots.GET!)
    .get("/theme.js", theme.GET!)
    .get("/sitemap.xml", sitemap.GET!)
    .get("/unsubscribe", unsubscribe.GET!)
    .handler()
}
const handler = siteWith(() => true)
/** The same website while the API takes no subscriptions. */
const withoutNewsletter = siteWith(() => false)

async function page(path: string, app = handler): Promise<{ status: number; html: string }> {
  const response = await app(new Request(`${site}${path}`), info)
  return { status: response.status, html: await response.text() }
}

/** The `<a>` whose text is `text`, or `undefined`: its whole opening tag, to read `href` from. */
function linkNamed(html: string, text: string): string | undefined {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
    .find((match) => match[1].replace(/<[^>]+>/g, "").trim() === text)?.[0]
}

function hrefOf(tag: string | undefined): string | undefined {
  return tag?.match(/href="([^"]*)"/)?.[1]
}

function headingOne(html: string): string | undefined {
  return html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]+>/g, "").trim()
}

/** The `content` of the `<meta>` whose `property` or `name` is `key`. */
function metaContent(html: string, key: string): string | undefined {
  return html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1]
}

/** The entities of the page's JSON-LD `@graph`, or none when the page has no structured data. */
function jsonLdGraph(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ]
  return scripts.flatMap((match) => JSON.parse(match[1])["@graph"])
}

/** The markup between the first opening `<tag` and its matching close, for a tag never nested. */
function element(html: string, tag: string): string | undefined {
  return html.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`))?.[0]
}

describe("the public website", () => {
  it("answers the home page with its heading, the demo and GitHub links and its head tags", async () => {
    const { status, html } = await page("/")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("The groundwork of your SaaS, already built.")
    expect(hrefOf(linkNamed(html, "Try the live demo"))).toBe(`${spa}/sign-up`)
    expect(hrefOf(linkNamed(html, "View on GitHub"))).toBe(REPOSITORY_URL)
    expect(html).toContain(`<title>Seed: open-source SaaS starter you host on one server</title>`)
    expect(html).toContain(`<link rel="canonical" href="${site}/"`)
    expect(metaContent(html, "og:url")).toBe(`${site}/`)
    expect(metaContent(html, "description")).toBe(HOME_HEAD.description)
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it("names every other page after its own title, then the site", async () => {
    const { html } = await page("/privacy")

    expect(html).toContain(`<title>Privacy: what Seed's demo and site keep · Seed</title>`)
  })

  it("starts every page with a link that skips to the main content, then one header, main and footer", async () => {
    for (const path of ["/", "/privacy", "/subscribe"]) {
      const { html } = await page(path)
      const body = html.slice(html.indexOf("<body"))

      expect(body.match(/<a\b[^>]*>/)?.[0], path).toContain(`href="#main"`)
      expect(linkNamed(body, "Skip to content"), path).toContain(`href="#main"`)
      expect(body.match(/<main\b[^>]*>/g), path).toEqual([
        `<main id="main" tabindex="-1" class="outline-none">`,
      ])
      // The site's own header and footer; a page may add a header of its own inside `<main>`.
      expect(body.slice(0, body.indexOf("<main")).match(/<header\b/g), path).toHaveLength(1)
      expect(body.slice(body.indexOf("</main>")).match(/<footer\b/g), path).toHaveLength(1)
    }
  })

  it("leads the header to every section of the site and the demo, and keeps sign-in in the footer", async () => {
    const { html } = await page("/")
    const header = element(html, "header")!
    const footer = element(html, "footer")!

    const nav = [...header.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
      .map((match) => [match[1].replace(/<[^>]+>/g, "").trim(), hrefOf(match[0])])
    expect(nav).toEqual(expect.arrayContaining([
      ["Features", "/features"],
      ["Compare", "/compare"],
      ["Pricing", "/pricing"],
      ["Hire me", "/mvp"],
      ["GitHub", REPOSITORY_URL],
      ["Try the demo", `${spa}/sign-up`],
    ]))
    expect(linkNamed(header, "Sign in")).toBeUndefined()
    expect(hrefOf(linkNamed(footer, "Sign in"))).toBe(`${spa}/sign-in`)
    expect(header).not.toContain(`href="${site}/sign-`)
  })

  const ogCards: [string, OgImageKey][] = [
    ["/", "home"],
    ["/subscribe", "subscribe"],
    ["/pricing", "pricing"],
    ["/mvp", "mvp"],
    ["/privacy", "home"],
    ["/terms", "home"],
  ]
  for (const [path, key] of ogCards) {
    it(`shares ${path} with the ${key} card, its size and its alt text`, async () => {
      const { html } = await page(path)

      expect(metaContent(html, "og:image")).toBe(`${site}/og/${key}.png`)
      expect(metaContent(html, "og:image:width")).toBe("1200")
      expect(metaContent(html, "og:image:height")).toBe("630")
      expect(metaContent(html, "og:image:alt")).toBe(ogImageAlt(key))
      expect(metaContent(html, "og:site_name")).toBe("Seed")
    })
  }

  it("describes the home page as the site, the source code, its author and its questions", async () => {
    const { html } = await page("/")
    const graph = jsonLdGraph(html)

    expect(graph.map((entity) => entity["@type"])).toEqual(
      expect.arrayContaining(["WebSite", "SoftwareSourceCode", "Person", "FAQPage"]),
    )
    const source = graph.find((entity) => entity["@type"] === "SoftwareSourceCode")!
    expect(source.codeRepository).toBe(REPOSITORY_URL)
    const faq = graph.find((entity) => entity["@type"] === "FAQPage")!
    const questions = (faq.mainEntity as { name: string }[]).map((question) => question.name)
    expect(questions.length).toBeGreaterThan(0)
    for (const question of questions) expect(html).toContain(`>${question}<`)
  })

  it("adds no structured data to a legal page", async () => {
    for (const path of ["/privacy", "/terms"]) {
      expect(jsonLdGraph((await page(path)).html), path).toEqual([])
    }
  })

  it("serves the theme script from its own origin, as the content security policy requires", async () => {
    const { html } = await page("/")
    const response = await handler(new Request(`${site}/theme.js`), info)

    expect(html).toMatch(/<head>[\s\S]*<script src="\/theme.js"[^>]*><\/script>[\s\S]*<\/head>/)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8")
    expect(await response.text()).toContain("prefers-color-scheme")
  })

  it("says Seed is free, prices running it and having it built, and sends the founder to /mvp", async () => {
    const { status, html } = await page("/pricing")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("Seed is free. Here is what it costs to run.")
    expect(html).toContain(`<title>${PRICING_HEAD.title} · Seed</title>`)
    for (const card of ["way-use", "way-run", "way-hire"]) expect(html).toContain(`id="${card}"`)
    expect(html).toContain(">$0</span>")
    expect(html).toContain(">From $8,000</span>")
    expect(hrefOf(linkNamed(html, "See how it works"))).toBe("/mvp")
    expect(html).toContain(`<link rel="canonical" href="${site}/pricing"`)
  })

  it("prices every plan of the demo's catalog below Seed's own prices, as an example", async () => {
    const { html } = await page("/pricing")

    expect(html).toContain("These are not Seed's prices")
    expect(html.indexOf(`id="demo-plans"`)).toBeGreaterThan(html.indexOf(`id="way-hire"`))
    for (const plan of PLANS) {
      expect(html).toContain(`>${plan.name}</h3>`)
      expect(html).toContain(formatMoney(plan.amount, plan.currency))
      expect(html).toContain(`name="planId" value="${plan.id}"`)
    }
    expect(html.match(/<form [^>]*action="\/pricing"[^>]*method="post"/g)).toHaveLength(
      PLANS.length,
    )
  })

  it("offers only Seed itself, at no cost, in the pricing page's structured data", async () => {
    const graph = jsonLdGraph((await page("/pricing")).html)

    const software = graph.find((entity) => entity["@type"] === "SoftwareApplication")!
    expect(software.offers).toEqual({ "@type": "Offer", price: 0, priceCurrency: "USD" })
    const offers = JSON.stringify(graph).match(/"@type":"Offer"/g)
    expect(offers).toHaveLength(1)
    expect(graph.map((entity) => entity["@type"])).toEqual(
      expect.arrayContaining(["Person", "FAQPage", "BreadcrumbList"]),
    )
  })

  it("answers /mvp with the outcome, the starting price and the call on antonshubin.com", async () => {
    const { status, html } = await page("/mvp")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe(
      "Your product, live and taking payments, in weeks rather than months.",
    )
    expect(html).toContain(`<title>${MVP_HEAD.title} · Seed</title>`)
    expect(html).toContain(">From $8,000</dd>")
    const book = BOOK_CALL_URL.replaceAll("&", "&amp;")
    expect(html.match(/<a\b[^>]*data-e2e="mvp-book-(hero|closing)"[^>]*>/g)).toEqual([
      expect.stringContaining(`href="${book}"`),
      expect.stringContaining(`href="${book}"`),
    ])
    expect(html).toContain(`href="${BRIEF_URL.replaceAll("&", "&amp;")}"`)
    expect(html).toContain(`<link rel="canonical" href="${site}/mvp"`)
  })

  it("keeps the newsletter off /mvp, where founders came to hire", async () => {
    const { html } = await page("/mvp")

    expect(html).not.toContain(`action="/subscribe"`)
  })

  it("describes /mvp as a service from its starting price, with its questions and no reviews", async () => {
    const { html } = await page("/mvp")
    const graph = jsonLdGraph(html)

    const service = graph.find((entity) => entity["@type"] === "Service")!
    expect(service.provider).toEqual({ "@id": "https://antonshubin.com/#person" })
    expect(service.offers).toMatchObject({
      url: BOOK_CALL_URL,
      priceSpecification: { minPrice: 8000, priceCurrency: "USD" },
    })
    const faq = graph.find((entity) => entity["@type"] === "FAQPage")!
    const questions = (faq.mainEntity as { name: string }[]).map((question) => question.name)
    expect(questions).toHaveLength(7)
    for (const question of questions) {
      expect(html).toContain(`>${question}<`)
    }
    expect(JSON.stringify(graph)).not.toMatch(/"Review"|"AggregateRating"/)
  })

  it("names the trial of every plan that has one, with its length from the catalog", async () => {
    const { html } = await page("/pricing")

    const withTrial = PLANS.filter((plan) => plan.trialDays > 0)
    expect(withTrial.length).toBeGreaterThan(0)
    for (const plan of withTrial) expect(html).toContain(`The first ${plan.trialDays} days free`)
    expect(html.match(/days free/g)).toHaveLength(withTrial.length)
  })

  it("sends a plan chosen without JavaScript to the SPA's sign-up", async () => {
    const response = await handler(
      new Request(`${site}/pricing`, {
        method: "POST",
        headers: { origin: site, "sec-fetch-site": "same-origin" },
        body: new URLSearchParams({ planId: PLANS[0].id }),
      }),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`${spa}/sign-up`)
  })

  for (const [path, title] of [["/privacy", "Privacy"], ["/terms", "Terms"]]) {
    it(`answers ${path} with its heading, a notice to adapt it and its canonical address`, async () => {
      const { status, html } = await page(path)

      expect(status).toBe(200)
      expect(headingOne(html)).toBe(title)
      expect(html).toContain("A starting point, not legal advice")
      expect(html).toContain(`<link rel="canonical" href="${site}${path}"`)
    })
  }

  it("links both legal pages and posts the footer's newsletter form to /subscribe", async () => {
    const { html } = await page("/pricing")

    expect(hrefOf(linkNamed(html, "Privacy"))).toBe("/privacy")
    expect(hrefOf(linkNamed(html, "Terms"))).toBe("/terms")
    const form = html.match(/<form method="post" action="\/subscribe"[\s\S]*?<\/form>/)?.[0]
    expect(form).toContain(`name="list" value="news"`)
    expect(form).toContain(`name="email"`)
  })

  it("offers no newsletter form on any page while subscriptions are off, and keeps the rest of the footer", async () => {
    for (const path of ["/", "/pricing", "/privacy", "/terms"]) {
      const { status, html } = await page(path, withoutNewsletter)

      expect(status, path).toBe(200)
      expect(html, path).not.toContain(`action="/subscribe"`)
      expect(html, path).not.toContain(`id="footer-news"`)
      expect(hrefOf(linkNamed(html, "Privacy")), path).toBe("/privacy")
    }
  })

  it("leaves the newsletter page out of the sitemap while subscriptions are off", async () => {
    const response = await withoutNewsletter(new Request(`${site}/sitemap.xml`), info)

    const locs = [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual(
      SITE_PAGES.filter((path) => path !== "/subscribe").map((path) => `${site}${path}`),
    )
  })

  it("keeps a page a mailed link opens out of search results", async () => {
    const { html } = await page("/unsubscribe")

    expect(html).toContain(`<meta name="robots" content="noindex, nofollow"`)
  })

  it("points robots.txt at the sitemap on the website's own origin", async () => {
    const response = await handler(new Request(`${site}/robots.txt`), info)

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(await response.text()).toContain(`Sitemap: ${site}/sitemap.xml`)
  })

  it("lists every public page in the sitemap at the website's own origin", async () => {
    const response = await handler(new Request(`${site}/sitemap.xml`), info)
    const xml = await response.text()

    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8")
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])
    expect(locs).toEqual(
      ["/", "/features", "/compare", "/pricing", "/mvp", "/subscribe", "/privacy", "/terms"]
        .map((path) => `${site}${path}`),
    )
  })
})
