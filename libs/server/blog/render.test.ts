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

  it(`answers the body's words and a reading time of at least one minute`, () => {
    expect(renderBlogBody(``)).toMatchObject({ words: 0, readingMinutes: 1 })
    expect(blogBodyLength(`word `.repeat(461))).toEqual({ words: 461, readingMinutes: 3 })
  })
})
