import { Steps } from "@spy4x/preact-ui/steps"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { breadcrumbListJsonLd, faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { Band } from "../components/band.tsx"
import { MvpCallBand } from "../components/mvp-call-band.tsx"
import { MvpHero } from "../components/mvp-hero.tsx"
import { MvpIncludes } from "../components/mvp-includes.tsx"
import { MvpPromises } from "../components/mvp-promises.tsx"
import { MvpProof } from "../components/mvp-proof.tsx"
import { ProofStrip } from "../components/proof-strip.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import { BOOK_CALL_URL, BRIEF_URL, HIRE_PRICES } from "../hire.ts"
import { PERSON_JSON_LD, SITE_NAME, SiteFrame, type SitePageHead } from "../site.tsx"
import { define } from "../utils.ts"

/** The page's title and description, as search results and social previews show them. */
export const MVP_HEAD = {
  title: `Build your SaaS MVP: from ${HIRE_PRICES.mvpFrom}, live from ${HIRE_PRICES.mvpWeeks}`,
  description: `I build your SaaS MVP from idea to a live product people can sign up for and ` +
    `pay for. From ${HIRE_PRICES.mvpFrom}, from ${HIRE_PRICES.mvpWeeks}. You own the code and ` +
    `servers from day one.`,
} as const

/** Price, time and risk, the three things a founder asks first. */
const TERMS = [
  {
    value: `From ${HIRE_PRICES.mvpFrom}`,
    label: `You get a quote for your scope before any work starts.`,
  },
  {
    value: `From ${HIRE_PRICES.mvpWeeks}`,
    label: `to a live product, depending on what it needs to do.`,
  },
  {
    value: `Five-day refund`,
    label: `If in the first five days you feel it is not working, I refund what you paid.`,
  },
] as const

const STEPS = [
  {
    title: `A free 30-minute call`,
    text:
      `You tell me the idea; I tell you honestly what I would build first and roughly what it ` +
      `costs.`,
  },
  {
    title: `A short discovery sprint`,
    text: `You get a diagram of the system, the risks, a monthly running-cost estimate and a ` +
      `build plan with dates. It is part of the first milestone, and you keep it.`,
  },
  {
    title: `A small first milestone of one or two weeks`,
    text: `If either of us wants to stop after it, we stop, and you keep everything built so far.`,
  },
  {
    title: `Working software every week`,
    text: `With a short written update. Calls when they help, not on a schedule for its own sake.`,
  },
  {
    title: `Launch and handoff`,
    text: `Code, accounts, servers and keys are in your name from day one, not at the end.`,
  },
] as const

/** The questions, with each answer as plain text for the FAQ's structured data. */
const FAQ = [
  {
    id: `faq-who`,
    question: `Who does the work?`,
    answerText: `I do. For larger projects I bring in senior developers from my own pool, and ` +
      `only seniors.`,
  },
  {
    id: `faq-technical`,
    question: `Do I need to know anything technical?`,
    answerText: `No. I explain every decision in plain words, with its cost and its trade-off, ` +
      `and you choose.`,
  },
  {
    id: `faq-fixed`,
    question: `Fixed price or hourly?`,
    answerText: `Fixed price when the scope is fixed, hourly when it is open-ended. A change to ` +
      `the scope gets a quote before I start on it, so there are no surprise costs.`,
  },
  {
    id: `faq-handover`,
    question: `Can I hire another developer later?`,
    answerText: `Yes. You own the code and the servers, and Seed is public and documented, so ` +
      `any TypeScript developer can pick it up.`,
  },
  {
    id: `faq-mobile`,
    question: `Do you build mobile apps?`,
    answerText: `Not native ones yet. Your product works in the phone's browser and can be ` +
      `installed on the home screen, and I build the backend a mobile app would use.`,
  },
  {
    id: `faq-ai`,
    question: `Does my code go to an AI provider?`,
    answerText: `Yes: I work with AI coding agents and review every change myself before you ` +
      `see it. If your company has its own AI account, I can work through it; if your policy ` +
      `rules AI out, we agree how to handle it before work starts.`,
  },
  {
    id: `faq-idea`,
    question: `What if I don't have a clear idea yet?`,
    answerText: `Send a paragraph about your idea or problem and I will write back with three ` +
      `concrete suggestions. No cost, no pitch. Or book a ${HIRE_PRICES.strategySession} ` +
      `strategy session if you want a full hour.`,
  },
] as const

/**
 * The page's structured data: the service and its starting price, its provider, the questions and
 * the trail. No review markup: reviews of one's own service are not eligible for it.
 */
function mvpJsonLd(origin: string): unknown[] {
  return [
    {
      "@type": `Service`,
      name: `SaaS MVP built on ${SITE_NAME}`,
      serviceType: `Software development`,
      areaServed: `Worldwide`,
      url: `${origin}/mvp`,
      provider: { "@id": PERSON_JSON_LD["@id"] },
      offers: {
        "@type": `Offer`,
        url: BOOK_CALL_URL,
        priceSpecification: {
          "@type": `PriceSpecification`,
          minPrice: HIRE_PRICES.mvpFromUsd,
          priceCurrency: `USD`,
        },
      },
    },
    PERSON_JSON_LD,
    faqPageJsonLd(FAQ),
    breadcrumbListJsonLd(`${origin}/mvp`, [
      { name: SITE_NAME, href: `/` },
      { name: `Build my MVP` },
    ]),
  ]
}

/**
 * The founders page: the outcome, price, time and risk first, then what the product includes,
 * why it costs less on Seed, how the work runs, proof, the promises, questions and the call. One
 * ask throughout: book a free call. No newsletter: founders came to hire.
 */
export default define.page(function Mvp({ state }) {
  const head: SitePageHead = {
    ...MVP_HEAD,
    og: `mvp`,
    jsonLd: mvpJsonLd(state.webAppOrigin),
  }
  return (
    <SiteFrame state={state} path="/mvp" head={head} footerNewsletter={false}>
      <MvpHero />
      <ProofStrip facts={TERMS} />
      <MvpIncludes />
      <Band tone="alt" id="why-seed" labelledBy="why-title" width="3xl">
        <div class="flex flex-col gap-6">
          <SectionIntro
            id="why-title"
            eyebrow="Why it costs less"
            title="You don't pay me to rebuild sign-up screens"
          />
          <p class="text-lg text-muted text-pretty">
            Every product needs sign-in, teams, payments, emails, backups and a way to deploy. Built
            from scratch, that is weeks of work before your idea even starts. I keep those parts in
            Seed, my own open-source foundation, with browser tests that run on every change. Your
            project starts from there, so the weeks you pay for go to your product. And because Seed
            is public, any developer you hire later can read how it works.
          </p>
          <a href="/features" class="self-start py-2 font-medium text-primary underline">
            See what is already built
          </a>
        </div>
      </Band>
      <Band id="how" labelledBy="how-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro id="how-title" eyebrow="How it works" title="How we work together" />
          <Steps items={STEPS} />
          <p class="text-muted text-pretty">
            If the scope changes once we have started, you get a quote for the change before I work
            on it.
          </p>
        </div>
      </Band>
      <MvpProof />
      <MvpPromises />
      <Band tone="alt" id="faq" labelledBy="faq-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro id="faq-title" eyebrow="Questions" title="Before you book" />
          <FaqList
            items={FAQ.map((item) => ({
              id: item.id,
              question: item.question,
              answer: item.id === `faq-idea`
                ? (
                  <p>
                    <a href={BRIEF_URL} class="text-primary underline">
                      Send a paragraph about your idea or problem
                    </a>{" "}
                    and I will write back with three concrete suggestions. No cost, no pitch. Or
                    book a {HIRE_PRICES.strategySession} strategy session if you want a full hour.
                  </p>
                )
                : <p>{item.answerText}</p>,
            }))}
          />
        </div>
      </Band>
      <MvpCallBand />
    </SiteFrame>
  )
})
