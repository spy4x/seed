import type postgres from "postgres"
import { isSubscriberList } from "@domain/subscribers"
import { BLOG_CROSSPOST_JOB, BLOG_PUBLISH_JOB, blogPostPath } from "@domain/blog"
import { type MailBrand, translatorFor } from "../mail/mail.ts"
import { subscribersInLanguage } from "../jobs/subscriber-mail.ts"
import type { SubscribersSetup } from "../subscribers/subscribers.ts"
import {
  queueSubscriberIssue,
  renderSubscriberIssue,
  type SubscriberIssue,
  subscriberIssueSchema,
} from "../jobs/subscriber-issue.ts"
import { enqueueJob, JOB_AGGREGATE, type JobHandler } from "../jobs/jobs.ts"
import type { BlogPostRow } from "./postgres-blog-repository.ts"
import { queueIndexNow } from "./blog-indexnow-job.ts"
import type { BlogCrosspostSetup } from "./blog-crosspost-job.ts"

/** What the `blog.publish` job needs. */
export interface BlogPublishJobDeps {
  sql: postgres.Sql
  /** The app's address, for the issue's footer. */
  brand: MailBrand
  /** `null` when mail subscriptions are off: the post goes live and nothing is emailed. */
  setup: SubscribersSetup | null
  /** Told why a newsletter was not queued. Gets no address. */
  log: (line: string) => void
  /** `null` while the Dev.to cross-post is off (`DEVTO_API_KEY` unset): it is skipped. */
  crosspost?: BlogCrosspostSetup | null
  /** Defaults to `globalThis.fetch`; tests pass a fake. */
  fetch?: typeof fetch
}

/** How long the live check waits for the public website. */
const LIVE_CHECK_TIMEOUT_MS = 10_000

/**
 * The public website does not show the post yet: its page did not answer 200 with the title. The
 * job fails, and the job system tries again later (docs/jobs.md), so nothing is sent before then.
 */
export class BlogPostNotLiveError extends Error {
  constructor(postId: string, status: number) {
    super(`blog post ${postId} is not live on the website yet (answered ${status})`)
    this.name = `BlogPostNotLiveError`
  }
}

/** `html` with the entities Preact and the browser write for text decoded, for a plain search. */
function decodeEntities(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|apos|#39|#x27);/g, (entity) =>
    ({
      "&amp;": `&`,
      "&lt;": `<`,
      "&gt;": `>`,
      "&quot;": `"`,
      "&apos;": `'`,
      "&#39;": `'`,
      "&#x27;": `'`,
    })[entity]!)
}

/**
 * Checks that the post is live on the public website: a GET of its address answers 200,
 * without a redirect, and the page carries its title. Throws {@link BlogPostNotLiveError}
 * otherwise, also when the website does not answer in time.
 */
export async function checkBlogPostLive(
  post: Pick<BlogPostRow, `id` | `slug` | `title` | `language`>,
  siteUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  let response: Response
  try {
    response = await fetcher(`${siteUrl}${blogPostPath(post)}`, {
      redirect: `manual`,
      signal: AbortSignal.timeout(LIVE_CHECK_TIMEOUT_MS),
    })
  } catch {
    throw new BlogPostNotLiveError(post.id, 0)
  }
  const html = await response.text().catch(() => ``)
  if (response.status !== 200 || !decodeEntities(html).includes(post.title)) {
    throw new BlogPostNotLiveError(post.id, response.status)
  }
}

/** The longest preheader an issue takes (`subscriberIssueSchema`). */
const PREHEADER_MAX_LENGTH = 200

/**
 * The newsletter issue of a post: its title as the subject and heading, its intro (or, without
 * one, its description) to open it, its key points and a "Read the post" button, in the post's language, to the post on the public website,
 * at its language's address. The issue id is the post's id, so the send log knows it as one issue
 * whatever happens to the post.
 */
export function blogTeaserIssue(
  post: Pick<
    BlogPostRow,
    `id` | `slug` | `title` | `description` | `intro` | `tldr` | `language`
  >,
  siteUrl: string,
): SubscriberIssue {
  return subscriberIssueSchema.assert({
    id: post.id,
    subject: post.title,
    preheader: Array.from(post.description).slice(0, PREHEADER_MAX_LENGTH).join(``),
    blocks: [
      { heading: post.title },
      { paragraph: post.intro ?? post.description },
      ...(post.tldr.length > 0 ? [{ list: [...post.tldr] }] : []),
      {
        button: {
          href: `${siteUrl}${blogPostPath(post)}`,
          label: translatorFor(post.language).t(`SubscriberIssue.readPost`),
        },
      },
    ],
  })
}

/**
 * The `blog.publish` job, about one post. It:
 *
 * 1. publishes a scheduled post whose time has come, in a transaction that locks the post. A post
 *    unscheduled, deleted or moved to a later time since the job was queued is left alone: the job
 *    of its new time publishes it. A run before the post's time with no other run waiting (the
 *    admin's Run now) queues one for that time, so the post still goes live then. A post it
 *    publishes gets its `blog.indexnow` job, which tells the search engines.
 * 2. when the live post still has a newsletter or a cross-post to send, checks that the public
 *    website shows it ({@link checkBlogPostLive}), outside any transaction. A post the website
 *    does not show yet fails the run, and the job system tries again later, so a subscriber never
 *    gets a link to a page that is not there.
 * 3. in a second transaction that locks the post, queues the post's newsletter issue when the post
 *    is still live, has a list and has never been emailed, and records when and to how many
 *    confirmed subscribers. The issue goes only to the subscribers of the post's language.
 *    That record is written in the same transaction as the issue's job, so a retried, repeated or
 *    concurrent run, or publishing again after unpublishing, never queues a second issue.
 * 4. in that transaction, queues the post's `blog.crosspost` job when its cross-post was never
 *    settled; that job posts it to Dev.to once ever. A translation, or a post while the cross-post
 *    is off, is settled as never cross-posted, so turning it on later posts only newer posts.
 *
 * With mail subscriptions off, without the public website's address (`MPA_DOMAIN`) or with a list
 * the app no longer has, the post still goes live and is settled as never emailed: its list is
 * cleared and `newsletter_sent_at` set, as for a post file that does not ask for the newsletter.
 * Turning the newsletter on later then emails only posts that go live after that, never a post
 * that went live months before.
 */
export function blogPublishJob(deps: BlogPublishJobDeps): JobHandler {
  return async (event) => {
    const post = await deps.sql.begin(async (tx) => {
      const [post] = await tx<(BlogPostRow & { due: boolean })[]>`
        SELECT *, publish_at <= now() AS due FROM blog_posts
        WHERE id = ${event.aggregateId}
        FOR UPDATE
      `
      if (!post) return null
      if (post.status === `scheduled` && !post.due && post.publishAt) {
        // Run early (the admin's Run now): queue the run at the post's time, unless one waits.
        const [waiting] = await tx`
          SELECT 1 FROM outbox_events
          WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${post.id}
            AND event_kind = ${BLOG_PUBLISH_JOB} AND processed_at IS NULL AND id <> ${event.id}
        `
        if (!waiting) await enqueueJob(tx, BLOG_PUBLISH_JOB, post.id, { at: post.publishAt })
        return null
      }
      if (post.status === `scheduled` && post.due) {
        await tx`
          UPDATE blog_posts
          SET status = 'published', published_at = COALESCE(published_at, now()),
            updated_at = now(), version = version + 1
          WHERE id = ${post.id}
        `
        await queueIndexNow(tx, post.id)
        return post
      }
      return post.status === `published` ? post : null
    })
    if (!post || !hasSomethingToSend(post)) return
    const siteUrl = deps.setup?.siteUrl ?? deps.crosspost?.siteUrl ?? null
    if (siteUrl !== null) await checkBlogPostLive(post, siteUrl, deps.fetch)
    await deps.sql.begin(async (tx) => {
      const [now] = await tx<BlogPostRow[]>`
        SELECT * FROM blog_posts WHERE id = ${post.id} FOR UPDATE
      `
      // Taken back or deleted while the website was asked: the next publish runs this again.
      if (!now || now.status !== `published`) return
      await queueNewsletter(tx, deps, now)
      await settleCrosspost(tx, deps, now)
    })
  }
}

/** Whether a live post still has its newsletter or its cross-post ahead. */
function hasSomethingToSend(post: BlogPostRow): boolean {
  return (post.newsletterList !== null && post.newsletterSentAt === null) ||
    post.crosspostedAt === null
}

/** Step 3 of {@link blogPublishJob}, in its second transaction. */
async function queueNewsletter(
  tx: postgres.TransactionSql,
  deps: BlogPublishJobDeps,
  post: BlogPostRow,
): Promise<void> {
  const list = post.newsletterList
  if (list === null || post.newsletterSentAt !== null) return
  const siteUrl = deps.setup?.siteUrl
  if (!siteUrl || !isSubscriberList(list)) {
    await tx`
      UPDATE blog_posts SET newsletter_list = NULL, newsletter_sent_at = now()
      WHERE id = ${post.id}
    `
    deps.log(
      `warning: blog post ${post.id} went live, but its newsletter was not queued and never ` +
        `will be: mail subscriptions, MPA_DOMAIN or the list ${list} are off`,
    )
    return
  }
  const { size: confirmed } = await subscribersInLanguage(tx, list, post.language)
  // Not a new version: the operator's open editor keeps saving; only the record changes.
  await tx`
    UPDATE blog_posts SET newsletter_sent_at = now(), newsletter_recipients = ${confirmed}
    WHERE id = ${post.id}
  `
  const issue = renderSubscriberIssue(deps.brand, blogTeaserIssue(post, siteUrl), post.language)
  await queueSubscriberIssue(tx, list, issue)
}

/** Step 4 of {@link blogPublishJob}, in its second transaction. */
async function settleCrosspost(
  tx: postgres.TransactionSql,
  deps: BlogPublishJobDeps,
  post: BlogPostRow,
): Promise<void> {
  if (post.crosspostedAt !== null) return
  if (!deps.crosspost || post.translationOf !== null) {
    // Not a new version either: only the record changes.
    await tx`UPDATE blog_posts SET crossposted_at = now() WHERE id = ${post.id}`
    if (post.translationOf === null) {
      deps.log(`blog post ${post.id} went live; no Dev.to cross-post: DEVTO_API_KEY is unset`)
    }
    return
  }
  const [waiting] = await tx`
    SELECT 1 FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${post.id}
      AND event_kind = ${BLOG_CROSSPOST_JOB} AND processed_at IS NULL
  `
  if (!waiting) await enqueueJob(tx, BLOG_CROSSPOST_JOB, post.id, { inMs: 0 })
}

/**
 * Queues a `blog.publish` job for every post that needs one and has none waiting: a scheduled
 * post, at its time, and a live post whose newsletter or cross-post was never settled, at once. The worker calls
 * it at start and after the public demo's nightly wipe, which empties the job table but keeps the
 * blog (docs/demo.md). Running it again queues nothing more. Answers how many it queued.
 */
export async function queueDueBlogJobs(sql: postgres.Sql): Promise<number> {
  const posts = await sql<{ id: string; publishAt: Date | null; status: string }[]>`
    SELECT p.id, p.publish_at, p.status FROM blog_posts p
    WHERE (p.status = 'scheduled'
        OR (p.status = 'published' AND p.newsletter_list IS NOT NULL
          AND p.newsletter_sent_at IS NULL)
        OR (p.status = 'published' AND p.crossposted_at IS NULL))
      AND NOT EXISTS (
        SELECT 1 FROM outbox_events o
        WHERE o.processed_at IS NULL AND o.event_kind = ${BLOG_PUBLISH_JOB}
          AND o.aggregate_type = ${JOB_AGGREGATE} AND o.aggregate_id = p.id
      )
  `
  for (const post of posts) {
    await enqueueJob(
      sql,
      BLOG_PUBLISH_JOB,
      post.id,
      post.status === `scheduled` && post.publishAt ? { at: post.publishAt } : { inMs: 0 },
    )
  }
  return posts.length
}
