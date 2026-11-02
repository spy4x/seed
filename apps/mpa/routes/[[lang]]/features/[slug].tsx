// Seed's own site: see docs/start-a-product.md
// A feature page exists in every language the site serves: its words are keys of the `site`
// catalog, named in `features-data.tsx`.
import type { ComponentChildren, JSX } from "preact"
import type { FreshContext } from "fresh"
import type { Language } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { IconArrowRight, IconArrowUpRight } from "@spy4x/preact-icons"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { FeatureCard } from "@spy4x/preact-ui/feature-card"
import { useFormat } from "@spy4x/preact-ui/format"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { breadcrumbListJsonLd, faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { Band } from "../../../components/band.tsx"
import { CtaBand } from "../../../components/cta-band.tsx"
import { FactList, NotYetList } from "../../../components/features-section.tsx"
import { ShotViewer } from "../../../components/shot-viewer.tsx"
import {
  type Feature,
  FEATURE_PAGES,
  type FeaturePage,
  featurePage,
  featurePageIn,
  featurePageSections,
  featurePath,
  tiers,
} from "../../../features-data.tsx"
import { localePath, siteTranslator } from "../../../languages.ts"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  sectionLinks,
  SITE_NAME,
  SiteFrame,
  softwareId,
  softwareJsonLd,
  spaLinks,
} from "../../../site.tsx"
import { useSite } from "../../../use-site.tsx"
import { define, type State } from "../../../utils.ts"

/** What an address with no feature page says, with the way to every feature, as catalog keys. */
export const FEATURE_NOT_FOUND = {
  title: `FeaturePageMissing.title`,
  description: `FeaturePageMissing.description`,
  action: `FeaturePageMissing.action`,
} as const

/** The section of `/features` that has a page elsewhere: the admin panel's is `/admin`. */
const MOVED: ReadonlyMap<string, string> = new Map([[`admin`, `/admin`]])

/**
 * One feature's page, built from {@link FEATURE_PAGES} and the feature of the same id that
 * `/features` draws. `/de/features/admin` answers 301 to `/de/admin` (`/features/admin` never gets
 * here: `routes/features/admin.ts` answers it); every other page answers in the address's
 * language, naming its version in every language; an unknown slug, `constructor` too, answers 404.
 */
export const handler = define.handlers({
  GET(ctx) {
    const slug = ctx.params.slug ?? ``
    const moved = MOVED.get(slug)
    if (moved) return ctx.redirect(localePath(ctx.state.language, moved), 301)
    const keys = featurePage(slug)
    if (!keys) return renderNotFound(ctx)
    const { language } = ctx.state
    const t = siteTranslator(language)
    const page = featurePageIn(t, keys)
    return ctx.render(
      <SiteFrame
        state={ctx.state}
        path={featurePath(slug)}
        head={{
          title: page.title,
          description: page.description,
          og: `features`,
          jsonLd: pageJsonLd(t, ctx.state.webAppOrigin, page, language),
        }}
      >
        <FeaturePageBody page={page} demo={demoAddress(ctx.state.spaOrigin, page)} />
      </SiteFrame>,
    )
  },
})

/** The demo's `/try`, opening on the screen where the feature shows when the page names one. */
function demoAddress(spaOrigin: string, page: FeaturePage): string {
  const start = spaLinks(spaOrigin).try
  return page.demo ? `${start}?${new URLSearchParams({ next: page.demo })}` : start
}

/** The page's structured data: the page about the software, its trail and its questions. */
function pageJsonLd(
  t: Translator<string>,
  origin: string,
  page: FeaturePage,
  language: Language,
): unknown[] {
  const url = `${origin}${featurePath(page.slug, language)}`
  return [
    {
      "@type": `WebPage`,
      "@id": url,
      url,
      name: page.h1,
      description: page.description,
      inLanguage: language,
      dateModified: page.updated,
      about: { "@id": softwareId(origin) },
    },
    softwareJsonLd(origin),
    PERSON_JSON_LD,
    breadcrumbListJsonLd(url, [
      { name: SITE_NAME, href: `${origin}${localePath(language, `/`)}` },
      { name: t.t(`SiteNav.features`), href: `${origin}${localePath(language, `/features`)}` },
      { name: page.name },
    ]),
    faqPageJsonLd(
      page.questions.map(({ question, answer }) => ({ question, answerText: answer })),
    ),
  ]
}

/** The feature `slug` as `/features` draws it, in the page's language. */
function useFeature(slug: string): Feature {
  const feature = tiers(useSite()).flatMap((tier) => tier.features).find((f) => f.id === slug)
  if (!feature) throw new Error(`The feature page "${slug}" has no feature in tiers()`)
  return feature
}

/** The repository path a "Read the code" link points at, as the link names it. */
function codePath(href: string): string {
  return href.replace(`${REPOSITORY_URL}/`, ``).replace(/^(blob|tree)\/main\//, ``)
}

/**
 * A repository path with the outward arrow after it. The path's last part and the arrow share a
 * span that never breaks, so on a narrow screen the arrow never sits on a line of its own.
 */
function CodePath({ path }: { path: string }) {
  const cut = path.replace(/\/$/, ``).lastIndexOf(`/`) + 1
  return (
    <code dir="ltr" class="font-mono text-sm">
      {path.slice(0, cut)}
      <span class="whitespace-nowrap">
        {path.slice(cut)}
        <IconArrowUpRight class="ms-1 inline size-4 align-[-0.125em]" aria-hidden="true" />
      </span>
    </code>
  )
}

const HEADING =
  `scroll-mt-16 text-2xl font-semibold tracking-tight text-balance break-words hyphens-auto`

const LINK =
  `inline-flex min-h-11 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline`

/** A section's `h2`, with a "Link to this section" link shown on hover and on focus. */
function SectionHeading({ id, children }: { id: string; children: ComponentChildren }) {
  const { t } = useSite()
  return (
    <div class="group/heading flex items-baseline gap-2">
      <h2 id={`${id}-title`} class={HEADING}>{children}</h2>
      <a
        href={`#${id}`}
        aria-label={t.t(`FeaturePage.sectionLink`)}
        class="rounded-sm px-1 text-muted opacity-0 group-hover/heading:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus [@media(hover:none)]:opacity-100"
      >
        <span aria-hidden="true">#</span>
      </a>
    </div>
  )
}

/** One section of the page, labelled by its heading. */
function Section(
  { id, label, children }: { id: string; label: string; children: ComponentChildren },
) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} class="flex scroll-mt-16 flex-col gap-4">
      <SectionHeading id={id}>{label}</SectionHeading>
      {children}
    </section>
  )
}

/**
 * The page in its fixed order: trail, heading, date, answer, then What you get, How it works,
 * Limits and Questions, each only when it has something to say, then the demo and the other
 * features. From 1280 px "On this page" stands beside the body, in the blog post's grid.
 */
function FeaturePageBody({ page, demo }: { page: FeaturePage; demo: string }): JSX.Element {
  const { t, href, rich } = useSite()
  const feature = useFeature(page.feature ?? page.slug)
  const format = useFormat().utc()
  const sections = featurePageSections(t, page, feature)
  const code = page.code ?? feature.code.href
  const drawn = new Set(sections.map(({ id }) => id))
  const label = (id: string) => sections.find((section) => section.id === id)?.label ?? ``
  return (
    <>
      <article
        class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16 xl:grid xl:max-w-7xl xl:grid-cols-[minmax(0,1fr)_42rem_minmax(0,1fr)] xl:gap-x-12"
        data-e2e="feature-page"
      >
        <header class="flex min-w-0 flex-col gap-4 xl:col-start-2">
          <Breadcrumbs
            items={[
              { label: SITE_NAME, href: href(`/`) },
              { label: t.t(`SiteNav.features`), href: href(`/features`) },
              { label: page.name },
            ]}
          />
          <h1 class="text-3xl font-semibold tracking-tight text-balance break-words hyphens-auto lg:text-4xl">
            {page.h1}
          </h1>
          <p class="text-sm text-muted" data-e2e="feature-page-updated">
            {rich(`FeaturePage.updated`, {
              time: (text) => <time datetime={page.updated}>{text}</time>,
            }, { date: format.date(page.updated) })}
          </p>
          <p class="text-lg text-pretty text-foreground" data-e2e="feature-page-answer">
            {page.answer}
          </p>
        </header>
        <div class="mt-8 xl:col-start-3 xl:row-span-2 xl:row-start-1 xl:mt-0">
          <OnThisPage
            links={sectionLinks(sections.map(({ id, label }) => ({ label, href: `#${id}` })))}
            openFrom="xl"
          />
        </div>
        <div class="mt-12 flex min-w-0 flex-col gap-12 xl:col-start-2">
          {drawn.has(`what`) && (
            <Section id="what" label={label(`what`)}>
              <FactList facts={feature.facts} />
            </Section>
          )}
          {drawn.has(`how`) && (
            <Section id="how" label={label(`how`)}>
              {page.how.map((paragraph, index) => (
                <p key={index} class="text-pretty">{paragraph}</p>
              ))}
              {feature.visual && <div class="min-w-0">{feature.visual}</div>}
              <div class="flex flex-wrap gap-x-6">
                {page.guide && (
                  <a href={page.guide} class={LINK} data-e2e="feature-page-guide">
                    {t.t(`FeaturePage.guide`)} <IconArrowRight class="size-4" aria-hidden="true" />
                  </a>
                )}
                <a
                  href={code}
                  class="py-3 font-medium text-primary underline-offset-4 wrap-anywhere hover:underline"
                  data-e2e="feature-page-code"
                  data-umami-event="read-code"
                  data-umami-event-from={`page-${page.slug}`}
                >
                  {rich(`FeaturePage.code`, { path: (text) => <CodePath path={text} /> }, {
                    path: codePath(code),
                  })}
                </a>
              </div>
            </Section>
          )}
          {drawn.has(`limits`) && (
            <Section id="limits" label={label(`limits`)}>
              <NotYetList items={feature.notYet ?? []} />
            </Section>
          )}
          {drawn.has(`questions`) && (
            <Section id="questions" label={label(`questions`)}>
              <FaqList
                items={page.questions.map(({ id, question, answer }) => ({
                  id,
                  question,
                  answer: <p>{answer}</p>,
                }))}
              />
            </Section>
          )}
        </div>
      </article>
      <CtaBand demoHref={demo} />
      <OtherFeatures current={page.slug} />
      {drawn.has(`how`) && feature.shots && <ShotViewer />}
    </>
  )
}

/** Three other feature pages as cards, then every feature and the comparison. */
function OtherFeatures({ current }: { current: string }): JSX.Element {
  const { t, language, href } = useSite()
  const others = FEATURE_PAGES.filter(({ slug }) => slug !== current).slice(0, 3)
    .map((other) => featurePageIn(t, other))
  return (
    <Band id="other-features" labelledBy="other-features-title">
      <div class="flex flex-col gap-8">
        <h2 id="other-features-title" class={HEADING}>{t.t(`FeaturePage.otherFeatures`)}</h2>
        <div class="grid gap-6 lg:grid-cols-3">
          {others.map((other) => (
            <FeatureCard
              key={other.slug}
              id={`other-${other.slug}`}
              title={other.name}
              href={featurePath(other.slug, language)}
              linkLabel={t.t(`FeaturePage.readMore`, { name: other.name })}
              headingLevel={3}
            >
              {other.summary}
            </FeatureCard>
          ))}
        </div>
        <p class="flex flex-wrap gap-x-6">
          <a href={href(`/features`)} class={LINK} data-e2e="feature-page-all">
            {t.t(`FeaturePage.all`)} <IconArrowRight class="size-4" aria-hidden="true" />
          </a>
          <a href={href(`/compare`)} class={LINK} data-e2e="feature-page-compare">
            {t.t(`Features.compare`)} <IconArrowRight class="size-4" aria-hidden="true" />
          </a>
        </p>
      </div>
    </Band>
  )
}

/** The 404 of an address with no feature page, and the way to every feature. */
function renderNotFound(ctx: FreshContext<State>): Response | Promise<Response> {
  const t = siteTranslator(ctx.state.language)
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={ctx.url.pathname}
      head={{
        title: t.t(FEATURE_NOT_FOUND.title),
        description: t.t(FEATURE_NOT_FOUND.description),
        noindex: true,
      }}
    >
      <section
        aria-labelledby="feature-missing"
        class="site-glow flex min-h-[60vh] items-center"
        data-e2e="feature-page-missing"
        data-analytics-view="not-found"
      >
        <div class="mx-auto flex w-full max-w-md flex-col items-start gap-6 px-4 py-16">
          <p class="font-mono text-6xl font-semibold text-muted" aria-hidden="true">404</p>
          <h1 id="feature-missing" class="text-3xl font-semibold tracking-tight text-balance">
            {t.t(FEATURE_NOT_FOUND.title)}
          </h1>
          <p class="text-muted text-pretty">{t.t(FEATURE_NOT_FOUND.description)}</p>
          <Button href={localePath(ctx.state.language, `/features`)}>
            {t.t(FEATURE_NOT_FOUND.action)}
          </Button>
        </div>
      </section>
    </SiteFrame>,
    { status: 404 },
  )
}
