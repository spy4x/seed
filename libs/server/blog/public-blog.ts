import type postgres from "postgres"
import {
  BLOG_FEED_COUNT,
  BLOG_READ_NEXT_COUNT,
  type BlogTopic,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import { blogBodyLength, renderBlogBody } from "./render.ts"

/**
 * The public website's reads of the blog (#395). Each reads only posts that are live: published,
 * and due (`publish_at` passed). A draft, a scheduled post and a post taken back are never read, and
 * no answer carries a post's id, its author's account or address, or its newsletter.
 */

interface SummaryRow {
  slug: string
  title: string
  description: string
  topic: string | null
  publishedAt: Date
  contentUpdatedAt: Date | null
  bodyMd: string
}

interface PostRow extends SummaryRow {
  seoTitle: string | null
  tldr: string[]
  coverUrl: string | null
  coverAlt: string | null
  authorName: string | null
}

/** The condition every public read starts from. */
function live(sql: postgres.Sql) {
  return sql`status = 'published' AND publish_at <= now() AND published_at IS NOT NULL`
}

function toSummary(row: SummaryRow): PublicBlogPostSummary {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    topic: row.topic,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.contentUpdatedAt?.toISOString() ?? null,
    readingMinutes: blogBodyLength(row.bodyMd).readingMinutes,
  }
}

/** Every live post, newest first; with `topic`, only the posts on it. */
export async function listPublicPosts(
  sql: postgres.Sql,
  topic: string | null,
): Promise<PublicBlogPostSummary[]> {
  const onTopic = topic === null ? sql`TRUE` : sql`topic = ${topic}`
  const rows = await sql<SummaryRow[]>`
    SELECT slug, title, description, topic, published_at, content_updated_at, body_md
    FROM blog_posts
    WHERE ${live(sql)} AND ${onTopic}
    ORDER BY published_at DESC, id DESC
  `
  return rows.map(toSummary)
}

/**
 * The live post at `slug`, rendered, and up to {@link BLOG_READ_NEXT_COUNT} others to read next:
 * the newest on its topic first, then the newest of the rest. `null` when no live post has it.
 */
export async function readPublicPost(
  sql: postgres.Sql,
  slug: string,
): Promise<{ post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | null> {
  const [row] = await sql<PostRow[]>`
    SELECT slug, title, seo_title, description, tldr, topic, cover_url, cover_alt, body_md,
      published_at, content_updated_at, author_name
    FROM blog_posts
    WHERE slug = ${slug} AND ${live(sql)}
  `
  if (!row) return null
  const next = await sql<SummaryRow[]>`
    SELECT slug, title, description, topic, published_at, content_updated_at, body_md
    FROM blog_posts
    WHERE ${live(sql)} AND slug <> ${slug}
    ORDER BY (topic = ${row.topic}) IS TRUE DESC, published_at DESC, id DESC
    LIMIT ${BLOG_READ_NEXT_COUNT}
  `
  const body = renderBlogBody(row.bodyMd)
  return {
    post: {
      ...toSummary(row),
      readingMinutes: body.readingMinutes,
      seoTitle: row.seoTitle,
      tldr: [...row.tldr],
      coverUrl: row.coverUrl,
      coverAlt: row.coverAlt,
      html: body.html,
      headings: body.headings,
      authorName: row.authorName,
    },
    readNext: next.map(toSummary),
  }
}

/** Every topic of a live post, with how many live posts it has, A to Z. */
export async function listPublicTopics(sql: postgres.Sql): Promise<BlogTopic[]> {
  return await sql<BlogTopic[]>`
    SELECT topic, COUNT(*)::int AS count FROM blog_posts
    WHERE ${live(sql)} AND topic IS NOT NULL
    GROUP BY topic
    ORDER BY lower(topic), topic
  `
}

/** The {@link BLOG_FEED_COUNT} newest live posts with their full HTML, for the RSS feed. */
export async function listPublicFeed(sql: postgres.Sql): Promise<PublicBlogFeedItem[]> {
  const rows = await sql<(SummaryRow & { coverUrl: string | null; authorName: string | null })[]>`
    SELECT slug, title, description, topic, published_at, content_updated_at, body_md, cover_url,
      author_name
    FROM blog_posts
    WHERE ${live(sql)}
    ORDER BY published_at DESC, id DESC
    LIMIT ${BLOG_FEED_COUNT}
  `
  return rows.map((row) => {
    const body = renderBlogBody(row.bodyMd)
    return {
      ...toSummary(row),
      readingMinutes: body.readingMinutes,
      html: body.html,
      coverUrl: row.coverUrl,
      authorName: row.authorName,
    }
  })
}
