// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { type ComparisonRow, ComparisonTable } from "@spy4x/preact-ui/comparison-table"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { useFormat } from "@spy4x/preact-ui/format"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { Band } from "../../components/band.tsx"
import { type Alternative, CompareAlternatives } from "../../components/compare-alternatives.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import { SectionIntro } from "../../components/section-intro.tsx"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_AUTHOR,
  SITE_NAME,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareId,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../../site.tsx"
import { define } from "../../utils.ts"
import { DEFAULT_LANGUAGE, languageList, localePath, siteTranslator } from "../../languages.ts"
import { plainText, type Site, useSite } from "../../use-site.tsx"
import { siteEnglishText } from "@ui/site-text.ts"
import type { Language } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"

/**
 * The day every row was read off the products' own pages: the hero's "Checked" line, the JSON-LD
 * `dateModified` and the sitemap's `lastmod`. Re-check at least every three months.
 */
export const CHECKED_ON = `2026-10-16`

/** {@link CHECKED_ON} as the hero's "Checked" line shows it, so the page names the day one way. */
function useCheckedOn(): string {
  return useFormat().utc().date(CHECKED_ON)
}

/** The page's title and description, as search results and social previews show them. */
export function compareHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Compare.title`), description: t.t(`Compare.description`) }
}

/** The page's head in English, for the page list. */
export const COMPARE_HEAD = compareHead(siteEnglishText())

/** The columns of the table, Seed first: the table highlights the first one as ours. */
const PRODUCTS = [
  SITE_NAME,
  `ShipFast`,
  `Supastarter`,
  `Makerkit`,
  `Next.js SaaS Starter`,
  `Open SaaS`,
] as const

/**
 * One row per capability, one value per product in the order of {@link PRODUCTS}. "No" means the
 * product's own pages do not list it; every "Partial" is
 * explained in the row's note. Seed's values match the README and the code on the check date.
 */
function rows({ t, language }: Site): readonly ComparisonRow[] {
  const row = (
    key: string,
    values: ComparisonRow[`values`],
    note?: string,
    noteValues?: Record<string, string>,
  ): ComparisonRow => ({
    capability: t.t(key),
    note: note ? t.t(note, noteValues) : undefined,
    values,
  })
  return [
    row(`CompareRow.free`, [`yes`, `no`, `no`, `partial`, `yes`, `yes`], `CompareRow.makerkitLite`),
    row(
      `CompareRow.openSource`,
      [`yes`, `no`, `no`, `partial`, `yes`, `yes`],
      `CompareRow.makerkitLite`,
    ),
    row(`CompareRow.password`, [`yes`, `no`, `yes`, `yes`, `yes`, `yes`]),
    row(`CompareRow.magicLinks`, [`yes`, `yes`, `yes`, `yes`, `no`, `no`]),
    row(`CompareRow.social`, [`yes`, `yes`, `yes`, `yes`, `no`, `yes`], `CompareRow.socialNote`),
    row(`CompareRow.totp`, [`yes`, `no`, `yes`, `yes`, `no`, `no`]),
    row(`CompareRow.passkeys`, [`yes`, `no`, `yes`, `yes`, `no`, `no`]),
    row(`CompareRow.groups`, [`yes`, `no`, `yes`, `yes`, `partial`, `no`], `CompareRow.groupsNote`),
    row(`CompareRow.perMember`, [`yes`, `no`, `yes`, `yes`, `no`, `no`]),
    row(`CompareRow.nonStripe`, [`no`, `yes`, `yes`, `yes`, `no`, `yes`]),
    row(`CompareRow.admin`, [`yes`, `no`, `yes`, `yes`, `partial`, `yes`], `CompareRow.adminNote`),
    row(`CompareRow.i18n`, [`yes`, `no`, `yes`, `yes`, `no`, `no`], `CompareRow.i18nNote`, {
      languages: languageList(language),
    }),
    row(`CompareRow.jobs`, [`yes`, `no`, `yes`, `no`, `no`, `yes`]),
    row(
      `CompareRow.uploads`,
      [`yes`, `no`, `yes`, `partial`, `no`, `yes`],
      `CompareRow.uploadsNote`,
    ),
    row(`CompareRow.blog`, [`yes`, `yes`, `yes`, `yes`, `no`, `yes`]),
    row(`CompareRow.audit`, [`yes`, `no`, `no`, `no`, `yes`, `no`]),
    row(`CompareRow.realtime`, [`yes`, `no`, `no`, `no`, `no`, `no`]),
    row(`CompareRow.offline`, [`yes`, `no`, `no`, `no`, `no`, `no`], `CompareRow.offlineNote`),
    row(`CompareRow.ops`, [`yes`, `no`, `partial`, `partial`, `no`, `no`], `CompareRow.opsNote`),
  ]
}

/** The facts that are not a yes or a no, and when each alternative is the better pick. */
function alternatives(t: Translator<string>): readonly Alternative[] {
  return [
    {
      id: `shipfast`,
      name: `ShipFast`,
      price: t.t(`CompareAlt.shipfastPrice`),
      licence: t.t(`CompareAlt.shipfastLicence`),
      stack: t.t(`CompareAlt.shipfastStack`),
      hosting: t.t(`CompareAlt.shipfastHosting`),
      pickWhen: t.t(`CompareAlt.shipfastPick`),
      sources: [
        { label: t.t(`CompareAlt.salesPage`), href: `https://shipfa.st/` },
        { label: t.t(`CompareAlt.licencePage`), href: `https://shipfa.st/license` },
        { label: t.t(`CompareAlt.docs`), href: `https://shipfa.st/docs` },
      ],
    },
    {
      id: `supastarter`,
      name: `Supastarter`,
      price: t.t(`CompareAlt.supastarterPrice`),
      licence: t.t(`CompareAlt.supastarterLicence`),
      stack: t.t(`CompareAlt.supastarterStack`),
      hosting: t.t(`CompareAlt.supastarterHosting`),
      pickWhen: t.t(`CompareAlt.supastarterPick`),
      sources: [
        { label: t.t(`CompareAlt.salesPage`), href: `https://supastarter.dev/` },
        { label: t.t(`CompareAlt.licencePage`), href: `https://supastarter.dev/legal/license` },
      ],
    },
    {
      id: `makerkit`,
      name: `Makerkit`,
      price: t.t(`CompareAlt.makerkitPrice`),
      licence: t.t(`CompareAlt.makerkitLicence`),
      stack: t.t(`CompareAlt.makerkitStack`),
      hosting: t.t(`CompareAlt.makerkitHosting`),
      pickWhen: t.t(`CompareAlt.makerkitPick`),
      sources: [
        { label: t.t(`CompareAlt.pricing`), href: `https://makerkit.dev/pricing` },
        {
          label: t.t(`CompareAlt.docs`),
          href: `https://makerkit.dev/docs/next-supabase-turbo/introduction`,
        },
      ],
    },
    {
      id: `nextjs-saas-starter`,
      name: `Next.js SaaS Starter`,
      price: t.t(`CompareAlt.free`),
      licence: `MIT`,
      stack: t.t(`CompareAlt.nextStack`),
      hosting: t.t(`CompareAlt.nextHosting`),
      pickWhen: t.t(`CompareAlt.nextPick`),
      sources: [{ label: `README`, href: `https://github.com/nextjs/saas-starter` }],
    },
    {
      id: `open-saas`,
      name: `Open SaaS`,
      price: t.t(`CompareAlt.free`),
      licence: `MIT`,
      stack: t.t(`CompareAlt.openSaasStack`),
      hosting: t.t(`CompareAlt.openSaasHosting`),
      pickWhen: t.t(`CompareAlt.openSaasPick`),
      sources: [
        { label: `README`, href: `https://github.com/wasp-lang/open-saas` },
        {
          label: t.t(`CompareAlt.deployGuide`),
          href: `https://docs.opensaas.sh/guides/deploying/`,
        },
      ],
    },
    {
      id: `build-it-yourself`,
      name: t.t(`CompareAlt.diy`),
      price: t.t(`CompareAlt.diyPrice`),
      licence: t.t(`CompareAlt.diyLicence`),
      stack: t.t(`CompareAlt.diyChoice`),
      hosting: t.t(`CompareAlt.diyChoice`),
      pickWhen: t.t(`CompareAlt.diyPick`),
      sources: [],
    },
  ]
}

/** The questions by their catalog keys, each written out so the catalog test finds it. */
const FAQ = [
  { id: `faq-neutral`, question: `CompareFaq.neutralQuestion`, answer: `CompareFaq.neutralAnswer` },
  { id: `faq-wrong-row`, question: `CompareFaq.wrongQuestion`, answer: `CompareFaq.wrongAnswer` },
  { id: `faq-paid-kits`, question: `CompareFaq.paidQuestion`, answer: `CompareFaq.paidAnswer` },
] as const

/** The questions in the language of `t`, each answer as plain text for the structured data. */
function faqItems(t: Translator<string>) {
  return FAQ.map(({ id, question, answer }) => ({
    id,
    answer,
    question: t.t(question),
    answerText: plainText(t, answer),
  }))
}

/** The page's structured data: the page and its date, the trail to it, its author and the FAQ. */
function compareJsonLd(t: Translator<string>, origin: string, language: Language): unknown[] {
  const url = `${origin}${localePath(language, `/compare`)}`
  const head = compareHead(t)
  return [
    {
      "@type": `WebPage`,
      "@id": `${url}#webpage`,
      url,
      name: head.title,
      description: head.description,
      inLanguage: language,
      dateModified: CHECKED_ON,
      author: { "@id": PERSON_JSON_LD["@id"] },
      about: { "@id": softwareId(origin) },
    },
    siteBreadcrumbsJsonLd(origin, `/compare`, t.t(`Compare.crumb`), language),
    PERSON_JSON_LD,
    faqPageJsonLd(
      faqItems(t).map(({ id, question, answerText }) => ({ id, question, answerText })),
    ),
  ]
}

/** A link inside a sentence, in the page's link style. */
function link(href: string): (text: string) => JSX.Element {
  return (text) => <a href={href} class="text-primary underline">{text}</a>
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  const { t, rich } = useSite()
  return (
    <PageHero
      class="site-glow"
      eyebrow={t.t(`Compare.crumb`)}
      title={t.t(`Compare.heroTitle`)}
      lead={t.t(`Compare.heroLead`)}
      author={SITE_AUTHOR}
      updated={CHECKED_ON}
      labels={{ updated: t.t(`Compare.checked`) }}
      note={rich(`Compare.heroNote`, { issue: link(`${REPOSITORY_URL}/issues`) })}
    >
      <div class="mt-2 flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
        <Button
          href={demoHref}
          rel={TRY_REL}
          size="lg"
          data-e2e="compare-try-demo"
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
          <IconGitHub class="size-5" aria-hidden="true" /> {t.t(`Compare.github`)}
        </Button>
      </div>
    </PageHero>
  )
}

function Table(): JSX.Element {
  const site = useSite()
  const { t, rich, href, language } = site
  const checkedOn = useCheckedOn()
  return (
    <Band id="table" labelledBy="table-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="table-title"
          eyebrow={t.t(`Compare.tableEyebrow`)}
          title={t.t(`Compare.tableTitle`)}
          lead={t.t(`Compare.tableLead`)}
        />
        <ComparisonTable
          caption={t.t(`Compare.caption`, { date: checkedOn })}
          products={PRODUCTS}
          rows={rows(site)}
          checkedOn={new Date(`${CHECKED_ON}T00:00:00Z`)}
          locale={language === DEFAULT_LANGUAGE ? `en-GB` : language}
          labels={{
            // The table formats its own date in long form; the page's one form replaces it.
            checkedOn: () => t.t(`Compare.checkedOn`, { date: checkedOn }),
            yesMeaning: t.t(`Compare.yesMeaning`),
            partialMeaning: t.t(`Compare.partialMeaning`),
            noMeaning: t.t(`Compare.noMeaning`),
          }}
          method={t.t(`Compare.method`)}
          fit={t.t(`Compare.fit`)}
        />
        <ul class="flex max-w-3xl list-disc flex-col gap-2 ps-6 text-sm text-muted">
          <li>{rich(`Compare.gap`, { status: link(href(`/#status`)) })}</li>
          <li>
            {rich(`Compare.shipfastPrices`, { sales: link(`https://shipfa.st/`) }, {
              date: checkedOn,
            })}
          </li>
          <li>
            {rich(`Compare.more`, {
              features: link(href(`/features`)),
              pricing: link(href(`/pricing`)),
            })}
          </li>
        </ul>
      </div>
    </Band>
  )
}

function Alternatives(): JSX.Element {
  const { t } = useSite()
  const checkedOn = useCheckedOn()
  return (
    <Band tone="alt" id="alternatives" labelledBy="alternatives-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="alternatives-title"
          eyebrow={t.t(`Compare.fitEyebrow`)}
          title={t.t(`Compare.fitTitle`)}
          lead={t.t(`Compare.fitLead`)}
        />
        <CompareAlternatives items={alternatives(t)} checkedOn={checkedOn} />
      </div>
    </Band>
  )
}

function Questions(): JSX.Element {
  const { t, rich } = useSite()
  return (
    <Band id="faq" labelledBy="faq-title" width="3xl">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="faq-title"
          eyebrow={t.t(`Compare.faqEyebrow`)}
          title={t.t(`Compare.faqTitle`)}
        />
        <FaqList
          items={faqItems(t).map((item) => ({
            id: item.id,
            question: item.question,
            answer: <p>{rich(item.answer, { issue: link(`${REPOSITORY_URL}/issues`) })}</p>,
          }))}
        />
      </div>
    </Band>
  )
}

/**
 * The comparison with other SaaS starters: the check date and why to trust it first, then the
 * table with its method and fit, when another starter is the better pick, the questions and the
 * way into the demo. Server-rendered; it needs no JavaScript.
 */
export default define.page(function Compare({ state }) {
  const spa = spaLinks(state.spaOrigin)
  const t = siteTranslator(state.language)
  const head: SitePageHead = {
    ...compareHead(t),
    og: `compare`,
    jsonLd: compareJsonLd(t, state.webAppOrigin, state.language),
  }
  return (
    <SiteFrame state={state} path="/compare" head={head}>
      <Hero demoHref={spa.try} />
      <Table />
      <Alternatives />
      <Questions />
      <CtaBand
        demoHref={spa.try}
        title={t.t(`Compare.ctaTitle`)}
        lead={t.t(`Compare.ctaLead`)}
      />
    </SiteFrame>
  )
})
