import type { DocsNavGroup } from "@spy4x/preact-ui/docs-nav"
import { type MarkdownHeading, renderMarkdown } from "@spy4x/platform/universal/markdown"
import { readingMinutes } from "@spy4x/platform/universal/text"
import { API_DOCS_PATH } from "./api-docs.ts"
import { REPOSITORY_URL } from "./brand.ts"
import { CHANGELOG } from "./changelog.ts"
import { DOCS_SITE_ORIGIN, PUBLISHED_DOCS } from "./docs-list.ts"

export { DOCS_SITE_ORIGIN, PUBLISHED_DOCS }

/** The docs' index. */
export const DOCS_PATH = `/docs`

/** One published guide: its file, its address and its line on the index. */
export interface PublishedDoc {
  /** The file from the repository's root: `docs/deploy.md`, or `docs/<product>/install.md`. */
  file: string
  /** Its address under `/docs/`. */
  slug: string
  /** Its line on the index. */
  summary: string
  /** Its Markdown, imported `with { type: "text" }`. */
  text: string
}

/** One group of the docs' index and side list, such as `Get started`. */
export interface PublishedDocGroup {
  title: string
  docs: readonly PublishedDoc[]
}

/** One published guide, ready to draw. */
export interface SiteDoc {
  slug: string
  /** The file's `#` heading. */
  title: string
  /** The group it is listed under: `Get started`, `Guides`, `Concepts` or `Reference`. */
  group: string
  /** Its line on the index. */
  summary: string
  /** Its first sentence, at most 155 characters, for the meta description. */
  description: string
  /** The body as HTML, its links rewritten for the website (`rewriteDocLinks`). */
  html: string
  headings: MarkdownHeading[]
  minutes: number
  /** The file, from the repository's root. */
  source: string
  /** The file's last commit, ISO 8601, from `deno task changelog`; `undefined` without it. */
  updated?: string
}

/** A guide's pointer to its copy on the website, the line under its heading. */
export function pointerLine(slug: string): string {
  const url = `${DOCS_SITE_ORIGIN}${DOCS_PATH}/${slug}`
  return `> Also on the website: [${url.replace(`https://`, ``)}](${url}).`
}

/** Every published guide, in reading order. */
export const PUBLISHED_GUIDES: readonly PublishedDoc[] = PUBLISHED_DOCS.flatMap(({ docs }) => docs)

/** Every published slug, in reading order. */
export const DOC_SLUGS: readonly string[] = PUBLISHED_GUIDES.map(({ slug }) => slug)

const PUBLISHED = new Set(DOC_SLUGS)

/** Whether `slug` names a published guide. */
export function isPublishedDoc(slug: string): boolean {
  return PUBLISHED.has(slug)
}

/** An address that leaves this repository's files: another site, a mail, a protocol-relative one. */
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** The external-link mark after a link to GitHub, as `SiteHeader` draws one: an arrow, hidden from readers. */
const EXTERNAL_MARK =
  `<span aria-hidden="true" data-doc-external=""> ↗</span><span class="sr-only"> (on GitHub)</span>`

/**
 * `html` with each link of the published guide `self` pointed at its place on the website. A
 * relative link resolves against the folder of `self`'s file (`docs/` without `self`); a link to
 * a file of `groups` goes to `localize("/docs/<slug>")`, the API reference to its page, an anchor
 * in the page stays, and any other file of the repository goes to that file on GitHub at `main`,
 * marked as leaving the site. Links to other sites are left alone.
 */
export function rewriteDocLinks(
  html: string,
  localize: (path: string) => string,
  self?: string,
  groups: readonly PublishedDocGroup[] = PUBLISHED_DOCS,
): string {
  const guides = groups.flatMap(({ docs }) => docs)
  const own = guides.find(({ slug }) => slug === self)
  const base = new URL(own?.file ?? `docs/`, `https://repo.invalid/`)
  return html.replace(
    /<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g,
    (link, href: string, rest, text) => {
      if (href.startsWith(`#`)) {
        return own === undefined ? link : `<a href="${siteAnchor(own, href)}"${rest}>${text}</a>`
      }
      if (ELSEWHERE.test(href)) return link
      const target = new URL(href.replaceAll(`&amp;`, `&`), base)
      const path = decodeURIComponent(target.pathname).slice(1)
      const doc = guides.find(({ file }) => file === path)
      if (doc !== undefined) {
        const hash = siteAnchor(doc, target.hash)
        return `<a href="${localize(`${DOCS_PATH}/${doc.slug}`)}${hash}"${rest}>${text}</a>`
      }
      if (path === `docs/token-api.md`) {
        return `<a href="${localize(API_DOCS_PATH)}${target.hash}"${rest}>${text}</a>`
      }
      const kind = path.endsWith(`/`) ? `tree` : `blob`
      const url = `${REPOSITORY_URL}/${kind}/main${target.pathname}${target.hash}`
      return `<a href="${url}" rel="noopener noreferrer"${rest}>${text}${EXTERNAL_MARK}</a>`
    },
  )
}

/** A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as hyphens. */
function githubAnchor(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, ``).replace(/\s/g, `-`)
}

/** A guide's Markdown without its `#` heading and its pointer line, which the page draws itself. */
function docBody(source: string): string {
  return source.replace(/^# .*\n/m, ``).replace(/^> Also on the website: .*\n/m, ``)
}

const HEADINGS = new Map<string, MarkdownHeading[]>()

/**
 * `hash` (`#…` or empty) pointed at its heading in the published guide `doc`. The guides are
 * written for GitHub, whose anchors drop a `/` that the website's ids turn into a hyphen, so an
 * anchor that names no id here but matches a heading the GitHub way becomes that heading's id.
 */
function siteAnchor(doc: PublishedDoc, hash: string): string {
  const anchor = decodeURIComponent(hash.slice(1))
  if (anchor === ``) return hash
  let headings = HEADINGS.get(doc.file)
  if (!headings) HEADINGS.set(doc.file, headings = renderMarkdown(docBody(doc.text)).headings)
  if (headings.some(({ id }) => id === anchor)) return hash
  const heading = headings.find(({ text }) => githubAnchor(text) === anchor)
  return heading ? `#${heading.id}` : hash
}

/** The first sentence of `markdown`'s first paragraph, as plain text of at most 155 characters. */
export function firstSentence(markdown: string): string | undefined {
  const paragraph = markdown.split(/\n\s*\n/).map((block) => block.trim())
    .find((block) => block !== `` && !/^(?:#|>|\||[-*+] |\d+\. |```|<)/.test(block))
  if (paragraph === undefined) return undefined
  const text = paragraph.replace(/\s+/g, ` `)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, `$1`)
    .replace(/[`*_]/g, ``)
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text
  if (sentence.length <= 155) return sentence
  return `${sentence.slice(0, 154).replace(/\s+\S*$/, ``)}…`
}

const CACHE = new Map<string, SiteDoc>()

/**
 * The published guide `slug`, rendered for the page in the language `localize` writes addresses
 * in, or `undefined` for any other name: an internal doc answers 404 like an unknown one.
 */
export function readDoc(slug: string, localize: (path: string) => string): SiteDoc | undefined {
  if (!isPublishedDoc(slug)) return undefined
  const key = `${localize(``)}:${slug}`
  const cached = CACHE.get(key)
  if (cached) return cached
  const group = PUBLISHED_DOCS.find((entry) => entry.docs.some((doc) => doc.slug === slug))!
  const { file, summary, text } = group.docs.find((entry) => entry.slug === slug)!
  const title = /^# (.+)$/m.exec(text)?.[1].trim() ?? slug
  const body = docBody(text)
  const { html, headings } = renderMarkdown(body)
  const doc: SiteDoc = {
    slug,
    title,
    group: group.title,
    summary,
    description: firstSentence(body) ?? `${title}: how it works in Seed, and how to set it up.`,
    html: rewriteDocLinks(html, localize, slug),
    headings,
    minutes: readingMinutes(body),
    source: file,
    updated: CHANGELOG.docs[file],
  }
  CACHE.set(key, doc)
  return doc
}

/** The docs' side list, every published guide under its group, in `localize`'s language. */
export function docsNavGroups(localize: (path: string) => string): DocsNavGroup[] {
  return PUBLISHED_DOCS.map((group) => ({
    title: group.title,
    items: group.docs.map(({ slug }) => ({
      href: localize(`${DOCS_PATH}/${slug}`),
      title: readDoc(slug, localize)!.title,
    })),
  }))
}

/** The guides before and after `slug` in reading order, across the groups. */
export function docNeighbours(slug: string): { previous?: string; next?: string } {
  const index = DOC_SLUGS.indexOf(slug)
  return {
    previous: index > 0 ? DOC_SLUGS[index - 1] : undefined,
    next: index >= 0 && index < DOC_SLUGS.length - 1 ? DOC_SLUGS[index + 1] : undefined,
  }
}
