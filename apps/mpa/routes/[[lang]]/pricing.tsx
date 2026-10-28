// Seed's own site: see docs/start-a-product.md
import { IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { Band } from "../../components/band.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import { PricingDemoPlans } from "../../components/pricing-demo-plans.tsx"
import { PricingWays } from "../../components/pricing-ways.tsx"
import { SectionIntro } from "../../components/section-intro.tsx"
import { HIRE_PAGE_URL, HIRE_PRICES } from "../../hire.ts"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_AUTHOR,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareJsonLd,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../../site.tsx"
import { useSite } from "../../use-site.tsx"
import { define } from "../../utils.ts"
import type { Language } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"

/**
 * The day this page's prices or wording last changed: the hero's "Updated" line and the sitemap's
 * `lastmod`. Change it with them.
 */
export const PRICING_UPDATED = `2026-10-21`

/** The page's title and description in the language of `t`. */
export function pricingHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Pricing.title`), description: t.t(`Pricing.description`) }
}

/** The page's head in English, for the page list. */
export const PRICING_HEAD = pricingHead(siteEnglishText())

/** The questions by their catalog keys, each written out so the catalog test finds it. */
const FAQ = [
  { id: `faq-paid`, question: `PricingFaq.paidQuestion`, answer: `PricingFaq.paidAnswer` },
  { id: `faq-server`, question: `PricingFaq.serverQuestion`, answer: `PricingFaq.serverAnswer` },
  { id: `faq-owe`, question: `PricingFaq.oweQuestion`, answer: `PricingFaq.oweAnswer` },
  { id: `faq-mvp-price`, question: `PricingFaq.mvpQuestion`, answer: `PricingFaq.mvpAnswer` },
] as const

/** The questions in the language of `t`, each answer as plain text for the structured data. */
function faqItems(t: Translator<string>) {
  return FAQ.map(({ id, question, answer }) => ({
    id,
    question: t.t(question, { price: HIRE_PRICES.mvpFrom }),
    answerText: t.t(answer),
  }))
}

/** The page's structured data: Seed as free software, its author, the questions and the trail. */
function pricingJsonLd(t: Translator<string>, origin: string, language: Language): unknown[] {
  return [
    softwareJsonLd(origin),
    PERSON_JSON_LD,
    faqPageJsonLd(faqItems(t)),
    siteBreadcrumbsJsonLd(origin, `/pricing`, t.t(`Pricing.crumb`), language),
  ]
}

/**
 * `GET` shows what Seed costs and, below, the demo app's plans. `POST` is where a plan's "Try in
 * the demo" form goes without JavaScript, in every language: plans are chosen inside the app, so it sends the visitor
 * to the app's `/try`, which opens the demo as a guest account (#224).
 */
export const handler = define.handlers({
  POST(ctx) {
    return ctx.redirect(spaLinks(ctx.state.spaOrigin).try, 303)
  },
})

/**
 * The pricing page: Seed is free, running it costs one server, and having it built starts at
 * Anton's price. The demo's plans follow as an example of the billing, never as Seed's prices.
 */
export default define.page(function Pricing({ state }) {
  const { t, language } = useSite()
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...pricingHead(t),
    og: `pricing`,
    jsonLd: pricingJsonLd(t, state.webAppOrigin, language),
  }
  return (
    <SiteFrame state={state} path="/pricing" head={head}>
      <PageHero
        class="site-glow"
        eyebrow={t.t(`PricingHero.eyebrow`)}
        title={t.t(`PricingHero.title`)}
        lead={t.t(`PricingHero.lead`)}
        author={SITE_AUTHOR}
        updated={PRICING_UPDATED}
      >
        <div class="flex w-full flex-col gap-4 pt-2 sm:w-auto sm:flex-row">
          <Button
            href={spa.try}
            rel={TRY_REL}
            size="lg"
            data-e2e="pricing-try-demo"
            data-umami-event="try-demo"
            data-umami-event-from="hero"
          >
            {t.t(TRY_ENTRY.label)}
          </Button>
          <Button
            href={REPOSITORY_URL}
            variant="outline"
            size="lg"
            data-umami-event="github"
            data-umami-event-from="hero"
          >
            <IconGitHub class="size-5" aria-hidden="true" /> {t.t(`HomeHero.github`)}
          </Button>
        </div>
      </PageHero>
      <PricingWays />
      <PricingDemoPlans />
      <Band id="faq" labelledBy="faq-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro
            id="faq-title"
            eyebrow={t.t(`HomeFaq.eyebrow`)}
            title={t.t(`PricingFaq.title`)}
          />
          <FaqList
            items={faqItems(t).map((item) => ({
              id: item.id,
              question: item.question,
              answer: item.id === `faq-mvp-price`
                ? (
                  <p>
                    {item.answerText}{" "}
                    <a href={HIRE_PAGE_URL} class="text-primary underline">
                      {t.t(`PricingFaq.mvpLink`)}
                    </a>.
                  </p>
                )
                : <p>{item.answerText}</p>,
            }))}
          />
        </div>
      </Band>
      <CtaBand demoHref={spa.try} />
    </SiteFrame>
  )
})
