import type postgres from "postgres"
import { INDEXNOW_MAX_URLS } from "@spy4x/integrations/indexnow"
import { BLOG_INDEXNOW_JOB, blogPostPath } from "@domain/blog"
import type { Language } from "@domain/identity"
import type { JobHandler } from "../jobs/jobs.ts"
import { type IndexNowSetup, pingIndexNow, queueIndexNow } from "../jobs/indexnow.ts"

/** What the `blog.indexnow` job needs. */
export interface BlogIndexNowJobDeps {
  sql: postgres.Sql
  /** `null` while IndexNow is off: the job sends nothing. */
  setup: IndexNowSetup | null
  /** Told once when a ping fails. Never gets the key. */
  log: (line: string) => void
  /** Defaults to `globalThis.fetch`; tests pass a fake. */
  fetch?: typeof fetch
}

/**
 * Every address of a post on the website, at most {@link INDEXNOW_MAX_URLS}: its own (`slug`)
 * first, then each old slug a Change URL left (`blog_slug_redirects`), all at its language's
 * address (`blogPostPath`).
 */
export function blogPostUrls(
  post: { language: Language; slug: string },
  oldSlugs: readonly string[],
  siteUrl: string,
): string[] {
  const slugs = [...new Set([post.slug, ...oldSlugs])].slice(0, INDEXNOW_MAX_URLS)
  return slugs.map((slug) => `${siteUrl}${blogPostPath({ language: post.language, slug })}`)
}

/**
 * The `blog.indexnow` job, about one post: it sends every address of the post to IndexNow, so
 * Bing, Yandex and the other engines that share it look at them again within minutes. It runs
 * after the post went live, changed while live, moved (Change URL) or left the website, whatever
 * the post's state is now: a post that left answers 404, which the engines then see.
 *
 * A post that was never live, or is gone, has no address to send. A failed ping is logged once
 * and the job still succeeds: it is never retried, and it never touches the post.
 */
export function blogIndexNowJob(deps: BlogIndexNowJobDeps): JobHandler {
  return async (event) => {
    if (!deps.setup) return
    const [post] = await deps.sql<
      { slug: string; language: Language; publishedAt: Date | null; oldSlugs: string[] }[]
    >`
      SELECT p.slug, p.language, p.published_at,
        ARRAY(SELECT r.slug FROM blog_slug_redirects r WHERE r.post_id = p.id ORDER BY r.created_at)
          AS old_slugs
      FROM blog_posts p WHERE p.id = ${event.aggregateId}
    `
    if (!post || post.publishedAt === null) return
    await pingIndexNow(
      deps.setup,
      blogPostUrls(post, post.oldSlugs, deps.setup.siteUrl),
      `blog post ${event.aggregateId}`,
      deps,
    )
  }
}

/** Queues the post's `blog.indexnow` job in the write's transaction, deduplicated ({@link queueIndexNow}). */
export function queueBlogIndexNow(sql: postgres.Sql, postId: string): Promise<void> {
  return queueIndexNow(sql, BLOG_INDEXNOW_JOB, postId)
}
