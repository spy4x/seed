import type postgres from "postgres"
import { isSubscriberList } from "@domain/subscribers"
import { BLOG_PUBLISH_JOB, blogPostPath } from "@domain/blog"
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

/** What the `blog.publish` job needs. */
export interface BlogPublishJobDeps {
  sql: postgres.Sql
  /** The app's address, for the issue's footer. */
  brand: MailBrand
  /** `null` when mail subscriptions are off: the post goes live and nothing is emailed. */
  setup: SubscribersSetup | null
  /** Told why a newsletter was not queued. Gets no address. */
  log: (line: string) => void
}

/** The longest preheader an issue takes (`subscriberIssueSchema`). */
const PREHEADER_MAX_LENGTH = 200

/**
 * The newsletter issue of a post: its title as the subject and heading, its description, its key
 * points and a "Read the post" button, in the post's language, to the post on the public website,
 * at its language's address. The issue id is the post's id, so the send log knows it as one issue
 * whatever happens to the post.
 */
export function blogTeaserIssue(
  post: Pick<BlogPostRow, `id` | `slug` | `title` | `description` | `tldr` | `language`>,
  siteUrl: string,
): SubscriberIssue {
  return subscriberIssueSchema.assert({
    id: post.id,
    subject: post.title,
    preheader: Array.from(post.description).slice(0, PREHEADER_MAX_LENGTH).join(``),
    blocks: [
      { heading: post.title },
      { paragraph: post.description },
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
 * The `blog.publish` job, about one post. In one transaction that locks the post, it:
 *
 * 1. publishes a scheduled post whose time has come. A post unscheduled, deleted or moved to a
 *    later time since the job was queued is left alone: the job of its new time publishes it. A
 *    run before the post's time with no other run waiting (the admin's Run now) queues one for
 *    that time, so the post still goes live then.
 * 2. queues the post's newsletter issue when the post is live, has a list and has never been
 *    emailed, and records when and to how many confirmed subscribers. The issue goes only to the
 *    subscribers of the post's language (#527), so nobody gets a post in a language they did not
 *    sign up in. That record is written in
 *    the same transaction as the issue's job, so a retried, repeated or concurrent run, or
 *    publishing again after unpublishing, never queues a second issue.
 *
 * With mail subscriptions off, without the public website's address (`MPA_DOMAIN`) or with a list
 * the app no longer has, the post still goes live and the issue is not queued; the worker queues
 * this job again at its next start (`queueDueBlogJobs`).
 */
export function blogPublishJob(deps: BlogPublishJobDeps): JobHandler {
  return async (event) => {
    await deps.sql.begin(async (tx) => {
      const [post] = await tx<(BlogPostRow & { due: boolean })[]>`
        SELECT *, publish_at <= now() AS due FROM blog_posts
        WHERE id = ${event.aggregateId}
        FOR UPDATE
      `
      if (!post) return
      if (post.status === `scheduled` && !post.due && post.publishAt) {
        // Run early (the admin's Run now): queue the run at the post's time, unless one waits.
        const [waiting] = await tx`
          SELECT 1 FROM outbox_events
          WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${post.id}
            AND event_kind = ${BLOG_PUBLISH_JOB} AND processed_at IS NULL AND id <> ${event.id}
        `
        if (!waiting) await enqueueJob(tx, BLOG_PUBLISH_JOB, post.id, { at: post.publishAt })
        return
      }
      let live = post.status === `published`
      if (post.status === `scheduled` && post.due) {
        await tx`
          UPDATE blog_posts
          SET status = 'published', published_at = COALESCE(published_at, now()),
            updated_at = now(), version = version + 1
          WHERE id = ${post.id}
        `
        live = true
      }
      const list = post.newsletterList
      if (!live || list === null || post.newsletterSentAt !== null) return
      const siteUrl = deps.setup?.siteUrl
      if (!siteUrl || !isSubscriberList(list)) {
        deps.log(
          `warning: blog post ${post.id} went live, but its newsletter was not queued: ` +
            `mail subscriptions, MPA_DOMAIN or the list ${list} are off`,
        )
        return
      }
      const { size: confirmed } = await subscribersInLanguage(tx, list, post.language)
      // Not a new version: the operator's open editor keeps saving; only the record changes.
      await tx`
        UPDATE blog_posts SET newsletter_sent_at = now(), newsletter_recipients = ${confirmed}
        WHERE id = ${post.id}
      `
      const issue = renderSubscriberIssue(
        deps.brand,
        blogTeaserIssue(post, siteUrl),
        post.language,
      )
      await queueSubscriberIssue(tx, list, issue)
    })
  }
}

/**
 * Queues a `blog.publish` job for every post that needs one and has none waiting: a scheduled
 * post, at its time, and a live post whose newsletter was never queued, at once. The worker calls
 * it at start and after the public demo's nightly wipe, which empties the job table but keeps the
 * blog (docs/demo.md). Running it again queues nothing more. Answers how many it queued.
 */
export async function queueDueBlogJobs(sql: postgres.Sql): Promise<number> {
  const posts = await sql<{ id: string; publishAt: Date | null; status: string }[]>`
    SELECT p.id, p.publish_at, p.status FROM blog_posts p
    WHERE (p.status = 'scheduled'
        OR (p.status = 'published' AND p.newsletter_list IS NOT NULL
          AND p.newsletter_sent_at IS NULL))
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
