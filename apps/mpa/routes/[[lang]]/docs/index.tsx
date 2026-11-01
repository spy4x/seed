// deno-lint-ignore-file ui-text/no-literal
// The docs are English at every language's address: they are the repository's own guides, which
// are written in English only. The frame around them is translated.
import type { JSX } from "preact"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { API_DOCS_PATH } from "../../../api-docs.ts"
import { DOCS_PATH, PUBLISHED_DOCS, readDoc } from "../../../docs-site.ts"
import { DEFAULT_LANGUAGE } from "../../../languages.ts"
import { SITE_NAME, siteBreadcrumbsJsonLd, SiteFrame } from "../../../site.tsx"
import { useSite } from "../../../use-site.tsx"
import { define } from "../../../utils.ts"

/** The index's title and description, for its head, the sitemap and `llms.txt`. */
export const DOCS_HEAD = {
  title: `Seed docs: run, build on and deploy the starter`,
  description:
    `How to run, build on and deploy Seed. The same guides as the repository's docs folder, kept in step with main.`,
}

/** One card of the index: a guide or the API reference. */
interface DocCard {
  href: string
  title: string
  summary: string
}

/**
 * `/docs`: every published guide as a card under its group, "Use" then "Build", with the API
 * reference as the last guide to build with.
 */
export default define.page(function DocsIndex({ state }) {
  const { t, language, href } = useSite()
  const origin = state.webAppOrigin
  const url = `${origin}${DOCS_PATH}`
  const groups = PUBLISHED_DOCS.map((group, index) => ({
    title: group.title,
    cards: [
      ...group.docs.map(({ slug, summary }): DocCard => ({
        href: href(`${DOCS_PATH}/${slug}`),
        title: readDoc(slug, href)!.title,
        summary,
      })),
      ...(index === PUBLISHED_DOCS.length - 1
        ? [{
          href: href(API_DOCS_PATH),
          title: `API reference`,
          summary: `Personal API tokens and the notes endpoints, with examples.`,
        }]
        : []),
    ],
  }))
  return (
    <SiteFrame
      state={state}
      path={DOCS_PATH}
      head={{
        ...DOCS_HEAD,
        oneLanguage: true,
        jsonLd: [
          {
            "@type": `CollectionPage`,
            "@id": `${url}#webpage`,
            url,
            name: DOCS_HEAD.title,
            description: DOCS_HEAD.description,
            inLanguage: DEFAULT_LANGUAGE,
            isPartOf: { "@id": `${origin}/#website` },
          },
          siteBreadcrumbsJsonLd(origin, DOCS_PATH, `Docs`),
        ],
      }}
    >
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {language !== DEFAULT_LANGUAGE && (
          <p class="text-sm text-muted" data-e2e="english-only">{t.t(`LegalPage.englishOnly`)}</p>
        )}
        <div lang={DEFAULT_LANGUAGE} dir="ltr" class="flex flex-col gap-12">
          <header class="flex max-w-2xl flex-col gap-4">
            <Breadcrumbs
              label="Breadcrumb"
              items={[{ label: SITE_NAME, href: href(`/`) }, { label: `Docs` }]}
            />
            <h1 class="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
              {SITE_NAME} docs
            </h1>
            <p class="text-lg text-muted text-pretty">
              How to run, build on and deploy {SITE_NAME}. The same guides as the repository's{" "}
              <code dir="ltr">docs</code> folder, kept in step with <code dir="ltr">main</code>.
            </p>
          </header>
          {groups.map((group) => <CardGroup key={group.title} {...group} />)}
        </div>
      </div>
    </SiteFrame>
  )
})

/** One group of the index: its heading and its guides as cards. */
function CardGroup({ title, cards }: { title: string; cards: readonly DocCard[] }): JSX.Element {
  const id = `docs-${title.toLowerCase()}`
  return (
    <section aria-labelledby={id} class="flex flex-col gap-4" data-e2e="docs-group">
      <h2 id={id} class="text-2xl font-semibold tracking-tight">{title}</h2>
      <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.href} class="flex">
            <a
              href={card.href}
              class="flex w-full flex-col gap-1 rounded-card border border-subtle bg-surface p-4 transition-colors hover:border-strong focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span class="font-semibold text-foreground text-balance">{card.title}</span>
              <span class="text-sm text-muted text-pretty">{card.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
