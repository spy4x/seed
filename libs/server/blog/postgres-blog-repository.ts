import type postgres from "postgres"
import { likeContains } from "@spy4x/server/db"
import {
  ADMIN_BLOG_LIST_MAX,
  type AdminBlogCounts,
  type AdminBlogListResponse,
  type AdminBlogPostRow,
  BLOG_AUDIT_KINDS,
  BLOG_POST_ENTITY,
  BLOG_PUBLISH_JOB,
  type BlogAuditKind,
  BlogError,
  type BlogPost,
  type BlogPostFields,
  type BlogPostStatus,
  type BlogTopic,
  BlogVersionConflictError,
} from "@domain/blog"
import type { Language } from "@domain/identity"
import { enqueueJob, JOB_AGGREGATE } from "../jobs/jobs.ts"

/** The operator behind a write, for its audit row. */
export interface BlogActor {
  userId: number
  /** The request's id, so the audit row can be matched with the request log. */
  requestId: string | null
}

/** A `blog_posts` row as Postgres answers it (camelCase through the client's transform). */
export interface BlogPostRow {
  id: string
  slug: string
  title: string
  seoTitle: string | null
  description: string
  tldr: string[]
  topic: string | null
  coverUrl: string | null
  coverAlt: string | null
  bodyMd: string
  language: Language
  translationOf: string | null
  status: BlogPostStatus
  publishAt: Date | null
  publishedAt: Date | null
  contentUpdatedAt: Date | null
  authorId: number | null
  authorName: string | null
  newsletterList: string | null
  newsletterSentAt: Date | null
  newsletterRecipients: number | null
  createdAt: Date
  updatedAt: Date
  version: number
}

/** A row as the admin app reads it: every time as an ISO string. */
export function toBlogPost(row: BlogPostRow): BlogPost {
  const iso = (date: Date | null) => date?.toISOString() ?? null
  return {
    ...row,
    tldr: [...row.tldr],
    publishAt: iso(row.publishAt),
    publishedAt: iso(row.publishedAt),
    contentUpdatedAt: iso(row.contentUpdatedAt),
    newsletterSentAt: iso(row.newsletterSentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The constraint a second post with the same slug breaks. */
const SLUG_UNIQUE = `blog_posts_slug_unique`

/** The index a second translation of one post into the same language breaks. */
const TRANSLATION_UNIQUE = `blog_posts_translation_language_unique`

/** A refusal of the post's language or the post it translates, about `translationOf`. */
function translationInvalid(message: string): BlogError {
  return new BlogError(`TRANSLATION_INVALID`, message, `translationOf`)
}

/**
 * `error` as {@link BlogError} `SLUG_TAKEN` or `TRANSLATION_INVALID` when it is the slug's or the
 * translation's unique violation, else as is.
 */
function slugTaken(error: unknown): unknown {
  const pg = error as { code?: string; constraint_name?: string; constraint?: string }
  const constraint = pg?.code === `23505` ? pg.constraint_name ?? pg.constraint : undefined
  if (constraint === SLUG_UNIQUE) {
    return new BlogError(`SLUG_TAKEN`, `Another post has this address. Pick another.`, `slug`)
  }
  if (constraint === TRANSLATION_UNIQUE) {
    return translationInvalid(`That post already has a translation into this language.`)
  }
  return error
}

/**
 * Checks, in the write's transaction, that post `id` may be in `fields.language` and translate
 * `fields.translationOf`. A translation points at a post of its own (not at another translation,
 * and not at itself) in another language, and a post that others translate translates nothing
 * itself. A post's language may not be one a translation of it already has. Throws
 * `TRANSLATION_INVALID`; a second translation into one language is refused by the database.
 */
async function checkTranslation(
  tx: postgres.TransactionSql,
  id: string,
  fields: Pick<BlogPostFields, `language` | `translationOf`>,
): Promise<void> {
  const original = fields.translationOf
  if (original === null) {
    const [clash] = await tx`
      SELECT 1 FROM blog_posts WHERE translation_of = ${id} AND language = ${fields.language}
    `
    if (clash) throw translationInvalid(`A translation of this post is in that language already.`)
    return
  }
  if (original === id) throw translationInvalid(`A post cannot translate itself.`)
  const [target] = await tx<Pick<BlogPostRow, `language` | `translationOf`>[]>`
    SELECT language, translation_of FROM blog_posts WHERE id = ${original}
  `
  if (!target) throw translationInvalid(`The post this translates does not exist any more.`)
  if (target.translationOf !== null) {
    throw translationInvalid(`Pick the original post, not one of its translations.`)
  }
  if (target.language === fields.language) {
    throw translationInvalid(`A translation is in another language than its original.`)
  }
  const [translated] = await tx`SELECT 1 FROM blog_posts WHERE translation_of = ${id} LIMIT 1`
  if (translated) {
    throw translationInvalid(`Other posts translate this one, so it cannot be a translation.`)
  }
}

/**
 * The blog's reads and writes for the admin app (#395). It checks no role: only the operator area
 * calls it, behind its gate. Every write runs in one transaction that locks the post, checks the
 * version the operator saw, changes the post, queues its `blog.publish` job when one is due, and
 * writes the operator's audit row, so a write and its record are kept or undone together. Two
 * operators acting at once are served one after the other, and the second gets a version
 * conflict.
 */
export class PostgresBlogRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /**
   * Up to {@link ADMIN_BLOG_LIST_MAX} posts, most recently changed first, with `status` when given,
   * whose title or slug holds every word of `query`; and the count of each status for that search.
   */
  async list(
    filter: { status: BlogPostStatus | null; query: string },
  ): Promise<AdminBlogListResponse> {
    const sql = this.sql
    let where = sql`TRUE`
    for (const word of filter.query.split(/\s+/).filter(Boolean)) {
      const pattern = likeContains(word)
      where = sql`${where} AND (title ILIKE ${pattern} OR slug ILIKE ${pattern})`
    }
    const status = filter.status === null ? sql`TRUE` : sql`status = ${filter.status}`
    const posts = await sql<AdminBlogPostRowRaw[]>`
      SELECT id, slug, title, status, topic, language, translation_of, publish_at, published_at,
        updated_at
      FROM blog_posts
      WHERE ${where} AND ${status}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${ADMIN_BLOG_LIST_MAX}
    `
    const byStatus = await sql<{ status: BlogPostStatus; count: number }[]>`
      SELECT status, COUNT(*)::int AS count FROM blog_posts WHERE ${where} GROUP BY status
    `
    const counts: AdminBlogCounts = { all: 0, draft: 0, scheduled: 0, published: 0 }
    for (const row of byStatus) {
      counts[row.status] = row.count
      counts.all += row.count
    }
    return {
      posts: posts.map((row) => ({
        ...row,
        publishAt: row.publishAt?.toISOString() ?? null,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      })),
      counts,
    }
  }

  /** One post, or `null` when there is none with `id`. */
  async get(id: string): Promise<BlogPost | null> {
    const [row] = await this.sql<BlogPostRow[]>`SELECT * FROM blog_posts WHERE id = ${id}`
    return row ? toBlogPost(row) : null
  }

  /** Every topic any post carries, drafts included, with how many posts carry it, A to Z. */
  async topics(): Promise<BlogTopic[]> {
    return await this.sql<BlogTopic[]>`
      SELECT topic, COUNT(*)::int AS count FROM blog_posts
      WHERE topic IS NOT NULL
      GROUP BY topic
      ORDER BY lower(topic), topic
    `
  }

  /**
   * Creates a draft by `actor`, who becomes its author. A create retried with the same id and slug
   * by the same operator answers the post the first one made, and writes nothing more.
   */
  async create(id: string, fields: BlogPostFields, actor: BlogActor): Promise<BlogPost> {
    return await this.write(async (tx) => {
      await checkTranslation(tx, id, fields)
      const [row] = await tx<BlogPostRow[]>`
        INSERT INTO blog_posts (
          id, slug, title, seo_title, description, tldr, topic, cover_url, cover_alt, body_md,
          language, translation_of, author_id, author_name
        ) VALUES (
          ${id}, ${fields.slug}, ${fields.title}, ${fields.seoTitle}, ${fields.description},
          ${tx.array(fields.tldr)}::text[], ${fields.topic}, ${fields.coverUrl}, ${fields.coverAlt},
          ${fields.bodyMd}, ${fields.language}, ${fields.translationOf}, ${actor.userId},
          (SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '')
            FROM users WHERE id = ${actor.userId})
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `
      if (!row) {
        const [first] = await tx<BlogPostRow[]>`SELECT * FROM blog_posts WHERE id = ${id}`
        if (
          first && first.version === 1 && first.slug === fields.slug &&
          first.authorId === actor.userId
        ) return toBlogPost(first)
        throw new BlogError(`ID_ALREADY_EXISTS`, `A post with this id exists already.`)
      }
      await audit(tx, actor, BLOG_AUDIT_KINDS.created, row)
      return toBlogPost(row)
    })
  }

  /**
   * Saves every field of the post at `version`. Its slug stays once the post has been published
   * (`SLUG_LOCKED`; {@link changeUrl} changes it). `significantUpdate` on a published post moves
   * its "Updated" date to now.
   */
  async update(
    id: string,
    version: number,
    fields: BlogPostFields,
    significantUpdate: boolean,
    actor: BlogActor,
  ): Promise<BlogPost> {
    return await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      if (fields.slug !== current.slug && current.publishedAt !== null) {
        throw new BlogError(
          `SLUG_LOCKED`,
          `The address is locked since the post was published. Use Change URL.`,
          `slug`,
        )
      }
      await checkTranslation(tx, id, fields)
      const [row] = await tx<BlogPostRow[]>`
        UPDATE blog_posts
        SET slug = ${fields.slug}, title = ${fields.title}, seo_title = ${fields.seoTitle},
          description = ${fields.description}, tldr = ${tx.array(fields.tldr)}::text[],
          topic = ${fields.topic}, cover_url = ${fields.coverUrl}, cover_alt = ${fields.coverAlt},
          body_md = ${fields.bodyMd}, language = ${fields.language},
          translation_of = ${fields.translationOf},
          content_updated_at = CASE WHEN ${significantUpdate} AND status = 'published'
            THEN now() ELSE content_updated_at END,
          updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING *
      `
      await audit(tx, actor, BLOG_AUDIT_KINDS.updated, row)
      return toBlogPost(row)
    })
  }

  /**
   * Publishes a draft or scheduled post now (`at` is `null`), or schedules it for `at`, which
   * the caller has checked lies ahead. A `blog.publish` job is queued for `at`, or at once when a
   * post going live now has a newsletter to send. `newsletterList` is the list to email when the
   * post goes live, or `null` for none; once a post's issue was queued, its list stays as it was
   * and nothing is sent again.
   */
  async publish(
    id: string,
    version: number,
    at: Date | null,
    newsletterList: string | null,
    actor: BlogActor,
  ): Promise<BlogPost> {
    return await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      if (current.status === `published`) {
        throw new BlogError(`NOT_DRAFT_OR_SCHEDULED`, `This post is published already.`)
      }
      const sent = current.newsletterSentAt !== null
      const list = sent ? current.newsletterList : newsletterList
      const [row] = at === null
        ? await tx<BlogPostRow[]>`
          UPDATE blog_posts
          SET status = 'published', publish_at = now(),
            published_at = COALESCE(published_at, now()), newsletter_list = ${list},
            updated_at = now(), version = version + 1
          WHERE id = ${id}
          RETURNING *
        `
        : await tx<BlogPostRow[]>`
          UPDATE blog_posts
          SET status = 'scheduled', publish_at = ${at}, newsletter_list = ${list},
            updated_at = now(), version = version + 1
          WHERE id = ${id}
          RETURNING *
        `
      if (at !== null) await queuePublishJob(tx, id, { at })
      else if (list !== null && !sent) await queuePublishJob(tx, id, { inMs: 0 })
      await audit(
        tx,
        actor,
        at === null ? BLOG_AUDIT_KINDS.published : BLOG_AUDIT_KINDS.scheduled,
        row,
        { newsletterList: sent ? null : list, ...(at && { at: at.toISOString() }) },
      )
      return toBlogPost(row)
    })
  }

  /**
   * Takes a scheduled post back to drafts. A newsletter it was going to send is cancelled; the
   * job that waits for its time finds a draft and does nothing.
   */
  async unschedule(id: string, version: number, actor: BlogActor): Promise<BlogPost> {
    return await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      if (current.status !== `scheduled`) {
        throw new BlogError(`NOT_SCHEDULED`, `This post is not scheduled.`)
      }
      const [row] = await tx<BlogPostRow[]>`
        UPDATE blog_posts
        SET status = 'draft', publish_at = NULL,
          newsletter_list = CASE WHEN newsletter_sent_at IS NULL THEN NULL
            ELSE newsletter_list END,
          updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING *
      `
      await audit(tx, actor, BLOG_AUDIT_KINDS.unscheduled, row)
      return toBlogPost(row)
    })
  }

  /**
   * Takes a published post off the website, back to drafts. Its first publish date, its locked
   * slug and the record of a sent newsletter stay.
   */
  async unpublish(id: string, version: number, actor: BlogActor): Promise<BlogPost> {
    return await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      if (current.status !== `published`) {
        throw new BlogError(`NOT_PUBLISHED`, `This post is not published.`)
      }
      const [row] = await tx<BlogPostRow[]>`
        UPDATE blog_posts
        SET status = 'draft', publish_at = NULL, updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING *
      `
      await audit(tx, actor, BLOG_AUDIT_KINDS.unpublished, row)
      return toBlogPost(row)
    })
  }

  /** Gives the post a new slug, whatever its status. Links to the old one stop working. */
  async changeUrl(id: string, version: number, slug: string, actor: BlogActor): Promise<BlogPost> {
    return await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      if (current.slug === slug) {
        throw new BlogError(`SLUG_UNCHANGED`, `This is the post's address already.`, `slug`)
      }
      const [row] = await tx<BlogPostRow[]>`
        UPDATE blog_posts
        SET slug = ${slug}, updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING *
      `
      await audit(tx, actor, BLOG_AUDIT_KINDS.urlChanged, row, { from: current.slug })
      return toBlogPost(row)
    })
  }

  /** Deletes the post for good, whatever its status. A job waiting for it finds nothing. */
  async delete(id: string, version: number, actor: BlogActor): Promise<void> {
    await this.write(async (tx) => {
      const current = await lock(tx, id, version)
      await tx`DELETE FROM blog_posts WHERE id = ${id}`
      await audit(tx, actor, BLOG_AUDIT_KINDS.deleted, current, { title: current.title })
    })
  }

  /** Runs `body` in a transaction, answering a slug taken by another post as `SLUG_TAKEN`. */
  private async write<T>(body: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    try {
      return await this.sql.begin(body) as T
    } catch (error) {
      throw slugTaken(error)
    }
  }
}

interface AdminBlogPostRowRaw
  extends Omit<AdminBlogPostRow, `publishAt` | `publishedAt` | `updatedAt`> {
  publishAt: Date | null
  publishedAt: Date | null
  updatedAt: Date
}

/**
 * Locks the post for the rest of the transaction and checks that it is still at `version`.
 * Throws `POST_NOT_FOUND` when it is gone, or {@link BlogVersionConflictError} with its version.
 */
async function lock(
  tx: postgres.TransactionSql,
  id: string,
  version: number,
): Promise<BlogPostRow> {
  const [row] = await tx<BlogPostRow[]>`SELECT * FROM blog_posts WHERE id = ${id} FOR UPDATE`
  if (!row) throw new BlogError(`POST_NOT_FOUND`, `This post does not exist any more.`)
  if (row.version !== version) throw new BlogVersionConflictError(row.version)
  return row
}

/**
 * Queues the post's `blog.publish` job in the write's transaction. The job table holds one row per
 * post and run time (`aggregate_version` is the time in milliseconds), so scheduling again for a
 * time whose job still waits adds nothing: that job publishes the post.
 */
async function queuePublishJob(
  tx: postgres.TransactionSql,
  id: string,
  when: { at: Date } | { inMs: number },
): Promise<void> {
  if (`at` in when) {
    const [waiting] = await tx`
      SELECT 1 FROM outbox_events
      WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${id}
        AND aggregate_version = ${when.at.getTime()} AND event_kind = ${BLOG_PUBLISH_JOB}
    `
    if (waiting) return
  }
  await enqueueJob(
    tx,
    BLOG_PUBLISH_JOB,
    id,
    when,
  )
}

/** Writes the operator's audit row of one action on `post`. Its details name the post's slug. */
async function audit(
  tx: postgres.TransactionSql,
  actor: BlogActor,
  kind: BlogAuditKind,
  post: Pick<BlogPostRow, `id` | `slug`>,
  details: Record<string, string | null> = {},
): Promise<void> {
  await tx`
    INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
    VALUES (
      ${kind}, ${actor.userId}, ${actor.requestId}, ${BLOG_POST_ENTITY}, ${post.id},
      ${tx.json({ slug: post.slug, ...details })}
    )
  `
}
