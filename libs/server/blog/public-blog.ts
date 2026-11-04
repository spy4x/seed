import type postgres from "postgres"
import {
  BLOG_FEED_COUNT,
  BLOG_READ_NEXT_COUNT,
  type BlogProblem,
  type BlogTopic,
  type BlogTranslation,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import { type Language, LANGUAGES } from "@domain/identity"
import { renderBlogBody } from "./render.ts"

/**
 * The public website's reads of the blog (#395). Each reads only posts that are live: published,
 * and due (`publish_at` passed). A draft, a scheduled post and a post taken back are never read, and
 * no answer carries a post's id, its author's account or address, or its newsletter.
 */

interface SummaryRow {
  slug: string
  language: Language
  title: string
  description: string
  topic: string | null
  publishedAt: Date
  contentUpdatedAt: Date | null
  /** Stored by Postgres from the body (2026_12_12_0001_blog_reading_minutes.sql). */
  readingMinutes: number
  coverUrl: string | null
  coverFile: string | null
}

interface PostRow extends SummaryRow {
  id: string
  bodyMd: string
  translationOf: string | null
  seoTitle: string | null
  tldr: string[]
  coverAlt: string | null
  relatedFeature: string | null
  authorName: string | null
  authorUrl: string | null
}

/** The columns of a summary: never the body, which a list does not need (#416). */
function summaryColumns(sql: postgres.Sql) {
  return sql`slug, language, title, description, topic, published_at, content_updated_at,
    reading_minutes, cover_url, cover_file`
}

/**
 * The condition every public read starts from. A post in a language the apps no longer ship is
 * left out, so the website, which reads only those, never fails on it (#530).
 */
function live(sql: postgres.Sql) {
  return sql`status = 'published' AND publish_at <= now() AND published_at IS NOT NULL
    AND language IN ${sql([...LANGUAGES])}`
}

function toSummary(row: SummaryRow): PublicBlogPostSummary {
  return {
    slug: row.slug,
    language: row.language,
    title: row.title,
    description: row.description,
    topic: row.topic,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.contentUpdatedAt?.toISOString() ?? null,
    readingMinutes: row.readingMinutes,
    coverUrl: row.coverUrl,
    coverFile: row.coverFile,
  }
}

/** Every live post in every language, newest first; with `topic`, only the posts on it. */
export async function listPublicPosts(
  sql: postgres.Sql,
  topic: string | null,
): Promise<PublicBlogPostSummary[]> {
  const onTopic = topic === null ? sql`TRUE` : sql`topic = ${topic}`
  const rows = await sql<SummaryRow[]>`
    SELECT ${summaryColumns(sql)}
    FROM blog_posts
    WHERE ${live(sql)} AND ${onTopic}
    ORDER BY published_at DESC, id DESC
  `
  return rows.map(toSummary)
}

/**
 * The live post at `slug`, rendered, with its live language versions, and up to
 * {@link BLOG_READ_NEXT_COUNT} others in its language to read next: the newest on its topic first,
 * then the newest of the rest. `null` when no live post has it.
 */
export async function readPublicPost(
  sql: postgres.Sql,
  slug: string,
): Promise<{ post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | null> {
  const [row] = await sql<PostRow[]>`
    SELECT id, translation_of, slug, language, title, seo_title, description, tldr, topic,
      cover_url, cover_file, cover_alt, related_feature, body_md, published_at, content_updated_at,
      author_name, author_url, reading_minutes
    FROM blog_posts
    WHERE slug = ${slug} AND ${live(sql)}
  `
  if (!row) return null
  // The post and its translations share one original: the post itself, or the one it translates.
  const original = row.translationOf ?? row.id
  const translations = await sql<BlogTranslation[]>`
    SELECT language, slug FROM blog_posts
    WHERE ${live(sql)} AND id <> ${row.id} AND (id = ${original} OR translation_of = ${original})
    ORDER BY language
  `
  const next = await sql<SummaryRow[]>`
    SELECT ${summaryColumns(sql)}
    FROM blog_posts
    WHERE ${live(sql)} AND slug <> ${slug} AND language = ${row.language}
    ORDER BY (topic = ${row.topic}) IS TRUE DESC, published_at DESC, id DESC
    LIMIT ${BLOG_READ_NEXT_COUNT}
  `
  const body = renderBlogBody(row.bodyMd)
  warnUnusableTags(slug, body.problems)
  return {
    post: {
      ...toSummary(row),
      seoTitle: row.seoTitle,
      tldr: [...row.tldr],
      coverAlt: row.coverAlt,
      relatedFeature: row.relatedFeature,
      segments: body.segments,
      headings: body.headings,
      authorName: row.authorName,
      authorUrl: row.authorUrl,
      translations: translations.map(({ language, slug }) => ({ language, slug })),
    },
    readNext: next.map(toSummary),
  }
}

/**
 * Where the post that once lived at `slug` lives now (#418): its language and current slug, read
 * from `blog_slug_redirects` (2026_12_13_0002_blog_slug_redirects.sql). `null` when no post moved
 * from `slug`, and when the post that did is not live, so an old address never tells that a draft,
 * a scheduled or an unpublished post exists. The website asks only after {@link readPublicPost}
 * found no live post at `slug`, so a post's own address costs no extra read.
 */
export async function readMovedPost(
  sql: postgres.Sql,
  slug: string,
): Promise<BlogTranslation | null> {
  const [row] = await sql<BlogTranslation[]>`
    SELECT language, slug FROM blog_posts
    WHERE id = (SELECT post_id FROM blog_slug_redirects WHERE slug = ${slug}) AND ${live(sql)}
  `
  return row ? { language: row.language, slug: row.slug } : null
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

/**
 * Logs one warning naming a live post's tag lines that show nothing (#620): a tag in a list or a
 * quote, or one that does not read. The public website logs the tags no component accepts.
 */
function warnUnusableTags(slug: string, problems: BlogProblem[]): void {
  if (problems.length === 0) return
  const lines = problems.map(({ line, tag, detail }) => `line ${line} <${tag}>: ${detail}`)
  console.warn(`Blog post "${slug}": these tags show nothing: ${lines.join(`; `)}`)
}

/** One live post of the feed, as {@link createPublicFeed} reads it. */
interface FeedRow extends SummaryRow {
  bodyMd: string
  authorName: string | null
}

/**
 * The {@link BLOG_FEED_COUNT} newest live posts with their full body, for the RSS feed, as one
 * function per API process that keeps the last feed it rendered (#416). Each call first reads the
 * id and version of the feed's posts, a few bytes per post; while they are the same as last time,
 * the kept feed is answered without reading or rendering a body. A write to a post bumps its
 * version, and a post that goes live, is taken back or is deleted changes the list, so the feed is
 * read and rendered again exactly when it changed.
 */
export function createPublicFeed(sql: postgres.Sql): () => Promise<PublicBlogFeedItem[]> {
  let kept: { key: string; feed: PublicBlogFeedItem[] } | null = null
  return async () => {
    const versions = await sql<{ id: string; version: number }[]>`
      SELECT id, version FROM blog_posts
      WHERE ${live(sql)}
      ORDER BY published_at DESC, id DESC
      LIMIT ${BLOG_FEED_COUNT}
    `
    const key = versions.map(({ id, version }) => `${id}:${version}`).join(`,`)
    if (kept?.key === key) return kept.feed
    const feed = await listPublicFeed(sql)
    kept = { key, feed }
    return feed
  }
}

/** The {@link BLOG_FEED_COUNT} newest live posts with their full body, rendered. */
export async function listPublicFeed(sql: postgres.Sql): Promise<PublicBlogFeedItem[]> {
  const rows = await sql<FeedRow[]>`
    SELECT ${summaryColumns(sql)}, body_md, author_name
    FROM blog_posts
    WHERE ${live(sql)}
    ORDER BY published_at DESC, id DESC
    LIMIT ${BLOG_FEED_COUNT}
  `
  return rows.map((row) => {
    const body = renderBlogBody(row.bodyMd)
    return {
      ...toSummary(row),
      segments: body.segments,
      headings: body.headings,
      authorName: row.authorName,
    }
  })
}
