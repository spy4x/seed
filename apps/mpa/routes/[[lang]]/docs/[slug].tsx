// deno-lint-ignore-file ui-text/no-literal
// The docs are English at every language's address: they are the repository's own guides, which
// are written in English only. The frame around them is translated.
import type { JSX } from "preact"
import type { FreshContext } from "fresh"
import { breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { Button } from "@spy4x/preact-ui/button"
import { DOCS_NAV_LABELS, DocsNav } from "@spy4x/preact-ui/docs-nav"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { PREV_NEXT_LABELS, PrevNext } from "@spy4x/preact-ui/prev-next"
import { Prose, PROSE_LABELS } from "@spy4x/preact-ui/prose"
import { REPOSITORY_URL } from "../../../brand.ts"
import { CHANGELOG_FORMAT } from "../../../changelog.ts"
import {
  docNeighbours,
  DOCS_PATH,
  docsNavGroups,
  readDoc,
  type SiteDoc,
} from "../../../docs-site.ts"
import { DEFAULT_LANGUAGE, localePath } from "../../../languages.ts"
import { PERSON_JSON_LD, SITE_NAME, SiteFrame } from "../../../site.tsx"
import { SiteLanguage, useSite } from "../../../use-site.tsx"
import { define, type State } from "../../../utils.ts"

/**
 * A guide's `<title>`: its heading, then "Seed docs", or the heading alone when it names Seed
 * already, so no title says "Seed" twice.
 */
export function docTitle(title: string): string {
  return title.includes(SITE_NAME) ? title : `${title}: ${SITE_NAME} docs`
}

/** What the page says for a guide that is not published. */
export const DOC_NOT_FOUND = {
  title: `This doc isn't here`,
  description: `It may have moved or been renamed. All docs are listed on the docs page.`,
}

/**
 * `/docs/<slug>`: one published guide of `docs/`, its links pointed at the website
 * (`rewriteDocLinks`). Any other name, an internal doc included, answers 404.
 */
export const handler = define.handlers({
  GET(ctx) {
    const slug = ctx.params.slug ?? ``
    const localize = (path: string) => localePath(ctx.state.language, path)
    const doc = readDoc(slug, localize)
    if (!doc) return renderNotFound(ctx)
    const path = `${DOCS_PATH}/${slug}`
    return ctx.render(
      <SiteLanguage language={ctx.state.language}>
        <SiteFrame
          state={ctx.state}
          path={path}
          head={{
            title: docTitle(doc.title),
            description: doc.description,
            oneLanguage: true,
            ogType: `article`,
            jsonLd: docJsonLd(ctx.state.webAppOrigin, path, doc),
          }}
        >
          <DocPage doc={doc} />
        </SiteFrame>
      </SiteLanguage>,
    )
  },
})

/** The guide's structured data: a `TechArticle` and its trail, Seed › Docs › the guide. */
function docJsonLd(origin: string, path: string, doc: SiteDoc): unknown[] {
  const url = `${origin}${path}`
  return [
    {
      "@type": `TechArticle`,
      "@id": `${url}#article`,
      url,
      headline: doc.title,
      description: doc.description,
      inLanguage: DEFAULT_LANGUAGE,
      ...(doc.updated ? { dateModified: doc.updated } : {}),
      author: { "@type": `Person`, "@id": PERSON_JSON_LD["@id"], name: PERSON_JSON_LD.name },
      isPartOf: { "@id": `${origin}/#website` },
      mainEntityOfPage: url,
    },
    breadcrumbListJsonLd(url, [
      { name: SITE_NAME, href: `${origin}/` },
      { name: `Docs`, href: `${origin}${DOCS_PATH}` },
      { name: doc.title },
    ]),
  ]
}

const LINK = `font-medium text-primary underline`

/**
 * The guide: its trail, heading and dates, the guides beside it and its sections, then its body,
 * where it lives on GitHub and the guides before and after it. From 1280 px the guides stand on
 * the left and the sections on the right; from 1024 px the sections fold above the body; on a
 * phone both fold at the top.
 */
function DocPage({ doc }: { doc: SiteDoc }): JSX.Element {
  const { t, language, href } = useSite()
  const current = href(`${DOCS_PATH}/${doc.slug}`)
  const { previous, next } = docNeighbours(doc.slug)
  const neighbour = (slug: string | undefined) =>
    slug === undefined
      ? undefined
      : { href: href(`${DOCS_PATH}/${slug}`), title: readDoc(slug, href)!.title }
  const sections = doc.headings.filter(({ depth }) => depth === 2)
    .map(({ id, text }) => ({ label: text, href: `#${id}` }))
  const updated = doc.updated && (
    <>
      Last updated <time dateTime={doc.updated}>{CHANGELOG_FORMAT.date(doc.updated)}</time>
    </>
  )
  const edit = `${REPOSITORY_URL}/edit/main/${doc.source}`
  return (
    <div class="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      {language !== DEFAULT_LANGUAGE && (
        <p class="mb-6 text-sm text-muted" data-e2e="english-only">
          {t.t(`LegalPage.englishOnly`)}
        </p>
      )}
      <div
        lang={DEFAULT_LANGUAGE}
        dir="ltr"
        class="flex flex-col gap-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-[auto_auto_auto_1fr] lg:gap-x-12 xl:grid-cols-[15rem_minmax(0,42rem)_minmax(0,1fr)] xl:grid-rows-[auto_auto_1fr]"
      >
        <header class="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <Breadcrumbs
            label="Breadcrumb"
            items={[
              { label: SITE_NAME, href: href(`/`) },
              { label: `Docs`, href: href(DOCS_PATH) },
              { label: doc.title },
            ]}
          />
          <h1 class="text-3xl font-semibold tracking-tight text-balance break-words hyphens-auto lg:text-4xl">
            {doc.title}
          </h1>
          <p class="text-sm text-muted" data-e2e="doc-meta">
            {updated}
            {updated && ` · `}
            {doc.minutes} min read
          </p>
        </header>
        <DocsNav
          groups={docsNavGroups(href)}
          current={current}
          labels={DOCS_NAV_LABELS}
          class="lg:col-start-1 lg:row-span-4 lg:row-start-1"
        />
        {sections.length > 0 && (
          <aside class="min-w-0 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-span-3 xl:row-start-1">
            <OnThisPage links={sections} label="On this page" openFrom="xl" />
          </aside>
        )}
        <Prose
          as="article"
          html={doc.html}
          anchors
          labels={PROSE_LABELS}
          class="min-w-0 lg:col-start-2 lg:row-start-3 xl:row-start-2"
        />
        <footer class="flex min-w-0 flex-col gap-6 border-t border-subtle pt-6 lg:col-start-2 lg:row-start-4 xl:row-start-3">
          <p class="text-sm text-muted" data-e2e="doc-edit">
            {updated}
            {updated && ` · `}
            <a href={edit} rel="noopener noreferrer" class={LINK}>
              Edit this page on GitHub<span aria-hidden="true">{` ↗`}</span>
            </a>
          </p>
          <PrevNext
            previous={neighbour(previous)}
            next={neighbour(next)}
            labels={PREV_NEXT_LABELS}
          />
        </footer>
      </div>
    </div>
  )
}

/** The 404 of a guide that is not published: why, and the way to the ones that are. */
function renderNotFound(ctx: FreshContext<State>): Response | Promise<Response> {
  return ctx.render(
    <SiteLanguage language={ctx.state.language}>
      <SiteFrame
        state={ctx.state}
        path={ctx.url.pathname}
        head={{ ...DOC_NOT_FOUND, noindex: true }}
      >
        <section
          aria-labelledby="doc-missing"
          lang={DEFAULT_LANGUAGE}
          dir="ltr"
          class="site-glow flex min-h-[60vh] items-center"
          data-e2e="doc-missing"
          data-analytics-view="not-found"
        >
          <div class="mx-auto flex w-full max-w-md flex-col items-start gap-6 px-4 py-16">
            <p class="font-mono text-6xl font-semibold text-muted" aria-hidden="true">404</p>
            <h1 id="doc-missing" class="text-3xl font-semibold tracking-tight">
              {DOC_NOT_FOUND.title}
            </h1>
            <p class="text-muted text-pretty">{DOC_NOT_FOUND.description}</p>
            <Button href={localePath(ctx.state.language, DOCS_PATH)}>See all docs</Button>
          </div>
        </section>
      </SiteFrame>
    </SiteLanguage>,
    { status: 404 },
  )
}
