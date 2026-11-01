import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { blogBodyLength, renderBlogBody, renderBlogPreview } from "./render.ts"

/** The HTML chunks of a body, joined. */
const htmlOf = (segments: { kind: string; html?: string }[]) =>
  segments.map((segment) => segment.html ?? ``).join(``)

describe(`renderBlogBody`, () => {
  it(`lets no HTML from the Markdown through as markup`, () => {
    const { segments } = renderBlogBody(
      `<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))`,
    )

    expect(htmlOf(segments)).not.toMatch(/<script|<img|href="javascript:/i)
  })

  it(`keeps escaping the HTML on both sides of a component tag`, () => {
    const { segments } = renderBlogBody(
      `<img src=x onerror="alert(1)">\n\n<CostCalculator members={4} />\n\n<script>alert(1)</script>`,
    )

    expect(segments.map((segment) => segment.kind)).toEqual([`html`, `component`, `html`])
    expect(htmlOf(segments)).not.toMatch(/<script|<img/i)
  })

  it(`renders Markdown and lists its headings with the ids they carry`, () => {
    const { segments, headings } = renderBlogBody(`## Why it matters\n\nSome **bold** text.`)

    expect(htmlOf(segments)).toContain(`<h2 id="why-it-matters">`)
    expect(htmlOf(segments)).toContain(`<strong>bold</strong>`)
    expect(headings).toEqual([{ depth: 2, id: `why-it-matters`, text: `Why it matters` }])
  })

  it(`splits the body around a component tag and keeps its props and line`, () => {
    const { segments, problems } = renderBlogBody(`Intro.\n\n<CostCalculator members={4} />\n`)

    expect(segments).toEqual([
      { kind: `html`, html: `<p>Intro.</p>\n` },
      { kind: `component`, tag: `CostCalculator`, props: { members: 4 }, line: 3 },
    ])
    expect(problems).toEqual([])
  })

  it(`lists a tag in a list and an unreadable tag with their lines and the parser's detail`, () => {
    const { problems } = renderBlogBody(`- <Chart />\n\n<Chart year=2026 />\n`)

    expect(problems).toEqual([
      {
        line: 1,
        code: `nested`,
        tag: `Chart`,
        detail: `a component tag must sit at the top level, not in a list or a quote`,
      },
      {
        line: 3,
        code: `syntax`,
        tag: `Chart`,
        detail: `prop "year" needs a value: {json} or "text"`,
      },
    ])
  })

  it(`answers the body's words and a reading time of at least one minute`, () => {
    expect(renderBlogBody(``)).toMatchObject({ words: 0, readingMinutes: 1 })
    expect(blogBodyLength(`word `.repeat(690))).toEqual({ words: 690, readingMinutes: 3 })
  })
})

describe(`renderBlogPreview`, () => {
  it(`puts a marker where each unusable tag sits and keeps every other tag's true line`, () => {
    const { segments, problems } = renderBlogPreview(
      `One.\n\n<Chart year=2026 />\n\nTwo.\n\n<CostCalculator />\n\n> <Chart />\n\nThree.\n`,
    )

    expect(segments.map((segment) => segment.kind === `html` ? segment.html.trim() : segment))
      .toEqual([
        `<p>One.</p>`,
        { kind: `problem`, line: 3 },
        `<p>Two.</p>`,
        { kind: `component`, tag: `CostCalculator`, props: {}, line: 7 },
        { kind: `problem`, line: 9 },
        `<p>Three.</p>`,
      ])
    expect(problems.map((problem) => problem.line)).toEqual([3, 9])
  })
})
