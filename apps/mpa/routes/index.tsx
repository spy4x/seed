import type { JSX } from "preact"
import { appAddress } from "../brand.ts"
import type { PublicContactLink } from "@domain/contact-links"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import {
  IconArrowRight,
  IconCheck,
  IconCreditCard,
  IconGitHub,
  IconGlobe,
  IconMinus,
  IconServer,
  IconShieldCheck,
  IconUsers,
  IconZap,
} from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { FeatureCard } from "@spy4x/preact-ui/feature-card"
import { Input } from "@spy4x/preact-ui/input"
import { StatusMark } from "@spy4x/preact-ui/status-mark"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { ArchitectureDiagram } from "../components/architecture-diagram.tsx"
import { Band } from "../components/band.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import { FoundersHandoff } from "../components/founders-handoff.tsx"
import { ProofStrip } from "../components/proof-strip.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import { PairShot } from "../components/features-visuals.tsx"
import { Shot } from "../components/shot.tsx"
import { organizationJsonLd } from "../contact-links.ts"
import { HIRE_PAGE_URL } from "../hire.ts"
import {
  AUTHOR_URL,
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_NAME,
  SiteFrame,
  type SitePageHead,
  softwareId,
  softwareJsonLd,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../site.tsx"
import { languageList, SITE_LANGUAGES } from "../languages.ts"
import { code, TerminalText, useSite } from "../use-site.tsx"
import { define } from "../utils.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"

// Seed's own site: see docs/start-a-product.md (also the llms.txt summary)
/** The home page's title and description in the language of `t`. */
export function homeHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Home.title`), description: t.t(`Home.description`) }
}

/** The home page's head in English, for the page list and `llms.txt`. */
export const HOME_HEAD = homeHead(siteEnglishText())

/**
 * Facts a visitor can check in the repository. Counted on 2026-10-16: `ls e2e/*.e2e.ts`,
 * `git ls-files '*.test.ts*'` and the merged pull requests on GitHub.
 */
const PROOF = [
  { value: `34 · 232`, label: `HomeProof.tests` },
  { value: `208`, label: `HomeProof.pulls` },
  { value: `MIT`, label: `HomeProof.licence` },
] as const

/**
 * The quick start, one command per line, as the README runs it. No line carries a `#` comment:
 * interactive zsh, the macOS default, passes a comment's words to the command.
 */
export const QUICK_START = [
  `gh repo create my-product --template spy4x/seed --private --clone`,
  `cd my-product`,
  `deno task init`,
  `deno task dev`,
] as const

/**
 * What a reader can paste into an AI agent instead of typing the quick start: English in every
 * language, since agents read it best and the product's name stays as typed.
 */
export const AI_PROMPT = siteEnglishText().t(`HomeHero.aiPrompt`)

/** What works today, by catalog key; `HomeStatus.languages` names the languages. */
const WORKS_TODAY = [
  `HomeStatus.signIn`,
  `HomeStatus.guests`,
  `HomeStatus.groups`,
  `HomeStatus.export`,
  `HomeStatus.attachments`,
  `HomeStatus.billing`,
  `HomeStatus.account`,
  `HomeStatus.tokens`,
  `HomeStatus.realtime`,
  `HomeStatus.telegram`,
  `HomeStatus.admin`,
  `HomeStatus.website`,
  `HomeStatus.languages`,
] as const

const NOT_BUILT = [`HomeStatus.notBuiltMail`, `HomeStatus.notBuiltRtl`] as const

/** The questions by their catalog keys, each written out so the catalog test finds it. */
const FAQ = [
  { id: `faq-try`, question: `HomeFaq.tryQuestion`, answer: `HomeFaq.tryAnswer` },
  { id: `faq-free`, question: `HomeFaq.freeQuestion`, answer: `HomeFaq.freeAnswer` },
  { id: `faq-stack`, question: `HomeFaq.stackQuestion`, answer: `HomeFaq.stackAnswer` },
  { id: `faq-client-work`, question: `HomeFaq.clientQuestion`, answer: `HomeFaq.clientAnswer` },
  {
    id: `faq-production`,
    question: `HomeFaq.productionQuestion`,
    answer: `HomeFaq.productionAnswer`,
  },
] as const

/** The questions in the language of `t`, each answer as plain text for the structured data. */
function faqItems(t: Translator<string>) {
  return FAQ.map(({ id, question, answer }) => ({
    id,
    question: t.t(question),
    answerText: t.t(answer),
  }))
}

/**
 * The page's structured data: the site, the software and its author, the questions, and the
 * organization with its contact links once there are any.
 */
function homeJsonLd(
  t: Translator<string>,
  origin: string,
  contactLinks: readonly PublicContactLink[],
): unknown[] {
  const organization = organizationJsonLd(origin, contactLinks)
  return [
    {
      "@type": `WebSite`,
      "@id": `${origin}/#website`,
      name: SITE_NAME,
      url: `${origin}/`,
      inLanguage: SITE_LANGUAGES,
      publisher: { "@id": PERSON_JSON_LD["@id"] },
      about: { "@id": softwareId(origin) },
    },
    softwareJsonLd(origin),
    PERSON_JSON_LD,
    faqPageJsonLd(faqItems(t)),
    ...(organization ? [organization] : []),
  ]
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  const { t, rich } = useSite()
  return (
    <section aria-labelledby="hero-title" class="relative overflow-hidden">
      <div aria-hidden="true" class="site-grid pointer-events-none absolute inset-0" />
      <div class="site-glow relative">
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div class="mx-auto flex max-w-3xl flex-col items-start gap-6 sm:items-center sm:text-center">
            <Badge href={REPOSITORY_URL} text={t.t(`HomeHero.badge`)} type="outline" />
            <h1
              id="hero-title"
              class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl"
            >
              {t.t(`HomeHero.title`)}
            </h1>
            <p class="text-lg text-muted text-pretty">{t.t(`HomeHero.lead`)}</p>
            <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
              <Button
                href={demoHref}
                rel={TRY_REL}
                size="lg"
                data-e2e="home-try-demo"
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
                <IconGitHub class="size-5" /> {t.t(`HomeHero.github`)}
              </Button>
            </div>
            <p class="text-sm text-muted">
              {t.t(TRY_ENTRY.line)} {rich(`HomeHero.status`, {
                status: (text) => <a href="#status" class="text-primary underline">{text}</a>,
              })}
            </p>
          </div>
          {/* Reading order is text, then code, then picture; from `lg` the code overlaps the picture. */}
          <div class="relative flex flex-col gap-6 lg:block lg:pb-12">
            <WindowFrame
              variant="terminal"
              title={t.t(`HomeHero.quickStart`)}
              class="lg:absolute lg:bottom-0 lg:start-0 lg:z-10 lg:w-2xl"
              caption={
                <span>{rich(`HomeHero.initNote`, { code, prompt: () => <AiPrompt /> })}</span>
              }
            >
              <TerminalText>{QUICK_START.map((line) => `$ ${line}`).join(`\n`)}</TerminalText>
            </WindowFrame>
            <WindowFrame
              variant="browser"
              title={appAddress(`/notes`)}
              class="lg:ms-auto lg:w-5/6"
            >
              <Shot
                name="notes"
                alt={t.t(`HomeHero.notesAlt`)}
                sizes="(min-width: 1024px) 960px, 100vw"
                priority
              />
            </WindowFrame>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The plan alone, captured on a phone from the empty canvas above its "Plan and billing" heading to
 * the canvas below the "Pro plan" card: at most 390 px wide, so the card shows it whole at about its
 * real size. It sits in the middle of the card's picture area on the same canvas colour.
 */
function BillingCrop(): JSX.Element {
  const { t } = useSite()
  return (
    <div class="flex h-94 items-center overflow-hidden bg-canvas">
      <div class="w-full max-w-[390px]">
        <Shot
          name="billing-plan"
          kind="mobile"
          height={416}
          alt={t.t(`HomeFeatures.billingAlt`)}
          sizes="390px"
        />
      </div>
    </div>
  )
}

function Features(): JSX.Element {
  const { t, href } = useSite()
  return (
    <Band id="features" labelledBy="features-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="features-title"
          eyebrow={t.t(`HomeFeatures.eyebrow`)}
          title={t.t(`HomeFeatures.title`)}
          lead={t.t(`HomeFeatures.lead`)}
        />
        <div class="grid gap-6 lg:grid-cols-3">
          <FeatureCard
            id="feature-sign-in"
            title={t.t(`HomeFeatures.signInTitle`)}
            Icon={IconShieldCheck}
            href={href(`/features#sign-in`)}
            linkLabel={t.t(`HomeFeatures.signInLink`)}
            wide
            media={
              <Shot
                name="profile-security"
                alt={t.t(`HomeFeatures.signInAlt`)}
                sizes="(min-width: 1024px) 640px, 100vw"
              />
            }
          >
            {t.t(`HomeFeatures.signInText`)}
          </FeatureCard>
          <FeatureCard
            id="feature-billing"
            title={t.t(`HomeFeatures.billingTitle`)}
            Icon={IconCreditCard}
            href={href(`/features#billing`)}
            linkLabel={t.t(`HomeFeatures.billingLink`)}
            media={<BillingCrop />}
          >
            {t.t(`HomeFeatures.billingText`)}
          </FeatureCard>
          <FeatureCard
            id="feature-realtime"
            title={t.t(`HomeFeatures.realtimeTitle`)}
            Icon={IconZap}
            href={href(`/features#realtime`)}
            linkLabel={t.t(`HomeFeatures.realtimeLink`)}
            media={
              <div class="h-94 overflow-hidden">
                {/* As wide as the card up to 416 px, so the Save button is never cut. */}
                <div class="w-full max-w-104">
                  <PairShot
                    name="realtime-a"
                    alt={t.t(`HomeFeatures.realtimeAlt`)}
                    sizes="416px"
                  />
                </div>
              </div>
            }
          >
            {t.t(`HomeFeatures.realtimeText`)}
          </FeatureCard>
          <FeatureCard
            id="feature-teams"
            title={t.t(`HomeFeatures.groupsTitle`)}
            Icon={IconUsers}
            href={href(`/features#teams`)}
            linkLabel={t.t(`HomeFeatures.groupsLink`)}
            wide
            media={
              <div class="aspect-[1280/470] overflow-hidden lg:flex lg:aspect-auto lg:h-94 lg:justify-center lg:bg-canvas">
                {/* Members only, no plan; from lg on, as tall as the realtime card beside it. */}
                <div class="lg:w-[640px] lg:shrink-0 lg:overflow-hidden" dir="ltr">
                  <div class="lg:w-[1024px] lg:-translate-x-[221.6px]">
                    <Shot
                      name="group-members"
                      alt={t.t(`HomeFeatures.groupsAlt`)}
                      sizes="(min-width: 1024px) 1024px, 100vw"
                    />
                  </div>
                </div>
              </div>
            }
          >
            {t.t(`HomeFeatures.groupsText`)}
          </FeatureCard>
          {/* The card draws its own link; Umami counts a click on anything inside this wrapper. */}
          <div class="contents" data-umami-event="home-admin-card">
            <FeatureCard
              id="feature-admin"
              title={t.t(`HomeFeatures.adminTitle`)}
              Icon={IconServer}
              href={href(`/admin`)}
              linkLabel={t.t(`HomeFeatures.adminLink`)}
            >
              {t.t(`HomeFeatures.adminText`)}
            </FeatureCard>
          </div>
          <FeatureCard
            id="feature-website"
            title={t.t(`HomeFeatures.websiteTitle`)}
            Icon={IconGlobe}
            href={href(`/features#website`)}
            linkLabel={t.t(`HomeFeatures.websiteLink`)}
          >
            {t.t(`HomeFeatures.websiteText`)}
          </FeatureCard>
          <a
            href={href(`/features`)}
            class="site-lift flex items-center justify-between gap-4 rounded-card border border-dashed border-strong p-6 text-lg font-semibold hover:border-primary"
            data-e2e="home-all-features"
          >
            {t.t(`HomeFeatures.all`)}
            <IconArrowRight class="size-5 text-primary rtl:-scale-x-100" />
          </a>
        </div>
      </div>
    </Band>
  )
}

function OneServer(): JSX.Element {
  const { t, rich } = useSite()
  return (
    <Band tone="alt" id="one-server" labelledBy="one-server-title">
      <div class="grid items-center gap-12 lg:grid-cols-2">
        <div class="flex flex-col gap-6">
          <SectionIntro
            id="one-server-title"
            eyebrow={t.t(`HomeServer.eyebrow`)}
            title={rich(`HomeServer.title`, { code })}
          />
          <p class="text-muted text-pretty">{t.t(`HomeServer.text`)}</p>
          <p class="text-sm text-muted">{t.t(`HomeServer.skip`)}</p>
        </div>
        <ArchitectureDiagram />
      </div>
    </Band>
  )
}

/** A command or an address inside the quick start's text, in the foreground colour. */
function command(text: string): JSX.Element {
  return <code dir="ltr" class="font-mono text-foreground">{text}</code>
}

function QuickStart(): JSX.Element {
  const { t, rich } = useSite()
  return (
    <Band id="quick-start" labelledBy="quick-start-title">
      <div class="grid gap-8 lg:grid-cols-12 lg:items-start">
        <div class="flex flex-col gap-4 lg:col-span-5">
          <SectionIntro
            id="quick-start-title"
            eyebrow={t.t(`HomeHero.quickStart`)}
            title={t.t(`HomeQuickStart.title`)}
          />
          <p class="text-muted">{t.t(`HomeQuickStart.needs`)}</p>
          <p class="text-muted text-pretty">
            {rich(`HomeQuickStart.text`, {
              init: command,
              dev: command,
              url: command,
              readme: (text) => (
                <a href={`${REPOSITORY_URL}#readme`} class="text-primary underline">{text}</a>
              ),
            })}
          </p>
          <p class="text-muted text-pretty">
            {rich(`HomeQuickStart.agent`, { prompt: () => <AiPrompt /> })}
          </p>
        </div>
        <WindowFrame
          variant="terminal"
          title={t.t(`HomeQuickStart.terminal`)}
          class="min-w-0 lg:col-span-7"
        >
          <TerminalText>{QUICK_START.map((line) => `$ ${line}`).join(`\n`)}</TerminalText>
        </WindowFrame>
      </div>
    </Band>
  )
}

/**
 * The AI prompt as one block of code that a single click selects whole, in English and left to
 * right on every page.
 */
function AiPrompt(): JSX.Element {
  return <code lang="en" dir="ltr" class="font-mono text-foreground select-all">{AI_PROMPT}</code>
}

function Status(): JSX.Element {
  const { t, language } = useSite()
  const languages = languageList(language)
  return (
    <Band tone="alt" id="status" labelledBy="status-title">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="status-title"
          eyebrow={t.t(`HomeStatus.eyebrow`)}
          title={t.t(`HomeStatus.title`)}
          lead={t.t(`HomeStatus.lead`)}
        />
        <div class="grid gap-6 md:grid-cols-2">
          <Card role="region" aria-labelledby="works-title" class="rounded-card bg-canvas p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id="works-title" class="text-lg font-semibold">{t.t(`HomeStatus.works`)}</h3>
              <StatusMark status="ready" />
            </div>
            <ul class="mt-4 flex flex-col gap-3">
              {WORKS_TODAY.map((item) => (
                <li key={item} class="flex items-start gap-2">
                  <IconCheck class="mt-1 size-4 shrink-0 text-primary" />
                  <span class="text-pretty">{t.t(item, { languages })}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card role="region" aria-labelledby="not-built-title" class="rounded-card bg-canvas p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id="not-built-title" class="text-lg font-semibold">
                {t.t(`HomeStatus.notBuilt`)}
              </h3>
              <StatusMark status="wip" />
            </div>
            <ul class="mt-4 flex flex-col gap-3">
              {NOT_BUILT.map((item) => (
                <li key={item} class="flex items-start gap-2">
                  <IconMinus class="mt-1 size-4 shrink-0 text-muted" />
                  <span class="text-pretty">{t.t(item)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <a
          href={`${REPOSITORY_URL}/issues`}
          class="inline-flex items-center gap-1 self-start font-medium text-primary hover:underline"
        >
          {t.t(`HomeStatus.follow`)} <IconArrowRight class="size-4 rtl:-scale-x-100" />
        </a>
      </div>
    </Band>
  )
}

// Seed's own site: see docs/start-a-product.md
function WhoBuilds(): JSX.Element {
  const { t } = useSite()
  return (
    <Band id="who" labelledBy="who-title" width="3xl">
      <div class="flex flex-col gap-6">
        <SectionIntro
          id="who-title"
          eyebrow={t.t(`HomeWho.eyebrow`)}
          title={t.t(`HomeWho.title`)}
        />
        <p class="text-lg text-muted text-pretty">{t.t(`HomeWho.text`)}</p>
        <ul class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
          <li>
            <a
              href={HIRE_PAGE_URL}
              class="text-primary underline"
              data-e2e="home-hire-page"
              data-umami-event="hire-me"
              data-umami-event-from="who"
            >
              {t.t(`HomeWho.offer`)}
            </a>
          </li>
          <li>
            <a href={`${AUTHOR_URL}/about`} class="text-primary underline">
              {t.t(`HomeWho.about`)}
            </a>
          </li>
          <li>
            <a
              href="https://www.upwork.com/freelancers/ashubin"
              class="text-primary underline"
            >
              {t.t(`HomeWho.upwork`)}
            </a>
          </li>
          <li>
            <a href={`${REPOSITORY_URL}/issues`} class="text-primary underline">
              {t.t(`HomeWho.issues`)}
            </a>
          </li>
        </ul>
      </div>
    </Band>
  )
}

function Newsletter(): JSX.Element {
  const { t, href } = useSite()
  return (
    <Band tone="alt" id="newsletter" labelledBy="newsletter-title" width="3xl">
      <div class="flex flex-col gap-6">
        <SectionIntro
          id="newsletter-title"
          title={t.t(`HomeNewsletter.title`)}
          lead={t.t(`HomeNewsletter.lead`)}
        />
        <form
          method="post"
          action={href(FORM_ACTIONS.subscribe)}
          class="flex flex-col gap-2"
          data-e2e="home-subscribe"
          data-analytics-submit="newsletter-subscribe"
        >
          <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
          <label for="home-email" class="text-sm font-medium">{t.t(`NewsletterForm.email`)}</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              id="home-email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder={t.t(`NewsletterForm.placeholder`)}
              required
              aria-describedby="home-email-hint"
              data-e2e="home-subscribe-email"
            />
            <Button type="submit" data-e2e="home-subscribe-submit">
              {t.t(`NewsletterForm.submit`)}
            </Button>
          </div>
          <p id="home-email-hint" class="text-sm text-muted">{t.t(`HomeNewsletter.hint`)}</p>
        </form>
      </div>
    </Band>
  )
}

function Questions(): JSX.Element {
  const { t, href, rich } = useSite()
  return (
    <Band id="faq" labelledBy="faq-title" width="3xl">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="faq-title"
          eyebrow={t.t(`HomeFaq.eyebrow`)}
          title={t.t(`HomeFaq.title`)}
        />
        <FaqList
          items={faqItems(t).map((item) => ({
            id: item.id,
            question: item.question,
            answer: item.id === `faq-stack`
              ? (
                <p>
                  {rich(`HomeFaq.stackAnswer`, {
                    code: (text) => <code>{text}</code>,
                    // Seed's own site: see docs/start-a-product.md
                    compare: (text) => (
                      <a href={href(`/compare`)} class="text-primary underline">{text}</a>
                    ),
                  })}
                </p>
              )
              : <p>{item.answerText}</p>,
          }))}
        />
      </div>
    </Band>
  )
}

/**
 * The home page: what Seed is and the way into the demo first, then proof, the features, how it
 * runs, the quick start, what works today, the way in for founders, who builds it, the newsletter
 * and the questions. One ask throughout: try the demo. `/` in the default language and `/<language>`
 * in every other (`routes/[lang]/index.tsx`).
 */
export default define.page(function Home({ state }) {
  const { t } = useSite()
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...homeHead(t),
    og: `home`,
    jsonLd: homeJsonLd(t, state.webAppOrigin, state.contactLinks ?? []),
  }
  return (
    <SiteFrame state={state} path="/" head={head} footerNewsletter={false}>
      <Hero demoHref={spa.try} />
      <ProofStrip facts={PROOF.map((fact) => ({ value: fact.value, label: t.t(fact.label) }))} />
      <Features />
      <OneServer />
      <QuickStart />
      <Status />
      {/* Seed's own site: see docs/start-a-product.md */}
      <FoundersHandoff />
      <WhoBuilds />
      {state.newsletter && <Newsletter />}
      <Questions />
      <CtaBand demoHref={spa.try} />
    </SiteFrame>
  )
})
