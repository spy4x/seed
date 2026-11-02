import type { ComponentType } from "preact"
import { type } from "arktype"
import { escapeHtml } from "@spy4x/email/html"
import type { Catalog, Translator } from "@spy4x/platform/universal/i18n"
import {
  blogFigureIds,
  type BlogFigureSchema,
  type BlogHeading,
  type BlogProblem,
  type BlogSegment,
  checkBlogFigure,
} from "@domain/blog"
import type { FigureFrame } from "./components/post-figure.tsx"

/**
 * The interactive figures a post can hold (#620): one file each in `islands/post/`, named after
 * its tag (`CostCalculator.tsx` is `<CostCalculator />`). The folder is the list: a new file is a
 * new tag, with nothing else to edit. `docs/blog.md` says how to add one.
 *
 * A tag is looked up in this map by its exact name and never turned into a path, so a post cannot
 * reach any other module; its props reach the component only after the file's `props` schema
 * accepted them. A file exports that schema as an arktype definition, a plain object, which the
 * registry compiles: Fresh ships every export of an island to the browser, and arktype there would
 * add about 190 KB and a `new Function` probe that the website's Content Security Policy blocks.
 *
 * @module
 */

/** What a file in `islands/post/` exports. */
export interface PostFigureModule {
  /** The island: the figure, drawn inside `PostFigure` so its root is `figure[data-live]`. */
  // deno-lint-ignore no-explicit-any
  default: ComponentType<any>
  /** The arktype schema of its props, compiled from the file's definition; the island gets its output. */
  props: BlogFigureSchema[`props`]
  /** What the RSS feed shows instead, from the checked props; a link to the figure when absent. */
  // deno-lint-ignore no-explicit-any
  fallback?: (props: any, t: Translator<string>) => string
}

/** A file name the folder accepts: a tag name, then `.tsx`. Tests and helpers are skipped. */
const FIGURE_FILE = /^([A-Z][A-Za-z0-9]*)\.tsx$/

/**
 * The figures by tag, from a record of modules keyed by file path. Throws on a file that does not
 * export an island and its `props` schema, so a broken figure fails the build and the tests.
 */
export function figureRegistry(
  modules: Record<string, unknown>,
): ReadonlyMap<string, PostFigureModule> {
  const figures = new Map<string, PostFigureModule>()
  for (const [path, module] of Object.entries(modules)) {
    const tag = FIGURE_FILE.exec(path.split(`/`).pop() ?? ``)?.[1]
    if (!tag) continue
    const { default: island, props, fallback } = module as Record<string, unknown>
    if (
      typeof island !== `function` || typeof props !== `object` || props === null ||
      (fallback !== undefined && typeof fallback !== `function`)
    ) {
      throw new Error(`${path} must export the island as default and its arktype props definition`)
    }
    figures.set(tag, { ...(module as PostFigureModule), props: type.raw(props) })
  }
  return figures
}

/** Deno's directory listing, typed here: the admin app type-checks this file without Deno's types. */
interface FolderReader {
  readDir(folder: URL): AsyncIterable<{ isFile: boolean; name: string }>
}

/** Every figure module of a folder, read from disk: how Deno loads them without Vite (tests). */
export async function readFigureFolder(folder: URL): Promise<Record<string, unknown>> {
  const modules: Record<string, unknown> = {}
  const { Deno } = globalThis as unknown as { Deno: FolderReader }
  for await (const entry of Deno.readDir(folder)) {
    if (!entry.isFile || !FIGURE_FILE.test(entry.name)) continue
    modules[entry.name] = await import(/* @vite-ignore */ new URL(entry.name, folder).href)
  }
  return modules
}

/** The folder imported statically under Vite (the website's build and the admin app). */
const BUNDLED: Record<string, unknown> | undefined = (import.meta as { env?: unknown }).env
  // @ts-ignore: Vite replaces `import.meta.glob`; Deno's types do not know it.
  ? import.meta.glob(`./islands/post/*.tsx`, { eager: true })
  : undefined

let loaded: Promise<ReadonlyMap<string, PostFigureModule>> | undefined

/**
 * The site's figures. Under Vite each island is the very module Fresh hydrates; Deno alone (the
 * tests) reads the folder from disk instead.
 */
export function postFigures(): Promise<ReadonlyMap<string, PostFigureModule>> {
  loaded ??= BUNDLED
    ? Promise.resolve(figureRegistry(BUNDLED))
    : readFigureFolder(new URL(/* @vite-ignore */ `./islands/post/`, import.meta.url))
      .then(figureRegistry)
  return loaded
}

/** A figure that passed its check, ready to draw. */
export interface ResolvedFigure {
  kind: `figure`
  tag: string
  /** Its `id`: the tag in kebab case, numbered on repeat. */
  id: string
  props: Record<string, unknown>
  figure: PostFigureModule
}

/** A body ready to draw: its HTML chunks and the figures that passed, and the tags that did not. */
export interface ResolvedBody {
  parts: ({ kind: `html`; html: string } | ResolvedFigure)[]
  problems: BlogProblem[]
}

/**
 * Checks every component tag of a body against `figures`. A tag that fails is left out, not even
 * a wrapper, and comes back in `problems`; each figure gets an id no heading has.
 */
export function resolveBody(
  segments: readonly BlogSegment[],
  headings: readonly BlogHeading[],
  figures: ReadonlyMap<string, PostFigureModule>,
): ResolvedBody {
  const problems: BlogProblem[] = []
  const parts: (ResolvedBody[`parts`][number] | Omit<ResolvedFigure, `id`>)[] = []
  for (const segment of segments) {
    if (segment.kind === `html`) {
      parts.push(segment)
      continue
    }
    const check = checkBlogFigure(segment, figures)
    if (check.ok) {
      parts.push({
        kind: `figure`,
        tag: segment.tag,
        props: check.props,
        figure: figures.get(segment.tag)!,
      })
    } else problems.push(check.problem)
  }
  const shown = parts.filter((part) => part.kind === `figure`)
  const ids = blogFigureIds(shown.map((part) => part.tag), headings.map((heading) => heading.id))
  return {
    parts: parts.map((part) =>
      part.kind === `figure` ? { ...part, id: ids[shown.indexOf(part)] } : part
    ) as ResolvedBody[`parts`],
    problems,
  }
}

/** Logs one warning naming a post's tags that no figure accepted: the line and the tag of each. */
export function warnHiddenFigures(slug: string, problems: readonly BlogProblem[]): void {
  if (problems.length === 0) return
  const lines = problems.map(({ line, tag, code }) => `line ${line} <${tag}> (${code})`)
  console.warn(`Blog post "${slug}": these figures show nothing: ${lines.join(`; `)}`)
}

/** The words a figure's island needs: the `Explorable.*` and `PostFigure.*` strings, merged. */
export function figureMessages(catalogs: readonly Catalog[]): Catalog {
  return Object.fromEntries(
    catalogs.flatMap((catalog) => Object.entries(catalog))
      .filter(([key]) => /^(Explorable|PostFigure)\./.test(key)),
  )
}

/** The props an island gets: its checked props and the frame `PostFigure` draws. */
export function islandProps(
  part: ResolvedFigure,
  language: string,
  messages: Catalog,
): Record<string, unknown> & { figure: FigureFrame } {
  return { ...part.props, figure: { id: part.id, language, messages } }
}

/**
 * A body as one HTML string for the RSS feed, where no island runs: each figure becomes its
 * file's `fallback` text, or a link to it on the post's page (`postUrl#id`), in a paragraph.
 * Tags that fail show nothing, as on the page.
 */
export function feedHtml(
  parts: ResolvedBody[`parts`],
  postUrl: string,
  t: Translator<string>,
): string {
  return parts.map((part) => {
    if (part.kind === `html`) return part.html
    const text = part.figure.fallback?.(part.props, t)
    if (text !== undefined) return `<p>${escapeHtml(text)}</p>\n`
    const href = escapeHtml(`${postUrl}#${part.id}`)
    // The link goes in where the message names it, so each language keeps its own word order.
    const words = escapeHtml(t.t(`PostFigure.rssLink`, { link: `\u0000` }))
    return `<p>${words.replace(`\u0000`, `<a href="${href}">${href}</a>`)}</p>\n`
  }).join(``)
}
