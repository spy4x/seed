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
const published = SAMPLE_POSTS.filter(({ status }) => status === `published`)
const posts: PublicBlogPost[] = published
  .map((sample) => {
    const body = renderBlogBody(sample.bodyMd)
    const original = sample.translationOf ?? sample.id
    return {
      slug: sample.slug,
      language: sample.language,
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
      translations: published
        .filter((other) =>
          other !== sample && (other.id === original || other.translationOf === original)
        )
        .map(({ language, slug }) => ({ language, slug })),
    }
  })
const summary = (
  { slug, language, title, description, topic, publishedAt, updatedAt, readingMinutes }:
    PublicBlogPost,
) => ({ slug, language, title, description, topic, publishedAt, updatedAt, readingMinutes })

const blog = createPublicBlogRoute({
  list: (topic) =>
    Promise.resolve(posts.filter((p) => topic === null || p.topic === topic).map(summary)),
  get: (slug) => {
    const post = posts.find((p) => p.slug === slug)
    return Promise.resolve(
      post
        ? {
          post,
          readNext: posts.filter((p) => p !== post && p.language === post.language).map(summary),
        }
        : null,
    )
  },
  topics: () => Promise.resolve([]),
  feed: () => Promise.resolve(posts),
})

Deno.serve(
  { port: Number(Deno.args[0]), hostname: `127.0.0.1` },
  new Hono().route(`/api/blog`, blog).fetch,
)
