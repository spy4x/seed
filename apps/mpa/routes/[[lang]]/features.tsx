// Seed's own site: see docs/start-a-product.md
import { appAddress } from "../../brand.ts"
import type { JSX } from "preact"
import { IconArrowRight, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { Band } from "../../components/band.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import {
  FeatureSection,
  type FeatureSectionProps,
  FeatureTier,
  type FeatureTierProps,
} from "../../components/features-section.tsx"
import {
  AggregateFiles,
  DeployVisual,
  OfflinePair,
  OutboxDiagram,
  RealtimePair,
} from "../../components/features-visuals.tsx"
import { AdminVideoStill } from "../../components/admin-video.tsx"
import { ADMIN_TOUR_MODULES } from "../../admin-modules.ts"
import { ADMIN_VIDEO } from "../../admin-video.ts"
import { SectionIntro } from "../../components/section-intro.tsx"
import { Shot } from "../../components/shot.tsx"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { useFormat } from "@spy4x/preact-ui/format"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
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
import { languageList } from "../../languages.ts"
import { type Site, useSite } from "../../use-site.tsx"
import { define } from "../../utils.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"

/**
 * The day this page's feature list or wording last changed: the hero's "Updated" line and the
 * sitemap's `lastmod`. Change it with them.
 */
export const FEATURES_UPDATED = `2026-10-31`

/** The day the Quality section's tests were counted. */
const TESTS_COUNTED_ON = `2026-10-16`

/**
 * The Quality section's lead, with {@link TESTS_COUNTED_ON} in the site's short form, as the hero's
 * "Updated" line writes its date. A component, so it reads the site's formatter inside the frame.
 */
function QualityLead(): JSX.Element {
  const { t } = useSite()
  return <>{t.t(`FeatureQuality.lead`, { date: useFormat().utc().date(TESTS_COUNTED_ON) })}</>
}

/** The page's title and description in the language of `t`. */
export function featuresHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Features.title`), description: t.t(`Features.description`) }
}

/** The page's head in English, for the page list. */
export const FEATURES_HEAD = featuresHead(siteEnglishText())

/** A file or folder of the repository on GitHub, for the "where in the code" links. */
function source(path: string): string {
  const kind = path.endsWith(`/`) ? `tree` : `blob`
  return `${REPOSITORY_URL}/${kind}/main/${path.replace(/\/$/, ``)}`
}

/** A feature as the page lists it, without the side its picture goes on: the tier decides that. */
type Feature = Omit<FeatureSectionProps, "flip"> & { nav: string }

/** One group of features with its heading, status line and features, in page order. */
interface Tier extends Omit<FeatureTierProps, "children"> {
  features: readonly Feature[]
}

/**
 * Every claim below was checked against the code on 2026-10-16; the "where in the code" link of each
 * section points at it. Issue numbers are the open issues that track what is missing.
 */
function tiers({ t, href, rich, language }: Site): readonly Tier[] {
  return [
    {
      id: `settled`,
      eyebrow: t.t(`FeatureTierSettled.eyebrow`),
      title: t.t(`FeatureTierSettled.title`),
      lead: t.t(`FeatureTierSettled.lead`),
      status: t.t(`FeatureTierSettled.status`),
      features: [
        {
          id: `sign-in`,
          nav: t.t(`FeatureSignIn.nav`),
          eyebrow: t.t(`FeatureSignIn.eyebrow`),
          title: t.t(`FeatureSignIn.title`),
          lead: t.t(`FeatureSignIn.lead`),
          facts: [
            t.t(`FeatureSignIn.fact1`),
            t.t(`FeatureSignIn.fact2`),
            t.t(`FeatureSignIn.fact3`),
            t.t(`FeatureSignIn.fact4`),
            t.t(`FeatureSignIn.fact5`),
            t.t(`FeatureSignIn.fact6`),
            t.t(`FeatureSignIn.fact7`),
          ],
          code: { label: t.t(`FeatureSignIn.code`), href: source(`apps/api/services/sign-in.ts`) },
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/profile/security`)}>
              <Shot
                name="profile-security"
                alt={t.t(`HomeFeatures.signInAlt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `teams`,
          nav: t.t(`FeatureTeams.nav`),
          eyebrow: t.t(`FeatureTeams.eyebrow`),
          title: t.t(`FeatureTeams.title`),
          lead: t.t(`FeatureTeams.lead`),
          facts: [
            t.t(`FeatureTeams.fact1`),
            t.t(`FeatureTeams.fact2`),
            t.t(`FeatureTeams.fact3`),
            t.t(`FeatureTeams.fact4`),
          ],
          code: { label: t.t(`FeatureTeams.code`), href: source(`libs/domain/groups/`) },
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/groups/…/activity`)}>
              <Shot
                name="activity"
                alt={t.t(`FeatureTeams.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `overview`,
          nav: t.t(`FeatureOverview.nav`),
          eyebrow: t.t(`FeatureOverview.eyebrow`),
          title: t.t(`FeatureOverview.title`),
          lead: t.t(`FeatureOverview.lead`),
          facts: [
            t.t(`FeatureOverview.fact1`),
            t.t(`FeatureOverview.fact2`),
            t.t(`FeatureOverview.fact3`),
            t.t(`FeatureOverview.fact4`),
          ],
          code: {
            label: t.t(`FeatureOverview.code`),
            href: source(`libs/domain/notes/overview.ts`),
          },
        },
        {
          id: `billing`,
          nav: t.t(`FeatureBilling.nav`),
          eyebrow: t.t(`FeatureBilling.eyebrow`),
          title: t.t(`FeatureBilling.title`),
          lead: t.t(`FeatureBilling.lead`),
          facts: [
            t.t(`FeatureBilling.fact1`),
            t.t(`FeatureBilling.fact2`),
            t.t(`FeatureBilling.fact3`),
            t.t(`FeatureBilling.fact4`),
            <span key="catalog">
              {rich(`FeatureBilling.catalog`, {
                pricing: (text) => (
                  <a href={href(`/pricing`)} class="text-primary underline">{text}</a>
                ),
              })}
            </span>,
          ],
          notYet: [{ label: t.t(`FeatureBilling.notYet1`) }],
          code: { label: t.t(`FeatureBilling.code`), href: source(`docs/billing.md`) },
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/groups`)}>
              <Shot
                name="billing"
                alt={t.t(`FeatureBilling.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `privacy`,
          nav: t.t(`FeaturePrivacy.nav`),
          eyebrow: t.t(`FeaturePrivacy.eyebrow`),
          title: t.t(`FeaturePrivacy.title`),
          lead: t.t(`FeaturePrivacy.lead`),
          facts: [
            t.t(`FeaturePrivacy.fact1`),
            t.t(`FeaturePrivacy.fact2`),
            t.t(`FeaturePrivacy.fact3`),
          ],
          code: {
            label: t.t(`FeaturePrivacy.code`),
            href: source(`libs/server/auth/account-deletion.ts`),
          },
        },
        {
          id: `export`,
          nav: t.t(`FeatureExport.nav`),
          eyebrow: t.t(`FeatureExport.eyebrow`),
          title: t.t(`FeatureExport.title`),
          lead: t.t(`FeatureExport.lead`),
          facts: [
            t.t(`FeatureExport.fact1`),
            t.t(`FeatureExport.fact2`),
            t.t(`FeatureExport.fact3`),
            t.t(`FeatureExport.fact4`),
          ],
          code: {
            label: t.t(`FeatureExport.code`),
            href: source(`libs/server/groups/portable.ts`),
          },
        },
        {
          id: `languages`,
          nav: t.t(`FeatureLanguages.nav`),
          eyebrow: t.t(`FeatureLanguages.eyebrow`),
          title: t.t(`FeatureLanguages.title`),
          lead: t.t(`FeatureLanguages.lead`, { languages: languageList(language) }),
          facts: [
            t.t(`FeatureLanguages.fact1`),
            t.t(`FeatureLanguages.fact2`),
            t.t(`FeatureLanguages.fact3`),
            t.t(`FeatureLanguages.fact4`),
            t.t(`FeatureLanguages.fact5`),
          ],
          code: { label: t.t(`FeatureLanguages.code`), href: source(`i18n/TRANSLATING.md`) },
        },
      ],
    },
    {
      id: `ready`,
      eyebrow: t.t(`FeatureTierReady.eyebrow`),
      title: t.t(`FeatureTierReady.title`),
      lead: t.t(`FeatureTierReady.lead`),
      status: t.t(`FeatureTierReady.status`),
      features: [
        {
          id: `realtime`,
          nav: t.t(`FeatureRealtime.nav`),
          eyebrow: t.t(`FeatureRealtime.eyebrow`),
          title: t.t(`FeatureRealtime.title`),
          lead: t.t(`FeatureRealtime.lead`),
          facts: [
            t.t(`FeatureRealtime.fact1`),
            t.t(`FeatureRealtime.fact2`),
            t.t(`FeatureRealtime.fact3`),
          ],
          code: {
            label: t.t(`FeatureRealtime.code`),
            href: source(`docs/decisions/002-realtime-transport-and-sync.md`),
          },
          visual: <RealtimePair />,
        },
        {
          id: `offline`,
          nav: t.t(`FeatureOffline.nav`),
          eyebrow: t.t(`FeatureOffline.eyebrow`),
          title: t.t(`FeatureOffline.title`),
          lead: t.t(`FeatureOffline.lead`),
          facts: [
            t.t(`FeatureOffline.fact1`),
            t.t(`FeatureOffline.fact2`),
            t.t(`FeatureOffline.fact3`),
          ],
          code: { label: t.t(`FeatureOffline.code`), href: source(`docs/offline.md`) },
          visual: <OfflinePair />,
        },
        {
          id: `shortcuts`,
          nav: t.t(`FeatureShortcuts.nav`),
          eyebrow: t.t(`FeatureShortcuts.eyebrow`),
          title: t.t(`FeatureShortcuts.title`),
          lead: t.t(`FeatureShortcuts.lead`),
          facts: [
            t.t(`FeatureShortcuts.fact1`),
            t.t(`FeatureShortcuts.fact2`),
            t.t(`FeatureShortcuts.fact3`),
            t.t(`FeatureShortcuts.fact4`),
          ],
          code: { label: t.t(`FeatureShortcuts.code`), href: source(`libs/ui/shortcuts.tsx`) },
        },
        {
          id: `push`,
          nav: t.t(`FeaturePush.nav`),
          eyebrow: t.t(`FeaturePush.eyebrow`),
          title: t.t(`FeaturePush.title`),
          lead: t.t(`FeaturePush.lead`),
          facts: [
            t.t(`FeaturePush.fact1`),
            t.t(`FeaturePush.fact2`),
            t.t(`FeaturePush.fact3`),
            t.t(`FeaturePush.fact4`),
          ],
          code: {
            label: t.t(`FeaturePush.code`),
            href: source(`apps/api/services/web-push-service.ts`),
          },
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/notifications`)}>
              <Shot
                name="notifications"
                alt={t.t(`FeaturePush.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `worker`,
          nav: t.t(`FeatureWorker.nav`),
          eyebrow: t.t(`FeatureWorker.eyebrow`),
          title: t.t(`FeatureWorker.title`),
          lead: t.t(`FeatureWorker.lead`),
          facts: [
            t.t(`FeatureWorker.fact1`),
            t.t(`FeatureWorker.fact2`),
            t.t(`FeatureWorker.fact3`),
            t.t(`FeatureWorker.fact4`),
          ],
          code: { label: t.t(`FeatureWorker.code`), href: source(`docs/jobs.md`) },
          visual: <OutboxDiagram />,
        },
        {
          id: `your-feature`,
          nav: t.t(`FeatureYourFeature.nav`),
          eyebrow: t.t(`FeatureYourFeature.eyebrow`),
          title: t.t(`FeatureYourFeature.title`),
          lead: t.t(`FeatureYourFeature.lead`),
          facts: [
            t.t(`FeatureYourFeature.fact1`),
            t.t(`FeatureYourFeature.fact2`),
            t.t(`FeatureYourFeature.fact3`),
          ],
          code: { label: t.t(`FeatureYourFeature.code`), href: source(`docs/aggregates.md`) },
          visual: <AggregateFiles />,
        },
      ],
    },
    {
      id: `operations`,
      eyebrow: t.t(`FeatureTierOperations.eyebrow`),
      title: t.t(`FeatureTierOperations.title`),
      lead: t.t(`FeatureTierOperations.lead`),
      status: t.t(`FeatureTierOperations.status`),
      features: [
        {
          id: `admin`,
          nav: t.t(`FeatureAdmin.nav`),
          eyebrow: t.t(`FeatureAdmin.eyebrow`),
          title: t.t(`FeatureAdmin.title`),
          lead: (
            <>
              {t.t(`FeatureAdmin.lead`)}{" "}
              <a
                href={href(`/admin`)}
                class="font-medium text-primary underline"
                data-e2e="features-admin-watch"
                data-umami-event="features-admin-video"
                data-umami-event-from="lead"
              >
                {t.t(`FeatureAdmin.watch`, { seconds: ADMIN_VIDEO.seconds })}
              </a>.
            </>
          ),
          facts: [
            t.t(`FeatureAdmin.fact1`),
            t.t(`FeatureAdmin.fact2`, { count: ADMIN_TOUR_MODULES.length }),
            t.t(`FeatureAdmin.fact3`),
          ],
          notYet: [
            { label: t.t(`FeatureAdmin.notYet1`) },
          ],
          code: { label: t.t(`FeatureAdmin.code`), href: source(`apps/admin/`) },
          visual: <AdminVideoStill />,
        },
        {
          id: `deploy`,
          nav: t.t(`FeatureDeploy.nav`),
          eyebrow: t.t(`FeatureDeploy.eyebrow`),
          title: t.t(`FeatureDeploy.title`),
          lead: t.t(`FeatureDeploy.lead`),
          facts: [
            t.t(`FeatureDeploy.fact1`),
            t.t(`FeatureDeploy.fact2`),
            t.t(`FeatureDeploy.fact3`),
            t.t(`FeatureDeploy.fact4`),
            t.t(`FeatureDeploy.fact5`),
            t.t(`FeatureDeploy.fact6`),
          ],
          code: { label: t.t(`FeatureDeploy.code`), href: source(`infra/compose/`) },
          visual: <DeployVisual />,
        },
        {
          id: `website`,
          nav: t.t(`FeatureWebsite.nav`),
          eyebrow: t.t(`FeatureWebsite.eyebrow`),
          title: t.t(`FeatureWebsite.title`),
          lead: t.t(`FeatureWebsite.lead`),
          facts: [
            t.t(`FeatureWebsite.fact1`),
            t.t(`FeatureWebsite.fact2`),
            t.t(`FeatureWebsite.fact3`),
            t.t(`FeatureWebsite.fact4`),
            t.t(`FeatureWebsite.fact5`),
            t.t(`FeatureWebsite.fact6`),
            t.t(`FeatureWebsite.fact7`),
            t.t(`FeatureWebsite.fact8`),
            t.t(`FeatureWebsite.fact9`),
          ],
          code: { label: t.t(`FeatureWebsite.code`), href: source(`apps/mpa/`) },
        },
        {
          id: `quality`,
          nav: t.t(`FeatureQuality.nav`),
          eyebrow: t.t(`FeatureQuality.eyebrow`),
          title: t.t(`FeatureQuality.title`),
          lead: <QualityLead />,
          facts: [
            t.t(`FeatureQuality.fact1`),
            t.t(`FeatureQuality.fact2`),
            t.t(`FeatureQuality.fact3`),
          ],
          code: { label: t.t(`FeatureQuality.code`), href: source(`e2e/`) },
        },
      ],
    },
  ]
}

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
              {features.map(({ nav: _nav, ...feature }, index) => (
                <FeatureSection key={feature.id} {...feature} flip={index % 2 === 1} />
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
    </SiteFrame>
  )
})
