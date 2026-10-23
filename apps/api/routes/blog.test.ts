import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { PublicBlogPost } from "@domain/blog"
import { BLOG_POST_NOT_FOUND, createPublicBlogRoute, type PublicBlogReads } from "./blog.ts"
import { apiError } from "../_testing/api-error.ts"

const post: PublicBlogPost = {
  slug: `hello-world`,
  title: `Hello`,
  description: `A post.`,
  topic: null,
  publishedAt: `2026-10-20T10:00:00.000Z`,
  updatedAt: null,
  readingMinutes: 1,
  seoTitle: null,
  tldr: [],
  coverUrl: null,
  coverAlt: null,
  html: `<p>Hi</p>`,
  headings: [],
  authorName: `Maya Chen`,
}

/** The public route over fake reads that record every call. */
function buildApp() {
  const calls: unknown[][] = []
  const reads: PublicBlogReads = {
    list: (topic) => (calls.push([`list`, topic]), Promise.resolve([])),
    get: (
      slug,
    ) => (calls.push([`get`, slug]),
      Promise.resolve(slug === post.slug ? { post, readNext: [] } : null)),
    topics: () => (calls.push([`topics`]), Promise.resolve([])),
    feed: () => (calls.push([`feed`]), Promise.resolve([])),
  }
  return { app: createPublicBlogRoute(reads), calls }
}

describe(`public blog routes`, () => {
  it(`answers a live post by its slug`, async () => {
    const { app } = buildApp()
    const response = await app.request(`/posts/hello-world`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ post, readNext: [] })
  })

  it(`answers 404 for a slug no live post has`, async () => {
    const { app } = buildApp()
    const response = await app.request(`/posts/a-draft`)

    expect(response.status).toBe(404)
    expect((await apiError(response)).message).toBe(BLOG_POST_NOT_FOUND)
  })

  it(`answers 404 for an address that is no slug, without reading the database`, async () => {
    const { app, calls } = buildApp()

    expect((await app.request(`/posts/Hello%20World`)).status).toBe(404)
    expect((await app.request(`/posts/${`a`.repeat(101)}`)).status).toBe(404)
    expect(calls).toEqual([])
  })

  it(`lists by topic, every post without one, and nothing for a topic too long to exist`, async () => {
    const { app, calls } = buildApp()
    await app.request(`/posts?topic=Product`)
    await app.request(`/posts?topic=`)
    const long = await app.request(`/posts?topic=${`a`.repeat(51)}`)

    expect(await long.json()).toEqual({ posts: [] })
    expect(calls).toEqual([[`list`, `Product`], [`list`, null]])
  })
})
