import { Hono, type MiddlewareHandler } from "hono"
import type postgres from "postgres"
import {
  BLOG_TOPIC_MAX_LENGTH,
  blogSlugProblem,
  type BlogTopic,
  type BlogTranslation,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import {
  createPublicFeed,
  listPublicPosts,
  listPublicTopics,
  readMovedPost,
  readPublicPost,
} from "@server/blog/public-blog.ts"
import { errorResponse } from "../services/error-response.ts"

/** The answer for a post that is not live, or an address that is no slug. */
export const BLOG_POST_NOT_FOUND = `This post is not here`

/** What the public blog routes read. */
export interface PublicBlogReads {
  list(topic: string | null): Promise<PublicBlogPostSummary[]>
  get(slug: string): Promise<{ post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | null>
  /** Where a live post that moved away from `slug` lives now, or `null`. */
  moved(slug: string): Promise<BlogTranslation | null>
  topics(): Promise<BlogTopic[]>
  feed(): Promise<PublicBlogFeedItem[]>
}

/**
 * The public blog (#395), mounted at `/api/blog` for the public website, which renders every page
 * on its server. No session: everything here is public, and only live posts (published, their
 * time passed) are ever answered. A draft, a scheduled post and an unpublished one answer 404 like
 * an address that never existed.
 *
 * - `GET /posts?topic=` lists live posts, newest first.
 * - `GET /posts/:slug` answers one post, rendered, and up to three to read next. A slug a live post
 *   moved away from with "Change URL" answers `{ moved: { language, slug } }`, the post's current
 *   address, for the website to redirect to (#418); it is read only when no live post has the slug.
 * - `GET /topics` lists the topics of live posts with their counts.
 * - `GET /feed` answers the newest posts with their full HTML, for the RSS feed.
 *
 * `limit` stands in front of every route: production mounts the public read limit
 * (`createPublicReadRateLimit`), per client IP (#416).
 */
export function createPublicBlogRoute(reads: PublicBlogReads, limit?: MiddlewareHandler): Hono {
  const app = new Hono()
  if (limit) app.use(`*`, limit)
  return app
    .get(`/posts`, async (c) => {
      const topic = c.req.query(`topic`)?.trim() || null
      if (topic !== null && Array.from(topic).length > BLOG_TOPIC_MAX_LENGTH) {
        return c.json({ posts: [] })
      }
      return c.json({ posts: await reads.list(topic) })
    })
    .get(`/posts/:slug`, async (c) => {
      const slug = c.req.param(`slug`)
      if (blogSlugProblem(slug) !== null) {
        return errorResponse(c, `not_found`, { message: BLOG_POST_NOT_FOUND })
      }
      const found = await reads.get(slug)
      if (found) return c.json(found)
      const moved = await reads.moved(slug)
      if (moved) return c.json({ moved })
      return errorResponse(c, `not_found`, { message: BLOG_POST_NOT_FOUND })
    })
    .get(`/topics`, async (c) => c.json({ topics: await reads.topics() }))
    .get(`/feed`, async (c) => c.json({ posts: await reads.feed() }))
}

/** The reads over the app's database; the feed keeps its last render while no post in it changed. */
export function createPublicBlogReads(sql: postgres.Sql): PublicBlogReads {
  const feed = createPublicFeed(sql)
  return {
    list: (topic) => listPublicPosts(sql, topic),
    get: (slug) => readPublicPost(sql, slug),
    moved: (slug) => readMovedPost(sql, slug),
    topics: () => listPublicTopics(sql),
    feed,
  }
}
