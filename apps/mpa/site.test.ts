import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { formatMoney } from "@spy4x/platform/universal/money"
import { PLANS } from "@domain/billing"
import AppWrapper from "./routes/_app.tsx"
import Home from "./routes/index.tsx"
import Pricing, { handler as pricing } from "./routes/pricing.tsx"
import Privacy from "./routes/privacy.tsx"
import Terms from "./routes/terms.tsx"
import { handler as robots } from "./routes/robots.txt.ts"
import { handler as sitemap } from "./routes/sitemap.xml.ts"
import { handler as unsubscribe } from "./routes/unsubscribe.ts"
import { pageMiddleware } from "./middleware.ts"
import { REPOSITORY_URL, SITE_PAGES } from "./site.tsx"
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
    .route("/privacy", { component: view(Privacy) })
    .route("/terms", { component: view(Terms) })
    .get("/robots.txt", robots.GET!)
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

describe("the public website", () => {
  it("answers the home page with its heading, the demo and GitHub links and its head tags", async () => {
    const { status, html } = await page("/")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("The groundwork of a SaaS, already built.")
    expect(hrefOf(linkNamed(html, "Try the live demo"))).toBe(`${spa}/sign-up`)
    expect(hrefOf(linkNamed(html, "View on GitHub"))).toBe(REPOSITORY_URL)
    expect(html).toMatch(/<title>Template: an open-source SaaS starter on Deno<\/title>/)
    expect(html).toContain(`<link rel="canonical" href="${site}/"`)
    expect(html).toContain(`<meta property="og:url" content="${site}/"`)
    expect(html).toMatch(/<meta name="description" content="Sign-up with a second factor/)
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it("leads the header to the SPA's sign-in and sign-up, never to the website's own host", async () => {
    const { html } = await page("/")

    expect(hrefOf(linkNamed(html, "Sign in"))).toBe(`${spa}/sign-in`)
    expect(hrefOf(linkNamed(html, "Try the demo"))).toBe(`${spa}/sign-up`)
    expect(hrefOf(linkNamed(html, "Pricing"))).toBe("/pricing")
    expect(hrefOf(linkNamed(html, "GitHub"))).toBe(REPOSITORY_URL)
  })

  it("prices every plan of the catalog and says they are the demo app's", async () => {
    const { status, html } = await page("/pricing")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("Pricing of the demo app")
    expect(html).toContain("These are example prices")
    for (const plan of PLANS) {
      expect(html).toContain(`>${plan.name}</h2>`)
      expect(html).toContain(formatMoney(plan.amount, plan.currency))
      expect(html).toContain(`name="planId" value="${plan.id}"`)
    }
    expect(html.match(/<form [^>]*action="\/pricing"[^>]*method="post"/g)).toHaveLength(
      PLANS.length,
    )
    expect(html).toContain(`<link rel="canonical" href="${site}/pricing"`)
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
      expect(html, path).not.toContain("News by e-mail")
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
    expect(locs).toEqual(SITE_PAGES.map((path) => `${site}${path}`))
    expect(locs).toContain(`${site}/pricing`)
  })
})
