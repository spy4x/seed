import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import { formatMoney } from "@spy4x/platform/universal/money"
import { PLANS } from "@domain/billing"
import AppWrapper from "./routes/_app.tsx"
import Admin, { ADMIN_HEAD } from "./routes/admin.tsx"
import Compare from "./routes/compare.tsx"
import Features from "./routes/features.tsx"
import Home, { AI_PROMPT, HOME_HEAD, QUICK_START } from "./routes/index.tsx"
import Pricing, { handler as pricing, PRICING_HEAD } from "./routes/pricing.tsx"
import Privacy, { PRIVACY_HEAD } from "./routes/privacy.tsx"
import Terms, { TERMS_HEAD } from "./routes/terms.tsx"
import { handler as mvp } from "./routes/mvp.ts"
import ApiDocs from "./routes/docs/api.tsx"
import { handler as docs } from "./routes/docs/index.ts"
import { handler as robots } from "./routes/robots.txt.ts"
import { handler as subscribe } from "./routes/subscribe/index.ts"
import { handler as theme } from "./routes/theme.js.ts"
import { handler as sitemap } from "./routes/sitemap.xml.ts"
import { handler as videoSitemap } from "./routes/video-sitemap.xml.ts"
import { handler as llms } from "./routes/llms.txt.ts"
import { handler as unsubscribe } from "./routes/unsubscribe.ts"
import { pageMiddleware } from "./middleware.ts"
// Seed's own site: see docs/start-a-product.md
import { HIRE_PAGE_URL } from "./hire.ts"
import { ogImageAlt, type OgImageKey, REPOSITORY_URL } from "./site.tsx"
import { SITE_PAGES } from "./pages.ts"
import type { MpaConfig } from "./config.ts"
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
function siteWith(newsletter: () => boolean, siteConfig: MpaConfig = config) {
  return new App<State>()
    .use(pageMiddleware(siteConfig, neverCalled, newsletter))
    .appWrapper(view(AppWrapper))
    .route("/", { component: view(Home) })
    .route("/features", { component: view(Features) })
    .route("/admin", { component: view(Admin) })
    .route("/compare", { component: view(Compare) })
    .route("/pricing", { component: view(Pricing), handler: pricing })
    .get("/mvp", mvp.GET!)
    .route("/privacy", { component: view(Privacy) })
    .route("/docs/api", { component: view(ApiDocs) })
    .get("/docs", docs.GET!)
    .route("/terms", { component: view(Terms) })
    .get("/subscribe", subscribe.GET!)
    .get("/robots.txt", robots.GET!)
    .get("/theme.js", theme.GET!)
    .get("/sitemap.xml", sitemap.GET!)
    .get("/video-sitemap.xml", videoSitemap.GET!)
    .get("/llms.txt", llms.GET!)
    .get("/unsubscribe", unsubscribe.GET!)
    .handler()
}
const handler = siteWith(() => true)
/** The same website while the API takes no subscriptions. */
const withoutNewsletter = siteWith(() => false)
/** The same website counting visits in a Umami. */
const UMAMI = {
  origin: "https://stats.example.com",
  websiteId: "0199f1a2-0000-7000-8000-000000000001",
}
const withAnalytics = siteWith(() => true, { ...config, analytics: UMAMI })

async function page(path: string, app = handler): Promise<{ status: number; html: string }> {
  const response = await app(new Request(`${site}${path}`), info)
  return { status: response.status, html: await response.text() }
}

/** The `<a>` whose text is `text`, or `undefined`: its whole opening tag, to read `href` from. */
function linkNamed(html: string, text: string): string | undefined {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
    .find((match) => linkText(match[1]) === text)?.[0]
}

/** A link's text as a reader hears it: its tags dropped and its whitespace collapsed. */
function linkText(inner: string): string {
  return inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
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

/** Whether a JSON-LD entity has the type `type`, alone or among several. */
function isType(entity: Record<string, unknown>, type: string): boolean {
  return [entity["@type"]].flat().includes(type)
}

/**
 * Every `@id` a graph defines (an object with more than its id) and every one it only points at
 * (an object that holds nothing but `@id`), at any depth.
 */
function graphIds(graph: unknown): { defined: Set<string>; referenced: Set<string> } {
  const defined = new Set<string>()
  const referenced = new Set<string>()
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk)
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (typeof record["@id"] === "string") {
      ;(Object.keys(record).length === 1 ? referenced : defined).add(record["@id"])
    }
    Object.values(record).forEach(walk)
  }
  walk(graph)
  return { defined, referenced }
}

/** The markup between the first opening `<tag` and its matching close, for a tag never nested. */
function element(html: string, tag: string): string | undefined {
  return html.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`))?.[0]
}

/** Text of a piece of markup, its tags dropped. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim()
}

/**
 * The comparison table of `html`: the product of each column, then each row's capability, its
 * note and the value it shows each product, as a reader sees them.
 */
function comparisonTable(html: string) {
  const table = element(html, "table") ?? ""
  const headers = [...(element(table, "thead") ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)]
    .slice(1)
    .map((match) => textOf(match[1].replace(/<span\b[\s\S]*?<\/span>/g, "")))
  const rows = [...(element(table, "tbody") ?? "").matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(
    ([, row]) => {
      const head = row.match(/<th\b[^>]*>([\s\S]*?)<\/th>/)?.[1] ?? ""
      return {
        capability: textOf(head.replace(/<span\b[\s\S]*?<\/span>/g, "")),
        note: textOf(head.match(/<span\b[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ""),
        values: [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => textOf(cell[1])),
      }
    },
  )
  return { headers, rows }
}

describe("the public website", () => {
  it("answers the home page with its heading, the demo and GitHub links and its head tags", async () => {
    const { status, html } = await page("/")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("The groundwork of your SaaS, already built.")
    expect(hrefOf(linkNamed(html, "Try the live demo"))).toBe(`${spa}/try`)
    expect(hrefOf(linkNamed(html, "View on GitHub"))).toBe(REPOSITORY_URL)
    expect(html).toContain(`<title>Seed: free open-source SaaS starter and boilerplate</title>`)
    expect(html).toContain(`<link rel="canonical" href="${site}/"`)
    expect(metaContent(html, "og:url")).toBe(`${site}/`)
    expect(metaContent(html, "description")).toBe(HOME_HEAD.description)
    expect(html.match(/<title>/g)).toHaveLength(1)
  })

  it("shows every quick-start command in the hero, from creating the repository to starting it", async () => {
    const { html } = await page("/")

    const hero = html.slice(html.indexOf(`id="hero-title"`), html.indexOf(`id="features"`))
    for (const line of QUICK_START) expect(hero).toContain(`$ ${line}`)
  })

  it("keeps every quick-start line a bare command, since interactive zsh passes a comment's words on", () => {
    for (const line of QUICK_START) expect(line, line).not.toContain("#")
  })

  it("says under the hero's commands that init fills in the secrets, and gives the AI prompt", async () => {
    const { html } = await page("/")

    const caption = html.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/)?.[1]
      .replace(/<[^>]+>/g, "")
    expect(caption).toBe(
      `init writes infra/envs/.env with every secret filled in. Or ask your AI agent: ${
        AI_PROMPT.replaceAll(`"`, `&quot;`)
      }.`,
    )
  })

  it("gives the billing and realtime cards a picture of the app", async () => {
    const { html } = await page("/")

    for (
      const [id, shot] of [["feature-billing", "billing-plan"], ["feature-realtime", "realtime-a"]]
    ) {
      const start = html.indexOf(`aria-labelledby="${id}"`)
      const card = html.slice(start, html.indexOf(`role="article"`, start + 1))
      expect(card, id).toContain(`/shots/${shot}-light-`)
    }
  })

  it("draws the billing card from the plan-only picture, 780×416 at its widest", async () => {
    const { html } = await page("/")
    const start = html.indexOf(`aria-labelledby="feature-billing"`)
    const card = html.slice(start, html.indexOf(`role="article"`, start + 1))

    // 780×416 is the plan alone; the whole phone screen it was cut from is 780×1688.
    expect(card).toMatch(/<img[^>]*width="780"[^>]*height="416"/)
    const files = [...new Set(card.match(/\/shots\/[a-z-]+-\d+\.webp/g))]
    expect(files.sort()).toEqual([
      `/shots/billing-plan-dark-390.webp`,
      `/shots/billing-plan-dark-780.webp`,
      `/shots/billing-plan-light-390.webp`,
      `/shots/billing-plan-light-780.webp`,
    ])
  })

  it("names a page after its own title, then the site, when the title does not name Seed", async () => {
    const { html } = await page("/admin")

    expect(html).toContain(`<title>${ADMIN_HEAD.title} · Seed</title>`)
  })

  it("keeps every title within 60 characters and naming Seed once, and every description within 155", async () => {
    for (const { path } of SITE_PAGES) {
      const { html } = await page(path)
      const title = html.match(/<title>([^<]*)<\/title>/)![1].replaceAll("&#39;", "'")
      const description = metaContent(html, "description")!

      expect(title.length, `${path}: ${title}`).toBeLessThanOrEqual(60)
      expect(title.match(/Seed/g), `${path}: ${title}`).toHaveLength(1)
      expect(description.length, `${path}: ${description}`).toBeLessThanOrEqual(155)
    }
  })

  it("gives every page the Seed mark as its tab icon and the canvas of each palette as its theme colour", async () => {
    for (const path of ["/", "/pricing", "/subscribe"]) {
      const { html } = await page(path)

      expect(html, path).toContain(`<link rel="icon" type="image/svg+xml" href="/favicon.svg"`)
      expect(html, path).toContain(
        `<meta name="theme-color" content="#f3f4f6" media="(prefers-color-scheme: light)"`,
      )
      expect(html, path).toContain(
        `<meta name="theme-color" content="#080b10" media="(prefers-color-scheme: dark)"`,
      )
    }
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
      .map((match) => [linkText(match[1]), hrefOf(match[0])])
    expect(nav).toEqual(expect.arrayContaining([
      ["Features", "/features"],
      ["Compare", "/compare"],
      ["Pricing", "/pricing"],
      ["Hire me (opens antonshubin.com)", HIRE_PAGE_URL.replaceAll("&", "&amp;")],
      ["GitHub", REPOSITORY_URL],
      ["Try the demo", `${spa}/try`],
    ]))
    expect(linkNamed(header, "Sign in")).toBeUndefined()
    expect(hrefOf(linkNamed(footer, "Sign in"))).toBe(`${spa}/sign-in`)
    expect(header).not.toContain(`href="${site}/sign-`)
  })

  it("marks the header's Hire me as leaving the site: an icon after its label, and words for a screen reader", async () => {
    const header = element((await page("/")).html, "header")!
    const inner = (href: string) =>
      [...header.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
        .filter((match) => hrefOf(match[0]) === href).map((match) => match[1])

    // Once in the desktop row and once in the mobile panel.
    const hire = inner(HIRE_PAGE_URL.replaceAll("&", "&amp;"))
    expect(hire).toHaveLength(2)
    for (const link of hire) {
      expect(link).toMatch(
        /Hire me\s*<svg\b[^>]*aria-hidden="true"[\s\S]*<\/svg>\s*<span class="sr-only"> \(opens antonshubin\.com\)<\/span>\s*$/,
      )
    }
    for (const link of inner("/pricing")) expect(link).not.toContain("<svg")
  })

  const ogCards: [string, OgImageKey][] = [
    ["/", "home"],
    ["/admin", "admin"],
    ["/subscribe", "subscribe"],
    ["/pricing", "pricing"],
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

  it("names Seed a boilerplate in the home page's title and the comparison's description", async () => {
    const home = (await page("/")).html
    const compare = (await page("/compare")).html

    expect(home.match(/<title>([^<]*)<\/title>/)![1]).toContain("boilerplate")
    expect(metaContent(compare, "description")).toContain("boilerplates")
  })

  it("shows on /compare what each starter includes, Seed's gaps among them", async () => {
    const { headers, rows } = comparisonTable((await page("/compare")).html)
    const row = (capability: string) =>
      rows.find((candidate) => candidate.capability === capability)

    expect(headers).toEqual([
      "Seed",
      "ShipFast",
      "Supastarter",
      "Makerkit",
      "Next.js SaaS Starter",
      "Open SaaS",
    ])
    expect(row("App-based 2FA")?.values).toEqual(["Yes", "No", "Yes", "Yes", "No", "No"])
    expect(row("Passkeys")?.values).toEqual(["Yes", "No", "Yes", "Yes", "No", "No"])
    expect(row("Groups with roles")).toEqual({
      capability: "Groups with roles",
      note: "Next.js SaaS Starter: Owner and Member only",
      values: ["Yes", "No", "Yes", "Yes", "Partial", "No"],
    })
    // Every row names a value for every product.
    for (const { capability, values } of rows) {
      expect(values.length, capability).toBe(headers.length)
    }
  })

  it("opens the lead of each main page with one sentence that says what Seed is", async () => {
    for (const path of ["/", "/features", "/compare", "/pricing"]) {
      const { html } = await page(path)
      const lead = html.slice(html.indexOf("</h1>")).match(/<p\b[^>]*>([\s\S]*?)<\/p>/)![1]
        .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

      expect(lead, path).toMatch(/^Seed is a free, MIT-licensed SaaS starter[^.]*\./)
    }
  })

  it("calls 2FA, groups and per-member billing by one name, the app's, on every page", async () => {
    for (const { path } of SITE_PAGES) {
      const { html } = await page(path)
      // What a reader hears or a crawler reads: the text, and the alt, title, label and meta words.
      const words = [...html.matchAll(/\b(?:alt|title|aria-label|content)="([^"]*)"/g)]
        .map((match) => match[1])
      // "Product team" is the name of a sample group the admin panel video shows.
      const text = [html.replace(/<[^>]+>/g, " "), ...words].join(" ")
        .replaceAll("Product team", " ").replace(/\s+/g, " ")

      expect(text, path).not.toMatch(/second factor/i)
      expect(text, path).not.toMatch(/\b(?:teams?|seats?)\b/i)
      expect(text, path).not.toMatch(/server you own/i)
    }
  })

  it('names every link for where it goes, never a bare "Learn more"', async () => {
    // The generic texts Lighthouse's "Links do not have descriptive text" audit flags.
    const generic =
      /^(?:click here|click this|go|here|information|learn more|more|more info|more information|read more|right here|see more|start|this)$/i
    for (const { path } of SITE_PAGES) {
      const { html } = await page(path)
      const names = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((match) =>
        linkText(match[1])
      )

      expect(names.filter((name) => generic.test(name)), path).toEqual([])
    }
  })

  it("tells the footer's two links to antonshubin.com apart by what each opens", async () => {
    const footer = element((await page("/")).html, "footer")!

    expect(hrefOf(linkNamed(footer, "Hire me for an MVP"))).toBe(
      HIRE_PAGE_URL.replaceAll("&", "&amp;"),
    )
    expect(hrefOf(linkNamed(footer, "About Anton"))).toBe("https://antonshubin.com")
    expect(linkNamed(footer, "Hire me")).toBeUndefined()
  })

  it("says /compare's check day one way, as its hero's Checked line does", async () => {
    const { html } = await page("/compare")
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" })
      .format(new Date(`2026-10-16T00:00:00Z`))

    const days = text.match(
      /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/g,
    )
    expect(days?.length).toBeGreaterThan(2)
    expect(new Set(days)).toEqual(new Set([day]))
  })

  it("links the home page to the MVP offer on antonshubin.com, with text that says so", async () => {
    const { html } = await page("/")

    const link = hrefOf(linkNamed(html, "My MVP offer on antonshubin.com"))?.replaceAll(
      "&amp;",
      "&",
    )
    expect(link).toBe(HIRE_PAGE_URL)
    expect(link).toMatch(/^https:\/\/antonshubin\.com\/catalog\/zero-to-production-saas-mvp\?/)
    // The link beside it says what it opens, not a second "antonshubin.com".
    expect(hrefOf(linkNamed(html, "About me"))).toBe("https://antonshubin.com/about")
    expect(linkNamed(html, "antonshubin.com")).toBeUndefined()
  })

  it("links each Not built yet item on /features that has an open issue to that issue", async () => {
    const { html } = await page("/features")

    const links = [...html.matchAll(/<a href="([^"]*)"[^>]*>issue #(\d+)<\/a>/g)]
      .map(([, href, number]) => ({ href, number }))
    expect(links.length).toBeGreaterThan(0)
    for (const { href, number } of links) expect(href).toBe(`${REPOSITORY_URL}/issues/${number}`)
    // Translations are not built yet, and their issue is the place to follow them.
    expect(html).toMatch(
      new RegExp(
        `Translations: the app is English only \\(<a href="${REPOSITORY_URL}/issues/216"[^>]*>issue #216</a>\\)`,
      ),
    )
  })

  it("lists Download my data as built on the home page, /features, /compare and /privacy (#229)", async () => {
    const home = (await page("/")).html
    const features = (await page("/features")).html
    const compare = (await page("/compare")).html
    const privacy = (await page("/privacy")).html

    expect(home).toContain(`a download of your own data`)
    expect(features).toContain(`Download my data: a ZIP of JSON and CSV files`)
    expect(privacy).toContain(`choose Download my data in your profile`)
    for (const html of [home, features, compare, privacy]) {
      expect(html).not.toContain(`issues/229`)
      expect(html).not.toContain(`Downloading an account&#39;s data`)
      expect(html).not.toContain(`downloading an account&#39;s data`)
      expect(html).not.toContain(`Downloading an account's data`)
      expect(html).not.toContain(`downloading an account's data`)
    }
  })

  it("lists passkeys on /features as built, not under Not built yet", async () => {
    const { html } = await page("/features")

    expect(html).toContain(`or sign in with a passkey, or try the app first`)
    expect(html).toContain(`Passkeys: only the public key is stored`)
    expect(html).toContain(`Google and GitHub sign-in, passkeys, magic links, guest accounts, 2FA`)
    expect(html).not.toContain(`issues/222`)
  })

  it("lists magic links as built on the home page, /features and /compare (#391)", async () => {
    const home = (await page("/")).html
    const features = (await page("/features")).html
    const { rows } = comparisonTable((await page("/compare")).html)

    expect(home).toContain(`passkeys, magic links, 2FA`)
    expect(features).toContain(`Magic links: one link signs in or signs up`)
    expect(rows.find((row) => row.capability === "Magic links")?.values[0]).toBe("Yes")
    // No "Not built yet" list, and no "gaps" line, names them any more.
    for (const html of [home, features]) expect(html).not.toMatch(/>\s*Magic links\s*</)
  })

  it("lists note attachments as built on the home page, /features, /compare and /pricing (#225)", async () => {
    const home = (await page("/")).html
    const features = (await page("/features")).html
    const { rows } = comparisonTable((await page("/compare")).html)
    const pricing = (await page("/pricing")).html

    expect(home).toContain(`Images and PDFs attached to notes`)
    expect(features).toContain(`notes keep images and PDFs in it`)
    expect(rows.find((row) => row.capability === "File uploads")?.values[0]).toBe("Yes")
    expect(pricing).toContain(`100 files, 200 MB in all`)
    for (const html of [home, features]) {
      expect(html).not.toContain(`no screen uses`)
      expect(html).not.toContain(`issues/225`)
    }
  })

  it("ends /features with its questions, listed under On this page and in its structured data", async () => {
    const { html } = await page("/features")
    const graph = jsonLdGraph(html)

    const faqAt = html.indexOf(`<section id="faq"`)
    expect(faqAt).toBeGreaterThan(html.indexOf(`id="quality"`))
    expect(faqAt).toBeLessThan(html.indexOf(`aria-labelledby="cta-title"`))
    expect(html).toContain(`href="#faq"`)
    const faq = graph.find((entity) => entity["@type"] === "FAQPage")!
    const questions = (faq.mainEntity as { name: string }[]).map((question) => question.name)
    expect(questions.length).toBeGreaterThanOrEqual(3)
    for (const question of questions) {
      expect(question).toMatch(/^Can Seed /)
      expect(html).toContain(`>${question}<`)
    }
  })

  it("describes the home page as the site, the source code, its author and its questions", async () => {
    const { html } = await page("/")
    const graph = jsonLdGraph(html)

    expect(graph.flatMap((entity) => entity["@type"])).toEqual(
      expect.arrayContaining(["WebSite", "SoftwareSourceCode", "Person", "FAQPage"]),
    )
    const source = graph.find((entity) => isType(entity, "SoftwareSourceCode"))!
    expect(source.codeRepository).toBe(REPOSITORY_URL)
    const faq = graph.find((entity) => entity["@type"] === "FAQPage")!
    const questions = (faq.mainEntity as { name: string }[]).map((question) => question.name)
    expect(questions.length).toBeGreaterThan(0)
    for (const question of questions) expect(html).toContain(`>${question}<`)
  })

  it("describes Seed as one product, with one id that the pages about it point at", async () => {
    const home = graphIds(jsonLdGraph((await page("/")).html))

    for (const { path } of SITE_PAGES) {
      const graph = jsonLdGraph((await page(path)).html)
      const { defined, referenced } = graphIds(graph)

      for (const id of referenced) {
        expect(defined.has(id) || home.defined.has(id), `${path} points at ${id}`).toBe(true)
      }
      for (const entity of graph) {
        if (isType(entity, "SoftwareApplication") || isType(entity, "SoftwareSourceCode")) {
          expect(entity["@id"], path).toBe(`${site}/#software`)
        }
      }
    }
    for (const path of ["/", "/features", "/admin", "/compare", "/pricing"]) {
      const { defined, referenced } = graphIds(jsonLdGraph((await page(path)).html))
      expect(defined.has(`${site}/#software`) || referenced.has(`${site}/#software`), path)
        .toBe(true)
    }
  })

  it("names the author's profiles and company, as antonshubin.com does", async () => {
    const graph = jsonLdGraph((await page("/")).html)

    const person = graph.find((entity) => isType(entity, "Person"))!
    expect(person.sameAs).toEqual(expect.arrayContaining([
      "https://github.com/spy4x",
      "https://www.linkedin.com/in/anton-shubin",
      "https://www.upwork.com/freelancers/ashubin",
    ]))
    expect(person.worksFor).toMatchObject({
      "@type": "Organization",
      "@id": "https://neatsoft.dev/#org",
      name: "NeatSoft PTE LTD",
    })
  })

  it("roots every page's breadcrumb trail at the home page's full address", async () => {
    // The home page is the root itself, and the newsletter page has no structured data.
    for (const { path } of SITE_PAGES.filter(({ path }) => path !== "/" && path !== "/subscribe")) {
      const graph = jsonLdGraph((await page(path)).html)
      const crumbs = graph.find((entity) => isType(entity, "BreadcrumbList"))

      expect(crumbs, path).toBeDefined()
      expect((crumbs!.itemListElement as unknown[])[0], path).toEqual({
        "@type": "ListItem",
        position: 1,
        name: "Seed",
        item: `${site}/`,
      })
    }
  })

  it("describes a legal page as a page of the site, one step below the home page", async () => {
    for (const [path, name] of [["/privacy", "Privacy"], ["/terms", "Terms"]]) {
      const graph = jsonLdGraph((await page(path)).html)

      const webPage = graph.find((entity) => entity["@type"] === "WebPage")
      expect(webPage, path).toMatchObject({
        url: `${site}${path}`,
        isPartOf: { "@id": `${site}/#website` },
      })
      const crumbs = graph.find((entity) => entity["@type"] === "BreadcrumbList")
      expect(crumbs?.itemListElement, path).toEqual([
        { "@type": "ListItem", position: 1, name: "Seed", item: `${site}/` },
        { "@type": "ListItem", position: 2, name, item: `${site}${path}` },
      ])
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

  it("says Seed is free, prices running it and having it built, and sends the founder to the hire page", async () => {
    const { status, html } = await page("/pricing")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("Seed is free. Here is what it costs to run.")
    expect(html).toContain(`<title>${PRICING_HEAD.title}</title>`)
    for (const card of ["way-use", "way-run", "way-hire"]) expect(html).toContain(`id="${card}"`)
    expect(html).toContain(">$0</span>")
    expect(html).toContain(">From $8,000</span>")
    // It leaves the site, so its name says where it goes.
    expect(hrefOf(linkNamed(html, "See how it works (opens antonshubin.com)"))).toBe(
      HIRE_PAGE_URL.replaceAll("&", "&amp;"),
    )
    expect(html).toContain(`<link rel="canonical" href="${site}/pricing"`)
  })

  it("names no price above $0 in the pricing page's description", async () => {
    const { html } = await page("/pricing")

    for (const key of ["description", "og:description"]) {
      const description = metaContent(html, key)!
      expect(description, key).toContain("free")
      expect(description.match(/\$\s?[\d,.]+/g) ?? [], key).toEqual(
        description.match(/\$0\b/g) ?? [],
      )
    }
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

    const software = graph.find((entity) => isType(entity, "SoftwareApplication"))!
    expect(software.offers).toEqual({ "@type": "Offer", price: 0, priceCurrency: "USD" })
    const offers = JSON.stringify(graph).match(/"@type":"Offer"/g)
    expect(offers).toHaveLength(1)
    expect(graph.map((entity) => entity["@type"])).toEqual(
      expect.arrayContaining(["Person", "FAQPage", "BreadcrumbList"]),
    )
  })

  it("answers /mvp with a permanent redirect to the hire page on antonshubin.com", async () => {
    const response = await handler(new Request(`${site}/mvp`), info)

    expect(response.status).toBe(301)
    expect(response.headers.get("location")).toBe(HIRE_PAGE_URL)
    expect(HIRE_PAGE_URL).toMatch(
      /^https:\/\/antonshubin\.com\/catalog\/zero-to-production-saas-mvp\?utm_source=seedsaas&/,
    )
  })

  it("shows the API reference from docs/token-api.md, with its sections and the footer link to it", async () => {
    const { status, html } = await page("/docs/api")

    expect(status).toBe(200)
    expect(headingOne(html)).toBe("API reference")
    expect(html).toContain(`<h2 id="quick-start">Quick start</h2>`)
    expect(hrefOf(linkNamed(html, "Quick start"))).toBe("#quick-start")
    expect(hrefOf(linkNamed(html, "API docs"))).toBe("/docs/api")
    expect(hrefOf(linkNamed(html, "docs/token-api.md"))).toBe(
      `${REPOSITORY_URL}/blob/main/docs/token-api.md`,
    )
  })

  it("answers /docs with a permanent redirect to the API reference", async () => {
    const response = await handler(new Request(`${site}/docs`), info)

    expect(response.status).toBe(301)
    expect(response.headers.get("location")).toBe("/docs/api")
  })

  it("sends every hire link on the site to the hire page, and none to /mvp", async () => {
    // The listed pages, and the not-found page every unknown address gets.
    for (const path of [...SITE_PAGES.map((entry) => entry.path), "/no-such-page"]) {
      const { html } = await page(path)

      expect(html, path).not.toMatch(/href="(https:\/\/www\.example\.com)?\/mvp"/)
    }
    const hire = HIRE_PAGE_URL.replaceAll("&", "&amp;")
    const notFound = await page("/no-such-page")
    expect(notFound.status).toBe(404)
    expect(hrefOf(linkNamed(notFound.html, "Hire me to build your MVP"))).toBe(hire)
    const home = (await page("/")).html
    expect(home.match(/<a\b[^>]*data-umami-event="hire-me"[^>]*>/g)?.length).toBeGreaterThan(0)
    for (const link of home.match(/<a\b[^>]*data-umami-event="hire-me"[^>]*>/g)!) {
      expect(link).toContain(`href="${hire}"`)
    }
  })

  it("names the trial of every plan that has one, with its length from the catalog", async () => {
    const { html } = await page("/pricing")

    const withTrial = PLANS.filter((plan) => plan.trialDays > 0)
    expect(withTrial.length).toBeGreaterThan(0)
    for (const plan of withTrial) expect(html).toContain(`The first ${plan.trialDays} days free`)
    expect(html.match(/days free/g)).toHaveLength(withTrial.length)
  })

  it("names every demo plan's button with its visible text, then the plan", async () => {
    const { html } = await page("/pricing")

    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter((match) => match[1].includes(`type="submit"`) && match[2].includes("demo"))
    expect(buttons).toHaveLength(PLANS.length)
    for (const [index, plan] of PLANS.entries()) {
      const [, attributes, content] = buttons[index]
      const visible = content.replace(/<[^>]+>/g, "").trim()
      const name = attributes.match(/aria-label="([^"]*)"/)?.[1]
      expect(name, plan.name).toBe(`${visible}: ${plan.name}`)
    }
  })

  it("sends a plan chosen without JavaScript to the app's /try, which opens the demo as a guest", async () => {
    const response = await handler(
      new Request(`${site}/pricing`, {
        method: "POST",
        headers: { origin: site, "sec-fetch-site": "same-origin" },
        body: new URLSearchParams({ planId: PLANS[0].id }),
      }),
      info,
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe(`${spa}/try`)
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

  it("offers the newsletter form once on the home page, in its content, and not again in the footer", async () => {
    const home = (await page("/")).html
    const pricing = (await page("/pricing")).html

    expect(home.match(/<form method="post" action="\/subscribe"/g)).toHaveLength(1)
    expect(home).not.toContain(`id="footer-news"`)
    expect(hrefOf(linkNamed(home, "Privacy"))).toBe("/privacy")
    // A page without the form in its content keeps the footer's.
    expect(pricing).toContain(`id="footer-news"`)
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
      SITE_PAGES.filter(({ path }) => path !== "/subscribe").map(({ path }) => `${site}${path}`),
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
      [
        "/",
        "/features",
        "/admin",
        "/compare",
        "/pricing",
        "/docs/api",
        "/subscribe",
        "/privacy",
        "/terms",
      ]
        .map((path) => `${site}${path}`),
    )
  })

  it("dates a sitemap entry only where its page states a date", async () => {
    const xml = await (await handler(new Request(`${site}/sitemap.xml`), info)).text()
    const lastmods = Object.fromEntries(
      [...xml.matchAll(/<loc>([^<]+)<\/loc>\n(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
        .map((match) => [match[1].slice(site.length), match[2]]),
    )

    expect(lastmods).toEqual({
      "/": undefined,
      "/features": "2026-10-21T00:00:00.000Z",
      "/admin": "2026-10-21T00:00:00.000Z",
      "/docs/api": "2026-10-23T00:00:00.000Z",
      "/compare": "2026-10-16T00:00:00.000Z",
      "/pricing": "2026-10-21T00:00:00.000Z",
      "/subscribe": undefined,
      "/privacy": "2026-10-23T00:00:00.000Z",
      "/terms": "2026-10-21T00:00:00.000Z",
    })
  })

  it("marks every link to the app's /try outside the footer nofollow, since opening it makes an account", async () => {
    for (const path of ["/", "/features", "/pricing", "/compare"]) {
      const { html } = await page(path)
      const outsideFooter = html.slice(0, html.indexOf("<footer"))
      const links = [...outsideFooter.matchAll(/<a\b[^>]*>/g)].map((match) => match[0])
        .filter((tag) => hrefOf(tag) === `${spa}/try`)
      expect(links.length, path).toBeGreaterThan(0)
      for (const tag of links) expect(tag, path).toMatch(/\brel="nofollow"/)
    }
  })

  it("answers on the home page whether Seed can be tried without an account, answer first", async () => {
    const { html } = await page("/")
    const faq = jsonLdGraph(html).find((entity) => entity["@type"] === "FAQPage")!
    const question = (faq.mainEntity as { name: string; acceptedAnswer: { text: string } }[])
      .find((entry) => entry.name === "Can I try it without an account?")!

    expect(question.acceptedAnswer.text).toMatch(
      /^Yes\. Try the live demo opens the app in a guest account/,
    )
    expect(html).toContain(`Guest accounts: try the app with one click`)
  })

  it("says on the privacy page that a guest account's cookie lasts a year from its last use", async () => {
    const { html } = await page("/privacy")

    expect(html).toContain(`two months, or for a guest account one year`)
    expect(html).toContain(`A guest account that stays empty is deleted after 7 days`)
  })

  it("shows on each legal page the same day its sitemap entry carries", async () => {
    const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" })
    for (
      const [path, updated] of [["/privacy", PRIVACY_HEAD.updated], ["/terms", TERMS_HEAD.updated]]
    ) {
      const { html } = await page(path)

      expect(html, path).toContain(`Last changed ${day.format(new Date(`${updated}T00:00:00Z`))}`)
    }
  })

  it("names the author and the sitemap's day under the hero of /compare, /pricing and /features", async () => {
    // /compare's day is when its rows were checked against the other products, so it says so.
    const word: Record<string, string> = { "/compare": "Checked" }
    const updated = Object.fromEntries(SITE_PAGES.map((entry) => [entry.path, entry.updated]))
    const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" })
    for (const path of ["/compare", "/pricing", "/features"]) {
      const { html } = await page(path)
      const meta = html.match(/<p [^>]*data-e2e="page-hero-meta"[^>]*>([\s\S]*?)<\/p>/)?.[1]

      expect(meta, path).toContain(`By <a`)
      expect(hrefOf(linkNamed(meta ?? "", "Anton Shubin")), path).toBe("https://antonshubin.com")
      expect(meta, path).toContain(
        `${word[path] ?? "Updated"} <time datetime="${updated[path]}">` +
          `${day.format(new Date(`${updated[path]}T00:00:00Z`))}</time>`,
      )
      expect(html.indexOf("page-hero-meta"), path).toBeGreaterThan(
        html.indexOf("Try the live demo"),
      )
    }
  })

  it("draws no dated line on the home page, keeps the date out of /compare's lead and puts its disclosure under the byline", async () => {
    const { html: home } = await page("/")
    const { html: compare } = await page("/compare")

    expect(home).not.toContain("page-hero-meta")
    const hero = compare.slice(
      compare.indexOf(`data-e2e="page-hero"`),
      compare.indexOf(`data-e2e="page-hero-meta"`),
    )
    expect(hero).toContain("Here it is side by side with five other SaaS starters")
    expect(hero).not.toContain("<time")
    expect(hero).not.toContain("I am not neutral")
    const note = compare.slice(compare.indexOf(`data-e2e="page-hero-meta"`))
      .match(/<p [^>]*data-e2e="page-hero-note"[^>]*>([\s\S]*?)<\/p>/)?.[1]
    expect(note).toContain("I build Seed, so I am not neutral.")
    expect(note).toContain("A row out of date?")
  })

  it("takes each page's title and description in the page list from the page's own head", async () => {
    for (const { path, title, description } of SITE_PAGES) {
      const { html } = await page(path)

      expect(metaContent(html, "description"), path).toBe(description)
      const shown = html.match(/<title>([^<]*)<\/title>/)![1].replaceAll("&#39;", "'")
      expect(shown.startsWith(title), `${path}: ${shown}`).toBe(true)
    }
  })

  it("lists every public page in llms.txt with its title, address and description", async () => {
    const response = await handler(new Request(`${site}/llms.txt`), info)
    const text = await response.text()

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(text).toMatch(/^# Seed\n\n> Free, MIT-licensed SaaS starter/)
    for (const { path, title, description } of SITE_PAGES) {
      expect(text, path).toContain(`- [${title}](${site}${path}): ${description}\n`)
    }
    expect(text).toContain(`(${REPOSITORY_URL})`)
  })

  it("leaves the newsletter page out of llms.txt while subscriptions are off", async () => {
    const text = await (await withoutNewsletter(new Request(`${site}/llms.txt`), info)).text()

    expect(text).not.toContain(`${site}/subscribe)`)
    expect(text).toContain(`${site}/terms)`)
  })

  it("names each AI search bot in robots.txt with the same rules as every other crawler", async () => {
    const text = await (await handler(new Request(`${site}/robots.txt`), info)).text()
    const rules = "Disallow: /subscribe/confirm\nDisallow: /unsubscribe\nAllow: /\n"

    for (const agent of ["*", "OAI-SearchBot", "PerplexityBot", "Claude-SearchBot", "Bingbot"]) {
      expect(text, agent).toContain(`User-agent: ${agent}\n${rules}`)
    }
    expect(text).not.toContain("Google-Extended")
    expect(text).not.toMatch(/Disallow: \/\n/)
    expect(text).toContain(`Sitemap: ${site}/video-sitemap.xml`)
  })

  it("lists the admin panel video on its page in the video sitemap", async () => {
    const response = await handler(new Request(`${site}/video-sitemap.xml`), info)
    const xml = await response.text()

    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8")
    expect(xml).toContain(`<url><loc>${site}/admin</loc><video:video>`)
    expect(xml).toContain(`<video:content_loc>${site}/`)
  })

  it("loads no tracker and no script of its own while analytics is off", async () => {
    for (const path of ["/", "/pricing", "/privacy"]) {
      const { html } = await page(path)
      expect(html, path).not.toContain("script.js")
      expect(html, path).not.toContain("/analytics.js")
    }
  })

  it("loads Umami's tracker, counting only on its own host and honouring Do Not Track, then its own events", async () => {
    const { html } = await page("/", withAnalytics)

    const tracker = html.match(/<script[^>]*src="https:\/\/stats\.example\.com\/script\.js"[^>]*>/)
      ?.[0]
    expect(tracker).toContain(`data-website-id="${UMAMI.websiteId}"`)
    expect(tracker).toContain(`data-domains="www.example.com"`)
    expect(tracker).toContain(`data-do-not-track="true"`)
    expect(tracker).toContain("defer")
    const own = html.match(/<script[^>]*src="\/analytics\.js"[^>]*>/)?.[0]
    expect(own).toContain(`data-spa-origin="${spa}"`)
    expect(own).toContain(`data-repository="${REPOSITORY_URL}"`)
    // Umami runs first: the website's events call the tracker it defines.
    expect(html.indexOf("stats.example.com/script.js")).toBeLessThan(html.indexOf("/analytics.js"))
  })

  it("leaves the tracker out of a page whose address carries a newsletter token", async () => {
    const { html } = await page("/unsubscribe?list=news&token=secret-token", withAnalytics)

    expect(html).not.toContain("script.js")
    expect(html).not.toContain("/analytics.js")
  })

  it("names the demo links of the header and the hero, the hire link and the newsletter form for Umami", async () => {
    const { html } = await page("/", withAnalytics)

    const tryDemo = html.match(/<a[^>]*data-e2e="site-try-demo"[^>]*>/)?.[0]
    expect(tryDemo).toContain(`data-umami-event="try-demo"`)
    expect(tryDemo).toContain(`data-umami-event-from="header"`)
    const heroDemo = html.match(/<a[^>]*data-e2e="home-try-demo"[^>]*>/)?.[0]
    expect(heroDemo).toContain(`data-umami-event-from="hero"`)
    expect(html.match(/<a[^>]*data-e2e="home-founders"[^>]*>/)?.[0]).toContain(
      `data-umami-event="hire-me"`,
    )
    expect(html.match(/<form[^>]*data-e2e="home-subscribe"[^>]*>/)?.[0]).toContain(
      `data-analytics-submit="newsletter-subscribe"`,
    )
  })

  it("says on the privacy page that visits are counted in a self-hosted Umami without cookies, and what it records", async () => {
    const { html } = await page("/privacy", withAnalytics)

    expect(html).toContain(`<h2 id="statistics">Visitor statistics</h2>`)
    expect(html).toContain("counts visits with Umami, which I host myself")
    expect(html).toContain("It sets no cookies")
    expect(html).toContain("If your browser sends Do Not Track, nothing is counted.")
    expect(html).not.toContain("There are no advertising cookies, no analytics")
  })

  it("says on the privacy page that no visits are counted while analytics is off", async () => {
    const { html } = await page("/privacy")

    expect(html).toContain("This website keeps no visitor statistics, and neither does the demo.")
    expect(html).not.toContain("Umami")
  })
})
