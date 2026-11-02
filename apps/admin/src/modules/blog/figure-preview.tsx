import { h } from "preact"
import uiEn from "@spy4x/preact-ui/i18n/en"
import {
  blogFigureIds,
  type BlogPreviewBody,
  type BlogProblem,
  checkBlogFigure,
} from "@domain/blog"
import type { BlogPreview, BlogPreviewPart } from "@ui/admin-blog-editor.tsx"
import siteEn from "@i18n/site/en.ts"
import {
  figureMessages,
  islandProps,
  type PostFigureModule,
  postFigures,
} from "../../../../mpa/post-figures.tsx"

/**
 * The editor's figures (#620): the public website's own islands (`apps/mpa/islands/post/`), so the
 * Preview tab draws each figure live, as a reader sees it. The state loads this module on demand,
 * which keeps the islands and their words out of the admin app's first download.
 *
 * @module
 */

/** A rendered body with its figures checked: what the Preview tab draws and what the panel lists. */
export interface CheckedPreview {
  preview: BlogPreview
  /** The parser's problems and the figures', by line. */
  problems: BlogProblem[]
}

/** What the editor needs of the figures: a check of a rendered body, and a tag for the hint. */
export interface FigurePreview {
  check: (body: BlogPreviewBody) => CheckedPreview
  /** A tag that exists, such as `<CostCalculator />`, or `null` when the site has no figure. */
  example: string | null
}

/**
 * Checks every component tag of a preview against `figures`, as the public page does: a figure
 * that passes is drawn live with the id the page gives it, and a tag that fails becomes a marker
 * at its line, next to the parser's own.
 */
export function checkPreview(
  body: BlogPreviewBody,
  figures: ReadonlyMap<string, PostFigureModule>,
): CheckedPreview {
  // The figures' words in English, the admin's base language: the preview checks what a figure
  // shows, and one catalog keeps the download small.
  const messages = figureMessages([uiEn, siteEn])
  const problems: BlogProblem[] = [...body.problems]
  const checked = body.segments.map((segment) => {
    if (segment.kind !== `component`) return segment
    const check = checkBlogFigure(segment, figures)
    if (check.ok) return { ...segment, props: check.props }
    problems.push(check.problem)
    return { kind: `problem` as const, line: segment.line }
  })
  const shown = checked.filter((segment) => segment.kind === `component`)
  const ids = blogFigureIds(shown.map((segment) => segment.tag), body.headings.map(({ id }) => id))
  const parts: BlogPreviewPart[] = checked.map((segment) => {
    if (segment.kind !== `component`) return segment
    const id = ids[shown.indexOf(segment)]
    const figure = figures.get(segment.tag)!
    const props = islandProps(
      { kind: `figure`, tag: segment.tag, id, props: segment.props, figure },
      `en`,
      messages,
    )
    return { kind: `figure`, id, node: h(figure.default, props) }
  })
  return {
    preview: { parts, words: body.words, readingMinutes: body.readingMinutes },
    problems: problems.sort((a, b) => a.line - b.line),
  }
}

/** Loads the website's figures and returns the editor's check against them. */
export async function loadFigurePreview(): Promise<FigurePreview> {
  const figures = await postFigures()
  const first = [...figures.keys()].sort()[0]
  return {
    check: (body) => checkPreview(body, figures),
    example: first ? `<${first} />` : null,
  }
}
