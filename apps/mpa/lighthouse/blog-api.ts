import { Hono } from "hono"
import type { PublicBlogPost } from "@domain/blog"
import { renderBlogBody } from "@server/blog/render.ts"
import { readSeedPosts } from "@server/blog/seed-posts.ts"
import { fromFileUrl } from "@std/path"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { createPublicBlogRoute } from "../../api/routes/blog.ts"

/**
 * The public blog API for the Lighthouse run (run.sh), on the port given as the first argument:
 * the run's own fixture posts, read from their files in `posts/` next to this script, through the
 * API's own public routes, so `/blog` and a post page are measured with real content, without a
 * database. They are never Seed's posts, so a product that deletes those keeps this check working.
 * Every other API address answers 404, which the website reads as "no answer".
 */
const FIXTURE_POSTS_DIR = fromFileUrl(new URL(`./posts/`, import.meta.url))

const now = new Date()
const published = (await readSeedPosts(denoFileSystem, FIXTURE_POSTS_DIR))
  .filter((post) => post.publishAt <= now)
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
      coverUrl: null,
      coverFile: seed.coverFile,
      coverAlt: fields.coverAlt,
      relatedFeature: fields.relatedFeature,
      segments: body.segments,
      headings: body.headings,
      authorName: seed.author,
      authorUrl: fields.authorUrl,
      translations: published
        .filter((other) =>
          other !== seed &&
          (other.fields.slug === original || other.translationOf === original)
        )
        .map(({ fields: { language, slug } }) => ({ language, slug })),
    }
  })
const summary = (
  {
    slug,
    language,
    title,
    description,
    topic,
    publishedAt,
    updatedAt,
    readingMinutes,
    coverUrl,
    coverFile,
  }: PublicBlogPost,
) => ({
  slug,
  language,
  title,
  description,
  topic,
  publishedAt,
  updatedAt,
  readingMinutes,
  coverUrl,
  coverFile,
})

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
  moved: () => Promise.resolve(null),
  topics: () => Promise.resolve([]),
  feed: () => Promise.resolve(posts),
})

Deno.serve(
  { port: Number(Deno.args[0]), hostname: `127.0.0.1` },
  new Hono().route(`/api/blog`, blog).fetch,
)
