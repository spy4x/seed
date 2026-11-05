// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { IconCheck } from "@spy4x/preact-icons"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { SectionHeading } from "@spy4x/preact-ui/section-heading"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"
import { CtaBand } from "../../components/cta-band.tsx"
import { DOCS_PATH } from "../../docs-site.ts"
import ChecklistActions from "../../islands/checklist-actions.tsx"
import LaunchChecklist, {
  CHECKLIST_KEYS,
  CHECKLIST_ROOT_ID,
} from "../../islands/launch-checklist.tsx"
import { localePath, siteCatalogSubset } from "../../languages.ts"
import {
  CHECKLIST,
  CHECKLIST_COUNTS,
  CHECKLIST_PATH,
  CHECKLIST_STORAGE_KEY,
  type ChecklistItem,
  type ChecklistSection,
  Coverage,
  proofLink,
} from "../../launch-checklist.ts"
import {
  PERSON_JSON_LD,
  sectionLinks,
  SITE_AUTHOR,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareId,
} from "../../site.tsx"
import { type Site, useSite } from "../../use-site.tsx"
import { define } from "../../utils.ts"

/** The day the list first went live: the structured data's `datePublished`. */
export const CHECKLIST_PUBLISHED = `2026-11-06`

/**
 * The day the list or its wording last changed: the hero's "Updated" line, the structured data and
 * the sitemap's `lastmod`. Change it with them.
 */
export const CHECKLIST_UPDATED = `2026-11-06`

/** The numbers every sentence of the page fills in. */
const COUNTS = {
  count: CHECKLIST_COUNTS.items,
  sections: CHECKLIST_COUNTS.sections,
  covered: CHECKLIST_COUNTS.covered,
}

/** The page's title and description in the language of `t`. */
export function checklistHead(t: Translator<string>): { title: string; description: string } {
  return {
    title: t.t(`LaunchChecklist.seoTitle`, COUNTS),
    description: t.t(`LaunchChecklist.description`, COUNTS),
  }
}

/** The page's head in English, for the page list. */
export const CHECKLIST_HEAD = checklistHead(siteEnglishText())

/** The page's structured data: an article about the software, and the page's place. */
function checklistJsonLd({ t, language }: Site, origin: string): unknown[] {
  const url = `${origin}${localePath(language, CHECKLIST_PATH)}`
  return [
    {
      "@type": `TechArticle`,
      "@id": `${url}#article`,
      url,
      headline: t.t(`LaunchChecklist.title`),
      description: t.t(`LaunchChecklist.description`, COUNTS),
      inLanguage: language,
      datePublished: CHECKLIST_PUBLISHED,
      dateModified: CHECKLIST_UPDATED,
      author: { "@type": `Person`, "@id": PERSON_JSON_LD["@id"], name: PERSON_JSON_LD.name },
      about: { "@id": softwareId(origin) },
      isPartOf: { "@id": `${origin}/#website` },
      mainEntityOfPage: url,
    },
    PERSON_JSON_LD,
    siteBreadcrumbsJsonLd(origin, CHECKLIST_PATH, t.t(`LaunchChecklist.crumb`), language),
  ]
}

const LINK = `font-medium text-primary underline-offset-4 hover:underline`

/** What Seed already does for an item: a quiet line with a link to the proof. */
function SeedMark({ item, host }: { item: ChecklistItem; host: string }): JSX.Element | null {
  const { t, href } = useSite()
  const seed = item.seed
  if (!seed) return null
  const full = seed.coverage === Coverage.Full
  const link = proofLink(seed.path, href, host)
  return (
    <p id={`${item.id}-seed`} class="flex items-start gap-2 text-sm text-muted">
      <IconCheck class="h-5 w-4 shrink-0 text-success" aria-hidden="true" />
      <span>
        <a
          href={link.href}
          class={`${LINK} checklist-proof`}
          aria-label={t.t(
            full ? `LaunchChecklist.builtInLabel` : `LaunchChecklist.partlyLabel`,
            { doc: seed.title },
          )}
          data-short={link.short}
          data-umami-event="read-code"
          data-umami-event-from="checklist"
        >
          {t.t(full ? `LaunchChecklist.builtIn` : `LaunchChecklist.partly`)}
        </a>
        {seed.left && <>{` `}{t.t(seed.left)}</>}
      </span>
    </p>
  )
}

/** One check: its box and title, then why it matters, what Seed does and an official source. */
function Item({ item, host }: { item: ChecklistItem; host: string }): JSX.Element {
  const { t } = useSite()
  const described = [
    `${item.id}-why`,
    item.seed && `${item.id}-seed`,
    item.source && `${item.id}-source`,
  ].filter(Boolean).join(` `)
  return (
    <li class="flex items-start gap-3 py-4 break-inside-avoid" data-e2e="checklist-item">
      <input
        type="checkbox"
        id={item.id}
        aria-describedby={described}
        class="pc-checkbox peer mt-1 size-5 shrink-0 scroll-mt-16"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-2 peer-checked:[&>div>label]:text-muted">
        <div class="group/item flex items-baseline gap-2">
          <label
            for={item.id}
            class="min-h-6 cursor-pointer font-medium text-pretty text-foreground motion-safe:transition-colors"
          >
            {t.t(item.title)}
          </label>
          <a
            href={`#${item.id}`}
            aria-label={t.t(`LaunchChecklist.itemLink`, { title: t.t(item.title) })}
            class="rounded-sm px-1 text-muted opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus pointer-coarse:min-h-11 pointer-coarse:min-w-11 [@media(hover:none)]:opacity-100 print:hidden"
          >
            <span aria-hidden="true">#</span>
          </a>
        </div>
        <p id={`${item.id}-why`} class="text-sm text-muted text-pretty">{t.t(item.why)}</p>
        <SeedMark item={item} host={host} />
        {item.source && (
          <p id={`${item.id}-source`} class="text-sm text-muted">
            {t.t(`LaunchChecklist.source`)}
            {` `}
            <a
              href={item.source.url}
              class={`${LINK} checklist-proof`}
              data-short={item.source.url}
            >
              {t.t(item.source.name)}
            </a>
          </p>
        )}
      </div>
    </li>
  )
}

/** One section: its heading with an anchor, its count, and its items. */
function Section({ section, host }: { section: ChecklistSection; host: string }): JSX.Element {
  const { t } = useSite()
  return (
    <section
      id={section.id}
      aria-labelledby={`${section.id}-title`}
      data-checklist-section={section.id}
      class="flex scroll-mt-16 flex-col gap-1"
    >
      <SectionHeading
        id={`${section.id}-title`}
        targetId={section.id}
        labels={{ anchor: t.t(`FeaturePage.sectionLink`) }}
        class="break-after-avoid"
      >
        {t.t(section.title)}
      </SectionHeading>
      <p class="text-sm text-muted" data-checklist-count={section.id}>
        {t.t(`LaunchChecklist.sectionItems`, { count: section.items.length })}
      </p>
      <ul role="list" class="divide-y divide-subtle">
        {section.items.map((item) => <Item key={item.id} item={item} host={host} />)}
      </ul>
    </section>
  )
}

/**
 * `/saas-launch-checklist`: what to check before a SaaS launches, ticked here without an account.
 * The server renders every box, so the list works without JavaScript; one island keeps the ticks
 * in this browser and counts them. Seed's share of the list is computed from the data.
 */
export default define.page(function LaunchChecklistPage({ state }) {
  const site = useSite()
  const { t, href, language } = site
  const host = new URL(state.webAppOrigin).host
  const head: SitePageHead = {
    ...checklistHead(t),
    jsonLd: checklistJsonLd(site, state.webAppOrigin),
  }
  const nav = sectionLinks(CHECKLIST.map((section) => ({
    label: t.t(section.title),
    href: `#${section.id}`,
  }))).map((link, index) => ({
    ...link,
    label: (
      <>
        {link.label}
        {` `}
        <span class="text-muted tabular-nums" data-checklist-nav={CHECKLIST[index].id} />
      </>
    ),
  }))
  return (
    <SiteFrame state={state} path={CHECKLIST_PATH} head={head}>
      <div class="checklist-print">
        <p
          class="mx-auto hidden max-w-6xl px-4 text-sm sm:px-6 lg:px-8 print:block"
          data-e2e="checklist-print-line"
        >
          {t.t(`LaunchChecklist.printLine`, { address: `${host}${CHECKLIST_PATH}` })}
          <span data-checklist-printed />
        </p>
        <PageHero
          class="site-glow"
          eyebrow={t.t(`LaunchChecklist.eyebrow`)}
          title={t.t(`LaunchChecklist.title`)}
          lead={t.t(`LaunchChecklist.lead`, COUNTS)}
          author={SITE_AUTHOR}
          updated={CHECKLIST_UPDATED}
          note={t.t(`LaunchChecklist.disclaimer`)}
        >
          <p class="flex max-w-2xl items-start gap-2 font-medium" data-e2e="checklist-coverage">
            <IconCheck class="mt-1 size-4 shrink-0 text-success" aria-hidden="true" />
            <span>{t.t(`LaunchChecklist.coverage`, COUNTS)}</span>
          </p>
          <div class="min-h-8 noscript:hidden print:hidden">
            <ChecklistActions
              copy={t.t(`LaunchChecklist.copyLink`)}
              copied={t.t(`LaunchChecklist.linkCopied`)}
              copyFailed={t.t(`LaunchChecklist.copyFailed`)}
              printLabel={t.t(`LaunchChecklist.print`)}
            />
          </div>
        </PageHero>
        <div class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:px-8 lg:py-16 print:block print:py-4">
          <div class="flex flex-col gap-6 lg:sticky lg:top-24 lg:col-span-3 lg:self-start print:hidden">
            <LaunchChecklist
              language={language}
              messages={siteCatalogSubset(language, CHECKLIST_KEYS)}
              storageKey={CHECKLIST_STORAGE_KEY}
              total={CHECKLIST_COUNTS.items}
              sections={CHECKLIST_COUNTS.sections}
            />
            <noscript>
              <p class="text-sm text-muted">{t.t(`LaunchChecklist.noScript`)}</p>
            </noscript>
            <OnThisPage links={nav} />
          </div>
          <div class="flex min-w-0 max-w-2xl flex-col gap-12 lg:col-span-9">
            <p class="flex items-start gap-2 text-sm text-muted text-pretty print:hidden">
              <IconCheck class="h-5 w-4 shrink-0 text-success" aria-hidden="true" />
              <span>{t.t(`LaunchChecklist.legend`)}</span>
            </p>
            <div id={CHECKLIST_ROOT_ID} class="flex flex-col gap-12">
              {CHECKLIST.map((section) => (
                <Section key={section.id} section={section} host={host} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div class="print:hidden">
        <CtaBand
          ask="code"
          from="checklist"
          title={t.t(`LaunchChecklist.ctaTitle`)}
          lead={t.t(`LaunchChecklist.ctaLead`)}
          code={{
            label: t.t(`LaunchChecklist.getStarted`),
            href: href(`${DOCS_PATH}/get-started`),
          }}
        />
      </div>
    </SiteFrame>
  )
})
