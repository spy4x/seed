import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { blogBodyLength, renderBlogBody } from "./render.ts"

describe(`renderBlogBody`, () => {
  it(`lets no HTML from the Markdown through as markup`, () => {
    const { html } = renderBlogBody(
      `<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))`,
    )

    expect(html).not.toMatch(/<script|<img|href="javascript:/i)
  })

  it(`renders Markdown and lists its headings with the ids they carry`, () => {
    const { html, headings } = renderBlogBody(`## Why it matters\n\nSome **bold** text.`)

    expect(html).toContain(`<h2 id="why-it-matters">`)
    expect(html).toContain(`<strong>bold</strong>`)
    expect(headings).toEqual([{ depth: 2, id: `why-it-matters`, text: `Why it matters` }])
  })

  it(`answers the body's words and a reading time of at least one minute`, () => {
    expect(renderBlogBody(``)).toMatchObject({ words: 0, readingMinutes: 1 })
    expect(blogBodyLength(`word `.repeat(690))).toEqual({ words: 690, readingMinutes: 3 })
  })
})
