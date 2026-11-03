import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { PublicBlogPost } from "@domain/blog"
import { BLOG_POST_NOT_FOUND, createPublicBlogRoute, type PublicBlogReads } from "./blog.ts"
import { apiError } from "../_testing/api-error.ts"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import {
  createPublicReadRateLimit,
  PUBLIC_READS_PER_IP,
} from "../middlewares/public-read-rate-limit.ts"

const post: PublicBlogPost = {
  slug: `hello-world`,
  language: `en`,
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
  segments: [{ kind: `html`, html: `<p>Hi</p>` }],
  headings: [],
  authorName: `Maya Chen`,
  authorUrl: null,
  translations: [],
}

/** A rate-limit store in memory, fresh for each test. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

/** A request from the client at `ip`, as the website forwards it. */
const from = (ip: string, path = `/posts`) =>
  new Request(`http://local${path}`, {
    headers: { "x-real-ip": ip },
  })

/** The public route over fake reads that record every call. */
function buildApp(limit?: Parameters<typeof createPublicBlogRoute>[1]) {
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
  return { app: createPublicBlogRoute(reads, limit), calls }
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

  it(`refuses a client past its read limit with 429 and Retry-After, and counts each IP apart`, async () => {
    const errors: unknown[] = []
    const { app, calls } = buildApp(createPublicReadRateLimit({
      store: memoryStore,
      onStoreError: (error) => errors.push(error),
      clock: () => 1_000_000,
    }))
    for (let i = 0; i < PUBLIC_READS_PER_IP; i++) {
      const path = [`/posts`, `/posts/hello-world`, `/topics`, `/feed`][i % 4]
      expect((await app.request(from(`192.0.2.1`, path))).status).toBe(200)
    }

    const refused = await app.request(from(`192.0.2.1`, `/feed`))
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get(`retry-after`))).toBeGreaterThan(0)
    expect(calls).toHaveLength(PUBLIC_READS_PER_IP)
    expect((await app.request(from(`192.0.2.2`))).status).toBe(200)
    expect(errors).toEqual([])
  })

  it(`lets reads through when the limit's store fails, and reports it`, async () => {
    const errors: unknown[] = []
    const broken = () =>
      createKvStore({
        backend: {
          get: () => Promise.reject(new Error(`valkey down`)),
          set: () => Promise.reject(new Error(`valkey down`)),
          delete: () => Promise.reject(new Error(`valkey down`)),
        },
      })
    const { app } = buildApp(
      createPublicReadRateLimit({ store: broken, onStoreError: (error) => errors.push(error) }),
    )

    expect((await app.request(from(`192.0.2.1`))).status).toBe(200)
    expect(errors).toHaveLength(1)
  })
})
