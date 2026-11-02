import { type } from "arktype"
import { convertToKebabCase, levenshtein } from "@spy4x/platform/universal/text"

/**
 * Interactive figures in a post's body (#620): a tag such as `<CostCalculator members={4} />` on
 * a line of its own. The parser splits the body around those tags; this module checks each tag
 * against the components that exist, so the public page, the RSS feed and the admin editor agree
 * on which figures show and why the others do not. `docs/blog.md` says how to write one.
 *
 * @module
 */

/** A piece of a rendered body: a chunk of safe HTML, or a component tag between two chunks. */
export type BlogSegment =
  | { kind: `html`; html: string }
  | { kind: `component`; tag: string; props: Record<string, unknown>; line: number }

/**
 * A piece of the admin preview: a body segment, or a marker where a tag that will not show sits,
 * pointing at its line.
 */
export type BlogPreviewSegment = BlogSegment | { kind: `problem`; line: number }

/**
 * Why a tag will not show:
 * - `nested`: it sits inside a list or a quote;
 * - `syntax`: its line does not read as a tag;
 * - `unknown`: no component has that name;
 * - `props`: the component refused its props.
 */
export type BlogProblemCode = `nested` | `syntax` | `unknown` | `props`

/** A tag that will not show, with its line, for the editor's Problems panel. */
export interface BlogProblem {
  /** The 1-based line in the Markdown. */
  line: number
  code: BlogProblemCode
  /** The tag's name as written. */
  tag: string
  /** The English detail: the parser's reason, or the schema's summary for `props`. */
  detail: string
  /** For `unknown`: the closest component name, when one is close. */
  suggestion?: string
  /** For `unknown`: every component name, sorted. */
  names?: string[]
}

/** What a figure needs for the check: the arktype schema of its props. */
export interface BlogFigureSchema {
  /** An arktype type: returns the props it accepts, or `type.errors` for props it refuses. */
  props: (input: unknown) => unknown
}

/** The result of checking one tag: the props its schema returned, or why it will not show. */
export type BlogFigureCheck =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; problem: BlogProblem }

/**
 * Checks one component tag against the figures that exist. A tag resolves only to an entry of
 * `figures`, never to a path, and its props reach the component only after its schema accepted
 * them, in the shape the schema returns.
 */
export function checkBlogFigure(
  segment: { tag: string; props: Record<string, unknown>; line: number },
  figures: ReadonlyMap<string, BlogFigureSchema>,
): BlogFigureCheck {
  const { tag, line } = segment
  const figure = figures.get(tag)
  if (!figure) {
    const names = [...figures.keys()].sort()
    const suggestion = closestName(tag, names)
    return {
      ok: false,
      problem: { line, code: `unknown`, tag, detail: ``, names, ...(suggestion && { suggestion }) },
    }
  }
  const props = figure.props(segment.props)
  if (props instanceof type.errors) {
    return { ok: false, problem: { line, code: `props`, tag, detail: props.summary } }
  }
  return { ok: true, props: props as Record<string, unknown> }
}

/**
 * The name in `names` that `tag` most likely meant: the same name in another case, a name that
 * starts with it or that it starts with, or one at most two letters away. `undefined` when none
 * is that close.
 */
export function closestName(tag: string, names: readonly string[]): string | undefined {
  const wanted = tag.toLowerCase()
  let best: { name: string; distance: number } | undefined
  for (const name of names) {
    const lower = name.toLowerCase()
    if (lower === wanted) return name
    const distance = lower.startsWith(wanted) || wanted.startsWith(lower)
      ? 0.5
      : levenshtein(lower, wanted)
    if (distance <= 2 && (!best || distance < best.distance)) best = { name, distance }
  }
  return best?.name
}

/**
 * The `id` of each figure, in page order: its tag in kebab case, numbered on repeat
 * (`cost-calculator`, `cost-calculator-2`), skipping any id a heading already has.
 */
export function blogFigureIds(tags: readonly string[], taken: Iterable<string> = []): string[] {
  const used = new Set(taken)
  return tags.map((tag) => {
    const base = convertToKebabCase(tag)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  })
}
