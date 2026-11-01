// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { IconArrowRight, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"
import { Band } from "../../components/band.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import {
  FeatureSection,
  type FeatureSectionProps,
  FeatureTier,
} from "../../components/features-section.tsx"
import { SectionIntro } from "../../components/section-intro.tsx"
import { ShotViewer } from "../../components/shot-viewer.tsx"
import { featurePath, pageOfFeature, tiers } from "../../features-data.tsx"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  sectionLinks,
  SITE_AUTHOR,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareJsonLd,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../../site.tsx"
import { type Site, useSite } from "../../use-site.tsx"
import { define } from "../../utils.ts"

/**
 * The day this page's feature list or wording last changed: the hero's "Updated" line and the
 * sitemap's `lastmod`. Change it with them.
 */
export const FEATURES_UPDATED = `2026-11-01`

/** The page's title and description in the language of `t`. */
export function featuresHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Features.title`), description: t.t(`Features.description`) }
}

/** The page's head in English, for the page list. */
export const FEATURES_HEAD = featuresHead(siteEnglishText())

/**
 * What a visitor asks that the sections above do not answer, with each answer as plain text for the
 * FAQ's structured data. Each answer's first sentence stands alone, in 40 words or fewer.
 */
const FAQ = [
  {
    id: `faq-serverless`,
    question: `FeaturesFaq.serverlessQuestion`,
    answer: `FeaturesFaq.serverlessAnswer`,
  },
  {
    id: `faq-runtime`,
    question: `FeaturesFaq.runtimeQuestion`,
    answer: `FeaturesFaq.runtimeAnswer`,
  },
  {
    id: `faq-database`,
    question: `FeaturesFaq.databaseQuestion`,
    answer: `FeaturesFaq.databaseAnswer`,
  },
  { id: `faq-native`, question: `FeaturesFaq.nativeQuestion`, answer: `FeaturesFaq.nativeAnswer` },
] as const

/** The questions in the language of `t`, each answer as plain text for the structured data. */
function faqItems(t: Translator<string>) {
  return FAQ.map(({ id, question, answer }) => ({
    id,
    question: t.t(question),
    answerText: t.t(answer),
  }))
}

/** The page's structured data: the software, its questions, and the page's place. */
function featuresJsonLd(site: Site, origin: string): unknown[] {
  return [
    softwareJsonLd(origin, {
      featureList: tiers(site).flatMap((tier) => tier.features.map((feature) => feature.nav)),
    }),
    PERSON_JSON_LD,
    faqPageJsonLd(faqItems(site.t)),
    siteBreadcrumbsJsonLd(origin, `/features`, site.t.t(`SiteNav.features`), site.language),
  ]
}

/**
 * The "Read more about {feature}" link of a section that has a page of its own: a feature page
 * (English at every address) or, for the admin panel, `/admin`.
 */
function readMore(
  { t, href }: Site,
  id: string,
  name: string,
): FeatureSectionProps["more"] {
  const label = t.t(`FeatureSection.readMore`, { feature: name })
  if (id === `admin`) return { label, href: href(`/admin`) }
  const page = pageOfFeature(id)
  return page && { label, href: featurePath(page.slug), language: `en` }
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  const { t } = useSite()
  return (
    <PageHero
      class="site-glow"
      eyebrow={t.t(`SiteNav.features`)}
      title={t.t(`FeaturesHero.title`)}
      lead={t.t(`FeaturesHero.lead`)}
      author={SITE_AUTHOR}
      updated={FEATURES_UPDATED}
      note={t.t(`FeaturesHero.note`)}
    >
      <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
        <Button
          href={demoHref}
          rel={TRY_REL}
          size="lg"
          data-e2e="features-try-demo"
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
  )
}

/**
 * `/features`: every capability, grouped by what it is for, each with what people notice, what a
 * developer gets, what is not built yet and a link to the code. One ask: try the demo.
 */
export default define.page(function Features({ state }) {
  const site = useSite()
  const { t, href } = site
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...featuresHead(t),
    og: `features`,
    jsonLd: featuresJsonLd(site, state.webAppOrigin),
  }
  const sections = tiers(site)
  const nav = [
    ...sections.flatMap((tier) =>
      tier.features.map((feature) => ({ label: feature.nav, href: `#${feature.id}` }))
    ),
    { label: t.t(`HomeFaq.eyebrow`), href: `#faq` },
  ]
  return (
    <SiteFrame state={state} path="/features" head={head}>
      <Hero demoHref={spa.try} />
      <div class="mx-auto grid w-full max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-16">
        <div class="lg:col-span-3 xl:col-span-2">
          <OnThisPage links={sectionLinks(nav)} />
        </div>
        <div class="flex min-w-0 flex-col gap-16 lg:col-span-9 xl:col-span-10">
          {sections.map(({ features, ...tier }) => (
            <FeatureTier key={tier.id} {...tier}>
              {features.map(({ nav, shots: _shots, ...feature }, index) => (
                <FeatureSection
                  key={feature.id}
                  {...feature}
                  more={readMore(site, feature.id, nav)}
                  flip={index % 2 === 1}
                />
              ))}
            </FeatureTier>
          ))}
          {/* Seed's own site: see docs/start-a-product.md */}
          <a
            href={href(`/compare`)}
            class="inline-flex items-center gap-1 self-start py-2 text-lg font-medium text-primary hover:underline"
            data-e2e="features-compare"
          >
            {t.t(`Features.compare`)} <IconArrowRight class="size-5" aria-hidden="true" />
          </a>
        </div>
      </div>
      <Band tone="alt" id="faq" labelledBy="faq-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro
            id="faq-title"
            eyebrow={t.t(`HomeFaq.eyebrow`)}
            title={t.t(`FeaturesFaq.title`)}
          />
          <FaqList
            items={faqItems(t).map((item) => ({
              id: item.id,
              question: item.question,
              answer: <p>{item.answerText}</p>,
            }))}
          />
        </div>
      </Band>
      <CtaBand demoHref={spa.try} />
      <ShotViewer />
    </SiteFrame>
  )
})
