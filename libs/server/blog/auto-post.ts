import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AutoPostChannel,
  BLOG_AUTO_POST_KEY_MISSING,
  BLOG_POST_JOBS,
  blogAutoPostTargets,
  type BlogChannelKind,
  type BlogPostJobKind,
  blogPostPath,
  type BlogShare,
  channelUtmSource,
  type SharingPost,
  withUtmSource,
} from "@domain/blog"
import type { Language } from "@domain/identity"
import { enqueueJob, JOB_AGGREGATE, type JobHandler } from "../jobs/jobs.ts"
import type { BlogPostRow } from "./postgres-blog-repository.ts"

/**
 * What the automatic posts to Telegram, Mastodon, Bluesky, Hashnode and LinkedIn share: which
 * channels a live post is queued for, and the one job shape each kind's job fills in with its own
 * poster (`blog-post-<kind>-job.ts`). Each job is about one share row, the post's row on one
 * channel, and records the copy's address there. docs/blog.md says how it runs.
 *
 * @module
 */

/** The channel of the share a job posts, as the poster needs it. */
export interface AutoPostChannelRow extends AutoPostChannel {
  address: string
  utmSource: string
  addUtm: boolean
}

/** Everything a poster needs to post one post to one channel. */
export interface AutoPostContext {
  shareId: string
  post: BlogPostRow
  channel: AutoPostChannelRow
  /** The public website's origin, such as `https://www.example.com`. */
  siteUrl: string
  /** The post's address, clean, as search engines know it. */
  canonical: string
  /** The post's address with the channel's `utm_source`, the one the copy links to. */
  link: string
  /** The cover's address on the website, or `null` without one. */
  cover: string | null
}

/** What one attempt to post, or to look a copy up, came to. */
export type AutoPostOutcome =
  | { url: string }
  | { problem: string; uncertain: boolean }

/**
 * How a kind posts, and how a retried run avoids a second copy:
 *
 * - `idempotent`: the channel itself answers a repeat with the first copy (Mastodon's
 *   `Idempotency-Key`, which Mastodon keeps for about an hour), so every run just posts.
 * - `lookup`: the row is marked before posting, so the run after one that may have posted (it
 *   failed unsure, or died) looks the copy up first and posts only when it finds none (Bluesky,
 *   Hashnode).
 * - `once`: there is no lookup, so the row is marked before posting, and a row that is marked and
 *   not posted is never posted again by itself: the operator decides (Telegram, LinkedIn).
 */
export type AutoPostMode = `idempotent` | `lookup` | `once`

/** One kind's poster. It holds its keys itself; the job never sees them. */
export interface AutoPoster {
  kind: BlogPostJobKind
  mode: AutoPostMode
  post(context: AutoPostContext): Promise<AutoPostOutcome>
  /** The copy already on the channel, `null` for none; needed for `lookup`. */
  find?(context: AutoPostContext): Promise<{ found: string | null } | { problem: string }>
  /** How long to wait before a lookup, for a channel whose search lags behind its posts. */
  waitBeforeFindMs?: number
  /** Why the poster cannot post now (such as an expired sign-in), as a row's `error`, or `null`. */
  unavailable?(): string | null
  /** Values a stored error must never hold, as a last guard over the client's own cleaning. */
  secrets: readonly string[]
}

/** What an automatic post job needs. */
export interface AutoPostJobDeps {
  sql: postgres.Sql
  /** The website's origin, `null` without `MPA_DOMAIN`: then nothing is posted. */
  siteUrl: string | null
  /** `null` while the kind's key is not set: the row stays manual, with one log line. */
  poster: AutoPoster | null
  /** Told why a row stays manual. Gets no key. */
  log: (line: string) => void
  /** Waits before a lookup; tests pass an instant one. */
  sleep?: (ms: number) => Promise<void>
}

/** The post failed in a way the job system may try again. The message never holds a key. */
export class AutoPostError extends Error {
  constructor(kind: BlogChannelKind, shareId: string, readonly problem: string) {
    super(`Automatic ${kind} post of share ${shareId} failed: ${problem}`)
    this.name = `AutoPostError`
  }
}

/** The longest reason a row keeps; the checklist shows it in one sentence. */
const REASON_MAX = 200

/** The reason a `once` row keeps when an earlier run was cut off before it heard back. */
export const AUTO_POST_INTERRUPTED =
  `the last try stopped before Seed heard back, so the post may be there already. Check the channel`

/** Whether a client's error says the post may exist, as `@spy4x/integrations` words it. */
export function mayHavePosted(error: string): boolean {
  return /\bmay exist\b/i.test(error)
}

/**
 * A failure's reason as a row keeps it: every secret replaced, one line, at most
 * {@link REASON_MAX} characters, without the final period the checklist's sentence adds.
 */
export function autoPostReason(problem: string, secrets: readonly string[]): string {
  let text = problem
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join(`<REDACTED:TOKEN>`)
  }
  text = text.replace(/\s+/g, ` `).trim().replace(/[.\s]+$/, ``)
  const chars = Array.from(text)
  return chars.length > REASON_MAX ? `${chars.slice(0, REASON_MAX - 1).join(``)}…` : text
}

// #region Queueing

const JOB_KINDS = Object.keys(BLOG_POST_JOBS) as BlogPostJobKind[]

/** A post's or its original's rows, looked up by post and channel. */
async function sharesOf(
  sql: postgres.Sql | postgres.TransactionSql,
  post: Pick<BlogPostRow, `id` | `translationOf`>,
): Promise<(postId: string, channelId: string) => Pick<BlogShare, `status`> | undefined> {
  const ids = post.translationOf === null ? [post.id] : [post.id, post.translationOf]
  const rows = await sql<Pick<BlogShare, `postId` | `channelId` | `status`>[]>`
    SELECT post_id, channel_id, status FROM blog_post_shares WHERE post_id IN ${sql(ids)}
  `
  const map = new Map(rows.map((row) => [`${row.postId}:${row.channelId}`, row]))
  return (postId, channelId) => map.get(`${postId}:${channelId}`)
}

/** The gap rule's view of a post row. */
function sharingPost(post: BlogPostRow): SharingPost {
  return {
    id: post.id,
    language: post.language,
    translationOf: post.translationOf,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  }
}

interface ChannelRow extends Omit<AutoPostChannelRow, `startsAt` | `archivedAt` | `languages`> {
  startsAt: Date | null
  archivedAt: Date | null
  languages: string[]
}

function toChannel(row: ChannelRow): AutoPostChannelRow {
  return {
    ...row,
    languages: row.languages as Language[],
    startsAt: row.startsAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }
}

const CHANNEL_COLUMNS = `id, kind, address, utm_source, add_utm, languages, starts_at, archived_at,
  auto_post`

/**
 * The channels of `kinds` that live `post` is posted to by itself now ({@link blogAutoPostTargets}).
 */
export async function autoPostTargets(
  sql: postgres.Sql | postgres.TransactionSql,
  post: BlogPostRow,
  kinds: readonly BlogChannelKind[] = JOB_KINDS,
): Promise<AutoPostChannelRow[]> {
  const rows = await sql<ChannelRow[]>`
    SELECT ${sql.unsafe(CHANNEL_COLUMNS)} FROM blog_channels
    WHERE auto_post AND archived_at IS NULL AND kind IN ${sql(kinds as string[])}
    ORDER BY created_at, id
  `
  if (rows.length === 0) return []
  return blogAutoPostTargets(sharingPost(post), rows.map(toChannel), await sharesOf(sql, post))
}

/** Queues the job of `kind` about share `shareId`, unless one waits already. */
export async function queueAutoPost(
  sql: postgres.Sql | postgres.TransactionSql,
  kind: BlogPostJobKind,
  shareId: string,
): Promise<void> {
  const [waiting] = await sql`
    SELECT 1 FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${shareId}
      AND event_kind = ${BLOG_POST_JOBS[kind]} AND processed_at IS NULL
  `
  if (!waiting) await enqueueJob(sql as postgres.Sql, BLOG_POST_JOBS[kind], shareId, { inMs: 0 })
}

/**
 * Queues the automatic posts of a post that is live, in `blog.publish`'s transaction: for each
 * target channel, an automatic "to do" row and its kind's job about that row. Answers how many.
 */
export async function queueAutoPosts(
  tx: postgres.TransactionSql,
  post: BlogPostRow,
): Promise<number> {
  const targets = await autoPostTargets(tx, post)
  for (const channel of targets) {
    const [share] = await tx<{ id: string }[]>`
      INSERT INTO blog_post_shares (id, post_id, channel_id, status, automatic)
      VALUES (${uuidV7()}, ${post.id}, ${channel.id}, 'todo', true)
      ON CONFLICT (post_id, channel_id) DO UPDATE SET automatic = true, updated_at = now()
      RETURNING id
    `
    await queueAutoPost(tx, channel.kind as BlogPostJobKind, share.id)
  }
  return targets.length
}

// #endregion

// #region The job

interface ShareRow {
  id: string
  postId: string
  channelId: string
  status: BlogShare[`status`]
  error: string | null
  postAttemptedAt: Date | null
}

/** Sets an error on a row still to do; a row the operator moved on from keeps what it has. */
async function recordProblem(
  sql: postgres.Sql | postgres.TransactionSql,
  shareId: string,
  reason: string,
  attempted: `keep` | `clear`,
): Promise<void> {
  await sql`
    UPDATE blog_post_shares SET error = ${reason}, automatic = true, updated_at = now(),
      post_attempted_at = CASE WHEN ${attempted} = 'clear' THEN NULL ELSE post_attempted_at END
    WHERE id = ${shareId} AND status = 'todo'
  `
}

/** Marks a row still to do posted at `url`, by Seed. */
async function recordPosted(sql: postgres.Sql, shareId: string, url: string): Promise<void> {
  await sql`
    UPDATE blog_post_shares SET status = 'posted', url = ${url}, shared_at = now(),
      automatic = true, error = NULL, post_attempted_at = NULL, skip_reason = NULL,
      read_error = NULL, read_failed_at = NULL, updated_at = now()
    WHERE id = ${shareId} AND status = 'todo'
  `
}

/**
 * The job that posts one share row's post to its channel by itself, with `poster` for the kind.
 * Its event's `aggregateId` is the share's id.
 *
 * A row is posted only while it is still to do, its post is live, and its channel is active, has
 * "Post automatically" on, is of the poster's kind and still lists the post. A copy that lands
 * marks the row posted with its address. The lock on the row's id only keeps two runs from
 * planning at once; it is released before the network call.
 *
 * A posted row is done. Each {@link AutoPostMode} says how a later run avoids a second copy after
 * one that may have posted, whether it failed unsure, died, or outlived its lease: `lookup` and
 * `once` kinds mark the row before the call, Mastodon relies on its idempotency key. That key
 * lasts about an hour, so a Mastodon copy that landed while every retry in that hour failed in
 * transport can be posted again; a lookup that misses a copy (Bluesky's feed lags) can too. A clear
 * refusal stores its reason and fails the run, so the job system tries again. A failure that may
 * have posted fails the run of a `lookup` kind (the retry looks first) and ends a `once` kind's run
 * with its reason stored, so the operator decides. Without the kind's key, or without the
 * website's address, the row keeps `key-missing` and one log line says so; the post stays live.
 */
export function autoPostJob(kind: BlogPostJobKind, deps: AutoPostJobDeps): JobHandler {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)))
  return async (event) => {
    const shareId = event.aggregateId
    const plan = await deps.sql.begin(async (tx) => {
      const [{ locked }] = await tx<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`blog.auto-post:${shareId}`}, 0))
          AS locked
      `
      if (!locked) return null
      const [share] = await tx<ShareRow[]>`
        SELECT id, post_id, channel_id, status, error, post_attempted_at
        FROM blog_post_shares WHERE id = ${shareId} FOR UPDATE
      `
      if (!share || share.status !== `todo`) return null
      const [post] = await tx<BlogPostRow[]>`SELECT * FROM blog_posts WHERE id = ${share.postId}`
      if (!post || post.status !== `published`) return null
      const fits = (await autoPostTargets(tx, post, [kind]))
        .find((channel) => channel.id === share.channelId)
      if (!fits) return null
      if (deps.poster === null || deps.siteUrl === null) {
        const missing = deps.poster === null ? `its key is unset` : `MPA_DOMAIN is unset`
        deps.log(`blog post ${post.id}: no automatic ${kind} post: ${missing}`)
        await recordProblem(tx, share.id, BLOG_AUTO_POST_KEY_MISSING, `keep`)
        return null
      }
      const unavailable = deps.poster.unavailable?.() ?? null
      if (unavailable !== null) {
        deps.log(`blog post ${post.id}: no automatic ${kind} post: ${unavailable}`)
        await recordProblem(tx, share.id, unavailable, `keep`)
        return null
      }
      const attempted = share.postAttemptedAt !== null
      if (deps.poster.mode === `once` && attempted) {
        // An earlier run may have posted: never again by itself.
        if (share.error === null) {
          await recordProblem(tx, share.id, AUTO_POST_INTERRUPTED, `keep`)
        }
        return null
      }
      if (deps.poster.mode !== `idempotent` && !attempted) {
        // Committed before the post, so a run that dies half way leaves the mark behind: a `once`
        // row then waits for the operator, and a `lookup` row's next run looks the copy up first.
        await tx`UPDATE blog_post_shares SET post_attempted_at = now() WHERE id = ${share.id}`
      }
      const canonical = `${deps.siteUrl}${blogPostPath(post)}`
      const context: AutoPostContext = {
        shareId: share.id,
        post,
        channel: fits,
        siteUrl: deps.siteUrl,
        canonical,
        link: withUtmSource(canonical, channelUtmSource(fits)),
        cover: post.coverFile ? `${deps.siteUrl}/blog/covers/${post.coverFile}` : post.coverUrl,
      }
      return { context, lookFirst: attempted }
    })
    if (plan === null) return
    const poster = deps.poster!
    const { context } = plan
    const reason = (problem: string) => autoPostReason(problem, poster.secrets)

    if (plan.lookFirst && poster.find) {
      if (poster.waitBeforeFindMs) await sleep(poster.waitBeforeFindMs)
      const found = await poster.find(context)
      if (`problem` in found) {
        await recordProblem(deps.sql, context.shareId, reason(found.problem), `keep`)
        throw new AutoPostError(kind, context.shareId, reason(found.problem))
      }
      if (found.found !== null) {
        return void await recordPosted(deps.sql, context.shareId, found.found)
      }
    }

    const outcome = await poster.post(context)
    if (`url` in outcome) return void await recordPosted(deps.sql, context.shareId, outcome.url)
    const why = reason(outcome.problem)
    if (!outcome.uncertain) {
      // A sure refusal of this run's only try clears the mark; one after an earlier try that may
      // have landed keeps it, so the next run still looks first.
      await recordProblem(deps.sql, context.shareId, why, plan.lookFirst ? `keep` : `clear`)
      throw new AutoPostError(kind, context.shareId, why)
    }
    // The mark stays. A `once` row waits for the operator, who checks the channel, then tries again
    // or marks it posted; a `lookup` row's retry looks the copy up first.
    await recordProblem(deps.sql, context.shareId, why, `keep`)
    if (poster.mode === `once`) return
    throw new AutoPostError(kind, context.shareId, why)
  }
}

// #endregion

/** The automatic posts' setup: the website's origin and each kind's poster whose key is set. */
export interface AutoPostSetup {
  /** `null` without `MPA_DOMAIN`: every row stays manual. */
  siteUrl: string | null
  posters: Partial<Record<BlogPostJobKind, AutoPoster | null>>
}
