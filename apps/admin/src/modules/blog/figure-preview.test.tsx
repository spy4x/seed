import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { type } from "arktype"
import type { BlogPreviewBody } from "@domain/blog"
import type { PostFigureModule } from "../../../../mpa/post-figures.tsx"
import { checkPreview } from "./figure-preview.tsx"

const Gauge: PostFigureModule = {
  default: () => null,
  props: type({ value: `0 <= number <= 100 = 50`, "+": `reject` }),
}
const figures = new Map([[`Gauge`, Gauge]])

const body: BlogPreviewBody = {
  segments: [
    { kind: `html`, html: `<h2 id="gauge">Gauge</h2>` },
    { kind: `component`, tag: `Gauge`, props: { value: 40 }, line: 3 },
    { kind: `problem`, line: 4 },
    { kind: `component`, tag: `Gauge`, props: { value: 400 }, line: 6 },
    { kind: `component`, tag: `Gauj`, props: {}, line: 8 },
    { kind: `component`, tag: `Gauge`, props: {}, line: 10 },
    { kind: `problem`, line: 12 },
  ],
  headings: [{ id: `gauge`, text: `Gauge`, depth: 2 }],
  // The parser's own problems come first, before the figures' check adds lines 6 and 8.
  problems: [
    { line: 4, code: `nested`, tag: `Gauge`, detail: `inside a list` },
    { line: 12, code: `syntax`, tag: `Gauge`, detail: `unclosed tag` },
  ],
  words: 1,
  readingMinutes: 1,
}

it(`draws each figure that passes live with its checked props and the public page's ids, and lists every problem by line`, () => {
  const { preview, problems } = checkPreview(body, figures)
  expect(preview.parts.map((part) => part.kind === `figure` ? `figure ${part.id}` : part.kind))
    .toEqual([`html`, `figure gauge-2`, `problem`, `problem`, `problem`, `figure gauge-3`, `problem`])
  const first = preview.parts[1]
  if (first.kind !== `figure`) throw new Error(`the first figure is missing`)
  const node = first.node as { type: unknown; props: Record<string, unknown> }
  expect(node.type).toBe(Gauge.default)
  expect(node.props.value).toBe(40)
  expect((node.props.figure as { id: string; language: string }).id).toBe(`gauge-2`)
  // The schema's default reaches the island, not the bare tag's empty props.
  const last = preview.parts[5]
  if (last.kind !== `figure`) throw new Error(`the last figure is missing`)
  expect((last.node as { props: Record<string, unknown> }).props.value).toBe(50)
  expect(preview.parts.slice(3, 5)).toEqual([
    { kind: `problem`, line: 6 },
    { kind: `problem`, line: 8 },
  ])
  expect(problems.map(({ line, code }) => `${line} ${code}`)).toEqual([
    `4 nested`,
    `6 props`,
    `8 unknown`,
    `12 syntax`,
  ])
  expect(problems[2].suggestion).toBe(`Gauge`)
})
