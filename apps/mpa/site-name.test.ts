import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import type { Catalog } from "@spy4x/platform/universal/i18n"
import AppWrapper from "./routes/_app.tsx"
import Home from "./routes/index.tsx"
import { handler as subscribe } from "./routes/[[lang]]/subscribe/index.ts"
import { pageMiddleware } from "./middleware.ts"
import { SITE_NAME } from "./brand.ts"
import { localePath, SITE_LANGUAGES, siteTranslator } from "./languages.ts"
import type { State } from "./utils.ts"
import siteEn from "@i18n/site/en.ts"
import siteRu from "@i18n/site/ru.ts"
import siteEs from "@i18n/site/es.ts"
import siteDe from "@i18n/site/de.ts"
import sitePtBr from "@i18n/site/pt-BR.ts"
import siteAr from "@i18n/site/ar.ts"

/**
 * A product built on Seed sets `SITE_NAME` and `SITE_ICON` in `brand.ts` to rename its newsletter
 * (#472). The name is a module constant that equals "Seed" here, so a rendered page cannot tell it
 * from a literal "Seed". The catalog test makes sure no newsletter message spells a name; the
 * render tests make sure the pages fill the name into the neutral wording.
 */

const CATALOGS: Record<string, Catalog> = {
  en: siteEn,
  ru: siteRu,
  es: siteEs,
  de: siteDe,
  "pt-BR": sitePtBr,
  ar: siteAr,
}

/** The components whose words the newsletter's pages, the home band and the footer form show. */
const NEWSLETTER_KEYS =
  /^(NewsletterPage|NewsletterOff|NewsletterForm|HomeNewsletter|FooterNewsletter|SubscribeForm|SubscribeFailure|SubscriptionConfirm|Unsubscribe)\./

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>
const neverCalled = () => Promise.reject(new Error("the website called the API"))
const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

function siteWith(newsletter: () => boolean) {
  return new App<State>()
    .use(pageMiddleware(config, neverCalled, newsletter))
    .appWrapper(view(AppWrapper))
    .route("/", { component: view(Home) })
    .get("{/:lang}?/subscribe", subscribe.GET!)
    .handler()
}

async function html(path: string, newsletter = true): Promise<string> {
  const response = await siteWith(() => newsletter)(
    new Request(`${config.webAppOrigin}${path}`),
    info,
  )
  return await response.text()
}

/** What a reader sees of `markup`: its tags dropped and its whitespace collapsed. */
function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim()
}

describe("the newsletter under another product's name", () => {
  for (const [language, catalog] of Object.entries(CATALOGS)) {
    it(`spells no product name in a newsletter message, so SITE_NAME fills it (${language})`, () => {
      const named = Object.entries(catalog)
        .filter(([key]) => NEWSLETTER_KEYS.test(key))
        .filter(([, message]) => /\bSeed\b/.test(JSON.stringify(message)))
        .map(([key]) => key)

      expect(named).toEqual([])
    })
  }

  for (const language of SITE_LANGUAGES) {
    it(`shows the product's name in the subscribe page's title, brand mark and heading (${language})`, async () => {
      const t = siteTranslator(language)
      const page = await html(localePath(language, "/subscribe"))

      expect(page).toContain(
        `<title>${t.t(`NewsletterPage.subscribeTitle`, { site: SITE_NAME })}</title>`,
      )
      const about = page.match(/<section\b[^>]*aria-label="[^"]*"[^>]*>[\s\S]*?<\/section>/)?.[0]
      expect(text(about ?? "")).toMatch(
        new RegExp(`^${SITE_NAME} ${t.t(`NewsletterPage.heading`, { site: SITE_NAME })} `),
      )
    })
  }

  it("shows the product's name on the page shown while the newsletter is off", async () => {
    const page = await html("/subscribe", false)

    expect(page).toMatch(new RegExp(`<h1\\b[^>]*>The ${SITE_NAME} newsletter</h1>`))
  })

  it("fills the product's name into the home page's newsletter band", async () => {
    const page = await html("/")

    const title = page.match(/<h2\b[^>]*id="newsletter-title"[^>]*>([\s\S]*?)<\/h2>/)?.[1]
    expect(text(title ?? "")).toBe(`Get a short email when ${SITE_NAME} has news`)
  })
})
