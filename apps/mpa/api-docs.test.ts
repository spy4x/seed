import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { EXAMPLE_ORIGIN, renderApiDocs } from "./api-docs.ts"

describe("renderApiDocs", () => {
  it("shows the API's own origin in every example, never the placeholder", () => {
    const { html } = renderApiDocs(`https://notes.test`)

    expect(html).toContain(`https://notes.test/api/v1/groups/`)
    expect(html).not.toContain(EXAMPLE_ORIGIN)
  })

  it("leaves out the file's own heading, as the page draws its title", () => {
    const { headings } = renderApiDocs(`https://notes.test`)

    expect(headings.filter((heading) => heading.depth === 1)).toEqual([])
    expect(headings[0]).toEqual({ depth: 2, id: `quick-start`, text: `Quick start` })
  })
})
