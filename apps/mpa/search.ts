/**
 * The website's search index: what Ctrl/⌘+K in the header (`islands/site-search.tsx`), `/search.json`
 * and the `/search` page search. A product changes its search results here: the pages come from
 * `SITE_PAGES`, the sections from the pages in {@link SECTION_PAGES} as they render, and the extra
 * words people search by from {@link SEARCH_ALIASES}. The texts are English in every language for
 * now; the links go to the visitor's language.
 *
 * @module
 */
import { type FunctionComponent, h } from "preact"
import { renderToString } from "preact-render-to-string"
import { createIndex, type SearchEntry, type SearchIndex } from "@spy4x/search"
import type { Language } from "@domain/identity"
import { DEFAULT_LANGUAGE, localePath, siteTranslator } from "./languages.ts"
import { livePages } from "./pages.ts"
import { searchGroups } from "./search-paths.ts"
import Admin from "./routes/[[lang]]/admin.tsx"
import Compare from "./routes/[[lang]]/compare.tsx"
import Features from "./routes/[[lang]]/features.tsx"
import Pricing from "./routes/[[lang]]/pricing.tsx"
import { SiteLanguage } from "./use-site.tsx"
import type { State } from "./utils.ts"

/**
 * The longest query searched, in characters; a longer one is cut. Each word is one more pass over
 * the index, so this bounds what one request can cost.
 */
export const MAX_QUERY_LENGTH = 100

/** A page whose sections are indexed, and the catalog key of its short name ("in Pricing"). */
interface SectionPage {
  path: string
  name: string
  /** The page's component, as its route exports it. */
  page: unknown
}

/** The pages whose sections get an entry each: every `h2` and `h3` with an `id` they render. */
export const SECTION_PAGES: readonly SectionPage[] = [
  { path: `/features`, name: `SiteNav.features`, page: Features },
  { path: `/pricing`, name: `SiteNav.pricing`, page: Pricing },
  // Seed's own site: see docs/start-a-product.md
  { path: `/compare`, name: `SiteNav.compare`, page: Compare },
  { path: `/admin`, name: `SiteFooter.admin`, page: Admin },
]

/** Headings no entry gets: the closing call to action every page repeats. */
const SKIPPED_HEADINGS: ReadonlySet<string> = new Set([`cta-title`])

/**
 * Words people search by that a page or section does not use, keyed by the page's path or by
 * `<path>#<heading id>`, each on the entry that answers it.
 */
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "/pricing": [`price`, `cost`, `free`, `licence`, `license`, `MIT`],
  // Each compared starter has a section of its own, its name the heading, so a name finds that
  // section before the page. Seed's own site: see docs/start-a-product.md
  "/compare": [`vs`, `versus`, `alternative`, `alternatives`],
  "/features#deploy-title": [`self-host`, `docker`, `deploy`, `hetzner`],
  "/features#billing-title": [`stripe`, `payments`, `subscriptions`],
}

/** One section a page renders: its heading's id and text, and the text up to the next heading. */
export interface PageSection {
  id: string
  heading: string
  text: string
}

/** The characters `preact-render-to-string` escapes in text and attributes, and a few more. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: `&`,
  lt: `<`,
  gt: `>`,
  quot: `"`,
  apos: `'`,
  nbsp: ` `,
}

/** Text of a piece of markup: scripts, styles and drawings dropped, tags as spaces, entities read. */
export function markupText(html: string): string {
  return html
    .replace(/<(script|style|svg|template)\b[\s\S]*?<\/\1>/g, ` `)
    .replace(/<[^>]+>/g, ` `)
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name[0] !== `#`) return ENTITIES[name.toLowerCase()] ?? entity
      const code = name[1] === `x` || name[1] === `X`
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10)
      return String.fromCodePoint(code)
    })
    .replace(/\s+/g, ` `)
    .trim()
}

/**
 * The sections of a page's markup: each `h2` and `h3` with an `id` inside `<main>`, with the text
 * from it to the next such heading. The closing call to action is left out.
 *
 * @param html The whole page, as the server renders it.
 */
export function pageSections(html: string): PageSection[] {
  const main = html.match(/<main\b[\s\S]*<\/main>/)?.[0] ?? ``
  const headings = [...main.matchAll(/<(h[23])\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)]
  return headings.flatMap((heading, index) => {
    const id = heading[2]
    if (SKIPPED_HEADINGS.has(id)) return []
    const start = heading.index + heading[0].length
    const end = headings[index + 1]?.index ?? main.length
    return [{ id, heading: markupText(heading[3]), text: markupText(main.slice(start, end)) }]
  })
}

/** The state the indexed pages render with: the texts do not depend on it. */
const RENDER_STATE = {
  language: DEFAULT_LANGUAGE,
  webAppOrigin: `https://www.example.com`,
  spaOrigin: `https://app.example.com`,
  newsletter: false,
  notes: true,
} as State

/** Each section page's sections, rendered once, in English. */
let renderedSections: { page: SectionPage; sections: PageSection[] }[] | undefined

/** {@link SECTION_PAGES} with their sections, rendered on the first call. */
function sectionPages(): { page: SectionPage; sections: PageSection[] }[] {
  renderedSections ??= SECTION_PAGES.map((page) => ({
    page,
    sections: pageSections(
      renderToString(
        h(SiteLanguage, {
          language: DEFAULT_LANGUAGE,
          children: h(page.page as FunctionComponent<{ state: State }>, { state: RENDER_STATE }),
        }),
      ),
    ),
  }))
  return renderedSections
}

/** What the index depends on: the visitor's language, for the links, and what is switched on. */
export interface SiteSearchScope {
  language: Language
  newsletter: boolean
  notes: boolean
}

/**
 * The website's entries for `scope`: every live page, then every section of the section pages.
 * Each links to the page's address in `scope.language`, or its English one for a page that is
 * English everywhere.
 *
 * @param scope The visitor's language and the switches the request state holds.
 */
export function siteSearchEntries(scope: SiteSearchScope): SearchEntry[] {
  const t = siteTranslator(scope.language)
  const groups = searchGroups(t)
  const pages = livePages(scope).map((page): SearchEntry => ({
    label: page.title,
    aliases: [...SEARCH_ALIASES[page.path] ?? []],
    detail: page.description,
    group: groups.pages,
    href: page.oneLanguage ? page.path : localePath(scope.language, page.path),
  }))
  const sections = sectionPages().flatMap(({ page, sections }) =>
    sections.map((section): SearchEntry => ({
      label: section.heading,
      aliases: [...SEARCH_ALIASES[`${page.path}#${section.id}`] ?? []],
      detail: t.t(`SiteIndex.in`, { page: t.t(page.name) }),
      text: section.text,
      group: groups.sections,
      href: `${localePath(scope.language, page.path)}#${section.id}`,
    }))
  )
  return [...pages, ...sections]
}

/** A built index and its JSON, per scope. */
const built = new Map<string, { index: SearchIndex; json: string }>()

/**
 * The index for `scope`, built on its first use and kept: at most one per language and switch.
 *
 * @param scope The visitor's language and the switches the request state holds.
 */
export function siteSearchIndex(scope: SiteSearchScope): { index: SearchIndex; json: string } {
  const key = `${scope.language}|${scope.newsletter}|${scope.notes}`
  let found = built.get(key)
  if (!found) {
    const index = createIndex(siteSearchEntries(scope))
    found = { index, json: JSON.stringify(index) }
    built.set(key, found)
  }
  return found
}

/**
 * The query as it is searched: trimmed and cut to {@link MAX_QUERY_LENGTH} characters, never
 * splitting one.
 */
export function searchQuery(query: string | null): string {
  return [...(query ?? ``).trim()].slice(0, MAX_QUERY_LENGTH).join(``).trim()
}
