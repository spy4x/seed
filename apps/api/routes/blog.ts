import { Hono } from "hono"
import type postgres from "postgres"
import {
  BLOG_TOPIC_MAX_LENGTH,
  blogSlugProblem,
  type BlogTopic,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import {
  listPublicFeed,
  listPublicPosts,
  listPublicTopics,
  readPublicPost,
} from "@server/blog/public-blog.ts"
import { errorResponse } from "../services/error-response.ts"

/** The answer for a post that is not live, or an address that is no slug. */
export const BLOG_POST_NOT_FOUND = `This post is not here`

/** What the public blog routes read. */
export interface PublicBlogReads {
  list(topic: string | null): Promise<PublicBlogPostSummary[]>
  get(slug: string): Promise<{ post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | null>
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
 * - `GET /posts/:slug` answers one post, rendered, and up to three to read next.
 * - `GET /topics` lists the topics of live posts with their counts.
 * - `GET /feed` answers the newest posts with their full HTML, for the RSS feed.
 */
export function createPublicBlogRoute(reads: PublicBlogReads): Hono {
  return new Hono()
    .get(`/posts`, async (c) => {
      const topic = c.req.query(`topic`)?.trim() || null
      if (topic !== null && Array.from(topic).length > BLOG_TOPIC_MAX_LENGTH) {
        return c.json({ posts: [] })
      }
      return c.json({ posts: await reads.list(topic) })
    })
    .get(`/posts/:slug`, async (c) => {
      const slug = c.req.param(`slug`)
      const found = blogSlugProblem(slug) === null ? await reads.get(slug) : null
      if (!found) return errorResponse(c, `not_found`, { message: BLOG_POST_NOT_FOUND })
      return c.json(found)
    })
    .get(`/topics`, async (c) => c.json({ topics: await reads.topics() }))
    .get(`/feed`, async (c) => c.json({ posts: await reads.feed() }))
}

/** The reads over the app's database. */
export function createPublicBlogReads(sql: postgres.Sql): PublicBlogReads {
  return {
    list: (topic) => listPublicPosts(sql, topic),
    get: (slug) => readPublicPost(sql, slug),
    topics: () => listPublicTopics(sql),
    feed: () => listPublicFeed(sql),
  }
}
