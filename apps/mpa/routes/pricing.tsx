import { IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { breadcrumbListJsonLd, faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { Band } from "../components/band.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import { PageHero } from "../components/page-hero.tsx"
import { PricingDemoPlans } from "../components/pricing-demo-plans.tsx"
import { PricingWays } from "../components/pricing-ways.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import { HIRE_PRICES } from "../hire.ts"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_NAME,
  SiteFrame,
  type SitePageHead,
  spaLinks,
} from "../site.tsx"
import { define } from "../utils.ts"

/** The page's title and description, as search results and social previews show them. */
export const PRICING_HEAD = {
  title: `Seed pricing: free, MIT, on your own server`,
  description: `Seed costs nothing: MIT licence, no paid tier. You pay for one server and the ` +
    `services you turn on. Want it built for you? MVPs on Seed start at ${HIRE_PRICES.mvpFrom}.`,
} as const

/** The questions, with each answer as plain text for the FAQ's structured data. */
const FAQ = [
  {
    id: `faq-paid`,
    question: `Is there a paid version of Seed?`,
    answerText: `No. There is no pro tier, no licence key and no feature held back. If you want ` +
      `help, you can hire me; that is the only thing I sell.`,
  },
  {
    id: `faq-server`,
    question: `What does a server cost?`,
    answerText: `Whatever your host charges for one Linux machine with Docker. Seed has no ` +
      `per-user or per-request fees of its own.`,
  },
  {
    id: `faq-owe`,
    question: `Do I owe anything if my product makes money?`,
    answerText: `No. MIT asks only that you keep its copyright and licence notice with the code.`,
  },
  {
    id: `faq-mvp-price`,
    question: `How is the ${HIRE_PRICES.mvpFrom} worked out?`,
    answerText: `It is the starting price of a typical MVP: sign-up, payments, an API, an admin ` +
      `area and deployment. Your quote depends on your features and is fixed before work starts.`,
  },
] as const

/** The page's structured data: Seed as free software, its author, the questions and the trail. */
function pricingJsonLd(origin: string): unknown[] {
  return [
    {
      "@type": `SoftwareApplication`,
      name: SITE_NAME,
      url: `${origin}/`,
      applicationCategory: `DeveloperApplication`,
      operatingSystem: `Linux (Docker)`,
      license: `https://opensource.org/licenses/MIT`,
      author: { "@id": PERSON_JSON_LD["@id"] },
      // Only Seed itself is offered here. The demo's plans are an example and are not sold.
      offers: { "@type": `Offer`, price: 0, priceCurrency: `USD` },
    },
    PERSON_JSON_LD,
    faqPageJsonLd(FAQ),
    breadcrumbListJsonLd(`${origin}/pricing`, [
      { name: SITE_NAME, href: `/` },
      { name: `Pricing` },
    ]),
  ]
}

/**
 * `GET` shows what Seed costs and, below, the demo app's plans. `POST` is where a plan's "Try in
 * the demo" form goes without JavaScript: plans are chosen inside the app, so it sends the visitor
 * to the app's sign-up.
 */
export const handler = define.handlers({
  POST(ctx) {
    return ctx.redirect(spaLinks(ctx.state.spaOrigin).signUp, 303)
  },
})

/**
 * The pricing page: Seed is free, running it costs one server, and having it built starts at
 * Anton's price. The demo's plans follow as an example of the billing, never as Seed's prices.
 */
export default define.page(function Pricing({ state }) {
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...PRICING_HEAD,
    og: `pricing`,
    jsonLd: pricingJsonLd(state.webAppOrigin),
  }
  return (
    <SiteFrame state={state} path="/pricing" head={head}>
      <PageHero
        eyebrow="Pricing"
        title="Seed is free. Here is what it costs to run."
        lead="MIT licence, no paid tier, no account needed. You pay for one server and for the services you choose to turn on."
      >
        <div class="flex w-full flex-col gap-4 pt-2 sm:w-auto sm:flex-row">
          <Button href={spa.signUp} size="lg" data-e2e="pricing-try-demo">
            Try the live demo
          </Button>
          <Button href={REPOSITORY_URL} variant="outline" size="lg">
            <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
          </Button>
        </div>
      </PageHero>
      <PricingWays />
      <PricingDemoPlans />
      <Band id="faq" labelledBy="faq-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro id="faq-title" eyebrow="Questions" title="About the price" />
          <FaqList
            items={FAQ.map((item) => ({
              id: item.id,
              question: item.question,
              answer: item.id === `faq-mvp-price`
                ? (
                  <p>
                    {item.answerText}{" "}
                    <a href="/mvp" class="text-primary underline">How an MVP build works</a>.
                  </p>
                )
                : <p>{item.answerText}</p>,
            }))}
          />
        </div>
      </Band>
      <CtaBand demoHref={spa.signUp} />
    </SiteFrame>
  )
})
