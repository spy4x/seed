import { Hono } from "hono"
import type { PublicBlogPost } from "@domain/blog"
import { renderBlogBody } from "@server/blog/render.ts"
import { SAMPLE_POSTS } from "@server/blog/sample-posts.ts"
import { createPublicBlogRoute } from "../../api/routes/blog.ts"

/**
 * The public blog API for the Lighthouse run (run.sh), on the port given as the first argument:
 * the dev seed's published sample posts, through the API's own public routes, so `/blog` and a
 * post page are measured as `deno task db:seed` leaves them, without a database. Every other API
 * address answers 404, which the website reads as "no answer".
 */
const DAY_MS = 86_400_000
const now = Date.now()
const posts: PublicBlogPost[] = SAMPLE_POSTS
  .filter(({ status }) => status === `published`)
  .map((sample) => {
    const body = renderBlogBody(sample.bodyMd)
    return {
      slug: sample.slug,
      title: sample.title,
      description: sample.description,
      topic: sample.topic,
      publishedAt: new Date(now + (sample.liveInDays ?? 0) * DAY_MS).toISOString(),
      updatedAt: null,
      readingMinutes: body.readingMinutes,
      seoTitle: null,
      tldr: sample.tldr,
      coverUrl: null,
      coverAlt: null,
      html: body.html,
      headings: body.headings,
      authorName: null,
    }
  })
const summary = (
  { slug, title, description, topic, publishedAt, updatedAt, readingMinutes }: PublicBlogPost,
) => ({ slug, title, description, topic, publishedAt, updatedAt, readingMinutes })

const blog = createPublicBlogRoute({
  list: (topic) =>
    Promise.resolve(posts.filter((p) => topic === null || p.topic === topic).map(summary)),
  get: (slug) => {
    const post = posts.find((p) => p.slug === slug)
    return Promise.resolve(
      post ? { post, readNext: posts.filter((p) => p !== post).map(summary) } : null,
    )
  },
  topics: () => Promise.resolve([]),
  feed: () => Promise.resolve(posts),
})

Deno.serve(
  { port: Number(Deno.args[0]), hostname: `127.0.0.1` },
  new Hono().route(`/api/blog`, blog).fetch,
)
