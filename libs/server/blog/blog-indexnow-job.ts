import type postgres from "postgres"
import { INDEXNOW_MAX_URLS, submitIndexNow } from "@spy4x/integrations/indexnow"
import { BLOG_INDEXNOW_JOB, blogPostPath, readIndexNowKey } from "@domain/blog"
import type { Language } from "@domain/identity"
import { readSiteUrl } from "../subscribers/subscribers.ts"
import { enqueueJob, JOB_AGGREGATE, type JobHandler } from "../jobs/jobs.ts"

/** What IndexNow needs: the site's key and the public website's origin, such as `https://www.example.com`. */
export interface IndexNowSetup {
  key: string
  siteUrl: string
}

/**
 * IndexNow's setup from `INDEXNOW_KEY` and `MPA_DOMAIN`, or `null` when either is unset: then the
 * `blog.indexnow` job sends nothing. Plain HTTP only in development, as for the website itself.
 *
 * @throws Error when `INDEXNOW_KEY` is not a key IndexNow takes, or `MPA_DOMAIN` carries a scheme.
 */
export function readIndexNowSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): IndexNowSetup | null {
  const key = readIndexNowKey(env)
  const siteUrl = readSiteUrl(env, mode)
  return key === null || siteUrl === null ? null : { key, siteUrl }
}

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
    const { key, siteUrl } = deps.setup
    const result = await submitIndexNow({
      host: new URL(siteUrl).hostname,
      key,
      urls: blogPostUrls(post, post.oldSlugs, siteUrl),
      fetch: deps.fetch,
    })
    if (!result.success) {
      deps.log(
        `warning: IndexNow was not told about blog post ${event.aggregateId}: ` +
          result.error.replaceAll(key, `<REDACTED:KEY>`),
      )
    }
  }
}

/**
 * Queues the post's `blog.indexnow` job in the write's transaction, unless one waits that no
 * worker has taken yet: that one reads the post when it runs, so it sends this change too.
 */
export async function queueIndexNow(sql: postgres.Sql, postId: string): Promise<void> {
  const [waiting] = await sql`
    SELECT 1 FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${postId}
      AND event_kind = ${BLOG_INDEXNOW_JOB} AND processed_at IS NULL AND claimed_at IS NULL
  `
  if (!waiting) await enqueueJob(sql, BLOG_INDEXNOW_JOB, postId, { inMs: 0 })
}
