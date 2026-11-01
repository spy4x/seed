import { Hono } from "hono"
import type { PublicBlogPost } from "@domain/blog"
import { renderBlogBody } from "@server/blog/render.ts"
import { readSeedPosts } from "@server/blog/seed-posts.ts"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { createPublicBlogRoute } from "../../api/routes/blog.ts"

/**
 * The public blog API for the Lighthouse run (run.sh), on the port given as the first argument:
 * Seed's own published posts, read from their files (libs/server/blog/seed-posts/), through the
 * API's own public routes, so `/blog` and a post page are measured as the demo shows them, without
 * a database. Every other API address answers 404, which the website reads as "no answer".
 */
const now = new Date()
const published = (await readSeedPosts(denoFileSystem)).filter((post) => post.publishAt <= now)
const posts: PublicBlogPost[] = published
  .map((seed) => {
    const { fields } = seed
    const body = renderBlogBody(fields.bodyMd)
    const original = seed.translationOf ?? fields.slug
    return {
      slug: fields.slug,
      language: fields.language,
      title: fields.title,
      description: fields.description,
      topic: fields.topic,
      publishedAt: seed.publishAt.toISOString(),
      updatedAt: null,
      readingMinutes: body.readingMinutes,
      seoTitle: fields.seoTitle,
      tldr: fields.tldr,
      coverUrl: fields.coverUrl,
      coverAlt: fields.coverAlt,
      html: body.html,
      headings: body.headings,
      authorName: seed.author,
      translations: published
        .filter((other) =>
          other !== seed &&
          (other.fields.slug === original || other.translationOf === original)
        )
        .map(({ fields: { language, slug } }) => ({ language, slug })),
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
