import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { INDEXNOW_MAX_URLS } from "@spy4x/integrations/indexnow"
import { blogPostUrls } from "./blog-indexnow-job.ts"

const SITE = `https://www.example.com`

describe(`blogPostUrls`, () => {
  it(`names the post's own address first, then each old one, at its language's address`, () => {
    expect(blogPostUrls({ language: `en`, slug: `new` }, [`old`, `older`], SITE)).toEqual([
      `${SITE}/blog/new`,
      `${SITE}/blog/old`,
      `${SITE}/blog/older`,
    ])
    expect(blogPostUrls({ language: `de`, slug: `neu` }, [], SITE)).toEqual([`${SITE}/de/blog/neu`])
  })

  it(`never names more addresses than IndexNow takes in one call`, () => {
    const old = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, index) => `old-${index}`)
    const urls = blogPostUrls({ language: `en`, slug: `new` }, old, SITE)
    expect(urls).toHaveLength(INDEXNOW_MAX_URLS)
    expect(urls[0]).toBe(`${SITE}/blog/new`)
  })
})
