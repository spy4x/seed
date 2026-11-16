import { Button } from "@spy4x/preact-ui/button"
import { Input } from "@spy4x/preact-ui/input"
import { DOCS_PATH } from "../../docs-site.ts"
import { localePath, siteTranslator } from "../../languages.ts"
import { MAX_QUERY_LENGTH, searchQuery, siteSearchIndex } from "../../search.ts"
import { SEARCH_PAGE_PATH } from "../../search-paths.ts"
import { SITE_NAME, SiteFrame, spaLinks, TRY_REL } from "../../site.tsx"
import { define } from "../../utils.ts"

/** How many results the page lists. */
export const SEARCH_PAGE_RESULTS = 20

/** A link alone on its line: 44 px tall on a phone, as every touch target. */
const LINK = `inline-flex min-h-11 items-center font-medium text-primary underline sm:min-h-9`

/**
 * `/search?q=`: the header's search for a visitor without JavaScript, whose trigger links here. A
 * GET form with the query, and the results as links; with nothing found, the docs and the demo.
 * The query is cut to `MAX_QUERY_LENGTH` characters. Never indexed by search engines.
 */
export const handler = define.handlers({
  GET(ctx) {
    const language = ctx.state.language
    const t = siteTranslator(language)
    const href = (path: string) => localePath(language, path)
    const query = searchQuery(ctx.url.searchParams.get(`q`))
    const hits = query === ``
      ? []
      : siteSearchIndex(ctx.state).index.search(query, { limit: SEARCH_PAGE_RESULTS }).hits
    const spa = spaLinks(ctx.state)
    return ctx.render(
      <SiteFrame
        state={ctx.state}
        path={SEARCH_PAGE_PATH}
        head={{
          title: t.t(`SearchPage.title`),
          description: t.t(`SearchPage.description`, { site: SITE_NAME }),
          noindex: true,
        }}
      >
        <div
          class="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:py-16"
          data-e2e="search-page"
        >
          <header class="flex flex-col gap-4">
            <h1 class="text-3xl font-semibold tracking-tight text-balance lg:text-5xl">
              {t.t(`SearchPage.title`)}
            </h1>
            <form method="get" action={href(SEARCH_PAGE_PATH)} role="search" class="flex gap-2">
              <label for="search-q" class="sr-only">{t.t(`SearchPage.label`)}</label>
              <Input
                id="search-q"
                name="q"
                type="search"
                value={query}
                maxLength={MAX_QUERY_LENGTH}
                placeholder={t.t(`SearchPage.label`)}
                data-e2e="search-page-query"
              />
              <Button type="submit" data-e2e="search-page-submit">
                {t.t(`SearchPage.submit`)}
              </Button>
            </form>
          </header>
          {query === `` && <p class="text-muted text-pretty">{t.t(`SearchPage.prompt`)}</p>}
          {query !== `` && hits.length > 0 && (
            <section aria-labelledby="search-results" class="flex flex-col gap-4">
              <h2 id="search-results" class="text-xl font-semibold">
                {t.t(`SearchPage.results`, { query })}
              </h2>
              <ul class="flex flex-col gap-4" data-e2e="search-page-results">
                {hits.map(({ entry }) => (
                  <li key={entry.href} class="flex flex-col gap-1">
                    <a href={entry.href} class={LINK}>{entry.label}</a>
                    {entry.detail && <p class="text-sm text-muted text-pretty">{entry.detail}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {query !== `` && hits.length === 0 && (
            <section class="flex flex-col items-start gap-2" data-e2e="search-page-none">
              <p class="text-pretty">{t.t(`SearchPage.none`, { query })}</p>
              <a href={href(DOCS_PATH)} class={LINK}>{t.t(`SiteSearchCommand.docs`)}</a>
              <a href={spa.try} rel={TRY_REL} class={LINK}>{t.t(`SiteFrame.tryDemo`)}</a>
            </section>
          )}
        </div>
      </SiteFrame>,
    )
  },
})
