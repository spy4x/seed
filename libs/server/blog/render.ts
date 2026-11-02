import { renderMarkdownSegments } from "@spy4x/platform/universal/markdown"
import { readingMinutes } from "@spy4x/platform/universal/text"
import type {
  BlogPreviewBody,
  BlogPreviewSegment,
  BlogProblem,
  RenderedBlogBody,
} from "@domain/blog"

/**
 * Renders a post's Markdown to HTML that is safe to put on the public page, split around its
 * component tags (#620), with its headings for "On this page", the tag lines the parser could not
 * use, its word count and its reading time (at least one minute). Every page that shows a body
 * (the public post, the RSS feed, the admin preview) renders it here, so they all agree.
 *
 * This is the only place that turns Markdown into HTML. `renderMarkdownSegments` escapes raw HTML,
 * keeps only `http`, `https`, `mailto` and relative addresses, and gives every heading an id. It
 * checks no component: `checkBlogFigure` does, against the components that exist.
 */
export function renderBlogBody(markdown: string): RenderedBlogBody {
  const { segments, headings, problems } = renderMarkdownSegments(markdown)
  return { segments, headings, problems: problems.map(toBlogProblem), ...blogBodyLength(markdown) }
}

/** The tag the admin preview puts where a tag line could not be used; the preview draws a marker. */
const MARKER = `BlogProblem`

/**
 * Renders a body for the admin preview: as {@link renderBlogBody}, with a `problem` segment where
 * each tag line the parser could not use sits. A tag inside a list or a quote gets its marker on
 * its own line there, which ends that list or quote in the preview only.
 */
export function renderBlogPreview(markdown: string): BlogPreviewBody {
  const body = renderBlogBody(markdown)
  if (body.problems.length === 0) return body
  const lines = markdown.replace(/\r\n|\r/g, `\n`).split(`\n`)
  for (const { line } of body.problems) lines[line - 1] = `\n<${MARKER} at={${line}} />\n`
  const marked = renderMarkdownSegments(lines.join(`\n`)).segments
  // The markers shifted the lines below them; the first render's components keep the true ones.
  const components = body.segments.filter((segment) => segment.kind === `component`)
  let next = 0
  const segments: BlogPreviewSegment[] = marked.map((segment) => {
    if (segment.kind !== `component`) return segment
    if (segment.tag === MARKER && typeof segment.props.at === `number`) {
      return { kind: `problem`, line: segment.props.at }
    }
    return components[next++] ?? segment
  })
  return { ...body, segments }
}

/** A parser problem, worded by its code; `detail` keeps the parser's reason after the tag. */
function toBlogProblem(
  problem: { line: number; code: `nested` | `syntax`; tag: string; message: string },
): BlogProblem {
  const { line, code, tag, message } = problem
  return { line, code, tag, detail: message.replace(/^<[^>]*>: /, ``) }
}

/**
 * How many words a post's Markdown has, and how many minutes it takes to read: at least one. The
 * blog index reads this for every post without rendering any.
 */
export function blogBodyLength(markdown: string): { words: number; readingMinutes: number } {
  return {
    words: markdown.match(/\S+/g)?.length ?? 0,
    readingMinutes: readingMinutes(markdown),
  }
}
