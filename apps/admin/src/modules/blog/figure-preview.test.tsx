import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { type } from "arktype"
import type { BlogPreviewBody } from "@domain/blog"
import type { PostFigureModule } from "../../../../mpa/post-figures.tsx"
import { checkPreview } from "./figure-preview.tsx"

const Gauge: PostFigureModule = {
  default: () => null,
  props: type({ "value?": `0 <= number <= 100`, "+": `reject` }),
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
  ],
  headings: [{ id: `gauge`, text: `Gauge`, depth: 2 }],
  problems: [{ line: 4, code: `nested`, tag: `Gauge`, detail: `inside a list` }],
  words: 1,
  readingMinutes: 1,
}

it(`draws each figure that passes live, with the public page's ids, and marks the others`, () => {
  const { preview, problems } = checkPreview(body, figures)
  expect(preview.parts.map((part) => part.kind === `figure` ? `figure ${part.id}` : part.kind))
    .toEqual([`html`, `figure gauge-2`, `problem`, `problem`, `problem`, `figure gauge-3`])
  const first = preview.parts[1]
  if (first.kind !== `figure`) throw new Error(`the first figure is missing`)
  const node = first.node as { type: unknown; props: Record<string, unknown> }
  expect(node.type).toBe(Gauge.default)
  expect(node.props.value).toBe(40)
  expect((node.props.figure as { id: string; language: string }).id).toBe(`gauge-2`)
  expect(preview.parts.slice(3, 5)).toEqual([
    { kind: `problem`, line: 6 },
    { kind: `problem`, line: 8 },
  ])
  expect(problems.map(({ line, code }) => `${line} ${code}`)).toEqual([
    `4 nested`,
    `6 props`,
    `8 unknown`,
  ])
  expect(problems[2].suggestion).toBe(`Gauge`)
})
