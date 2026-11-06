import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminBlogChannelRow,
  type AdminBlogChannelsResponse,
  BLOG_CHANNEL_ENTITY,
  BLOG_CHANNELS_MAX,
  BLOG_CROSSPOST_JOB,
  BLOG_POST_ENTITY,
  BLOG_POST_JOBS,
  BLOG_SHARING_AUDIT_KINDS,
  type BlogChannel,
  type BlogChannelFields,
  type BlogChannelKind,
  BlogChannelVersionConflictError,
  type BlogPostJobKind,
  type BlogShare,
  type BlogShareResult,
  type BlogShareResultsRequest,
  type BlogShareStatus,
  BlogSharingError,
  blogSharingToDo,
  channelPostsAutomatically,
  type SharingPost,
} from "@domain/blog"
import type { Language } from "@domain/identity"
import { enqueueJob, JOB_AGGREGATE } from "../jobs/jobs.ts"
import { queueAutoPost } from "./auto-post.ts"

/** The operator behind a write, for its audit row. */
export interface SharingActor {
  userId: number
  requestId: string | null
}

/** A post as the sharing checklist needs it: the gap rule's fields and the words of its texts. */
export interface SharingPostRecord extends SharingPost {
  title: string
  slug: string
  description: string
  intro: string | null
  tldr: string[]
}

/** Everything a post's checklist is built from. */
export interface PostSharing {
  post: SharingPostRecord
  /** Every channel, archived ones included, by name. */
  channels: BlogChannel[]
  /** The post's own rows by channel id. */
  own: Map<string, BlogShare>
  /** The original's rows by channel id, for a translation. */
  original: Map<string, BlogShare>
  /** The latest numbers of each of the post's rows, by share id. */
  results: Map<string, BlogShareResult>
  /** The channels whose automatic post of this post is waiting or running. */
  posting: Set<string>
}

/** How many channels list each live post as to do, and how many channels are active. */
export interface SharingGaps {
  activeChannels: number
  toDo: Record<string, number>
}

/** A share change: what to set on the post's rows of the named channels. */
export interface ShareChange {
  status: BlogShareStatus | `none`
  url: string | null
  skipReason: string | null
  /** When it was posted or suggested; `null` takes now. */
  sharedAt: string | null
  /** Undo's row as it was: whether it was automatic and its error. `null` for a change by hand. */
  restore: { automatic: boolean; error: string | null } | null
}

interface ChannelRow
  extends Omit<BlogChannel, `startsAt` | `archivedAt` | `createdAt` | `updatedAt`> {
  startsAt: Date | null
  archivedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface ShareRow extends Omit<BlogShare, `sharedAt` | `readFailedAt` | `updatedAt`> {
  sharedAt: Date | null
  readFailedAt: Date | null
  updatedAt: Date
}

interface PostRow extends Omit<SharingPostRecord, `publishedAt`> {
  publishedAt: Date | null
}

const iso = (date: Date | null) => date?.toISOString() ?? null

function toChannel(row: ChannelRow): BlogChannel {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    address: row.address,
    utmSource: row.utmSource,
    addUtm: row.addUtm,
    languages: row.languages as Language[],
    startsAt: iso(row.startsAt),
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    autoPost: row.autoPost,
  }
}

function toShare(row: ShareRow): BlogShare {
  return {
    id: row.id,
    postId: row.postId,
    channelId: row.channelId,
    status: row.status,
    url: row.url,
    sharedAt: iso(row.sharedAt),
    skipReason: row.skipReason,
    automatic: row.automatic,
    error: row.error,
    readError: row.readError,
    readFailedAt: iso(row.readFailedAt),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const CHANNEL_COLUMNS = `id, name, kind, address, utm_source, add_utm, languages, starts_at,
  archived_at, created_at, updated_at, version, auto_post`
const SHARE_COLUMNS = `id, post_id, channel_id, status, url, shared_at, skip_reason, automatic,
  error, read_error, read_failed_at, updated_at`

/**
 * The sharing channels' reads and writes for the admin app. It checks no role: only the operator
 * area calls it, behind its gate. A channel write runs in one transaction that locks the channels,
 * checks the version the operator saw and writes the operator's audit row; a share write takes the
 * post's row lock, so two changes to one post are served one after the other.
 */
export class PostgresSharingRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /** Every channel with its counts, and every live post's language and time. */
  async channels(): Promise<Omit<AdminBlogChannelsResponse, `linkedinExpiresAt`>> {
    const [channels, posts, shares, counts] = await Promise.all([
      this.listChannels(this.sql),
      this.livePosts(),
      this.liveShares(),
      this.sql<{ channelId: string; shares: number; lastError: string | null }[]>`
        SELECT channel_id, COUNT(*)::int AS shares,
          (array_agg(error ORDER BY updated_at DESC) FILTER (WHERE error IS NOT NULL))[1]
            AS last_error
        FROM blog_post_shares GROUP BY channel_id
      `,
    ])
    const byChannel = new Map(counts.map((row) => [row.channelId, row]))
    const find = lookup(shares)
    const rows: AdminBlogChannelRow[] = channels.map((channel) => ({
      ...channel,
      shares: byChannel.get(channel.id)?.shares ?? 0,
      lastError: byChannel.get(channel.id)?.lastError ?? null,
      toDo: posts.filter((post) => blogSharingToDo(post, [channel], find) > 0).length,
    }))
    return {
      channels: rows,
      livePosts: posts.map((post) => ({ language: post.language, publishedAt: post.publishedAt! })),
    }
  }

  /** How many active channels each live post still lists as to do. */
  async gaps(): Promise<SharingGaps> {
    const [channels, posts, shares] = await Promise.all([
      this.listChannels(this.sql),
      this.livePosts(),
      this.liveShares(),
    ])
    const active = channels.filter((channel) => channel.archivedAt === null)
    const find = lookup(shares)
    const toDo: Record<string, number> = {}
    for (const post of posts) {
      const count = blogSharingToDo(post, active, find)
      if (count > 0) toDo[post.id] = count
    }
    return { activeChannels: active.length, toDo }
  }

  /** Everything the checklist of post `id` is built from, or `null` when there is no such post. */
  async postSharing(id: string): Promise<PostSharing | null> {
    const [post] = await this.sql<PostRow[]>`
      SELECT id, title, slug, description, intro, tldr, language, translation_of, status,
        published_at
      FROM blog_posts WHERE id = ${id}
    `
    if (!post) return null
    const postIds = post.translationOf === null ? [post.id] : [post.id, post.translationOf]
    const [channels, shares] = await Promise.all([
      this.listChannels(this.sql),
      this.sql<ShareRow[]>`
        SELECT ${this.sql.unsafe(SHARE_COLUMNS)} FROM blog_post_shares
        WHERE post_id IN ${this.sql(postIds)}
      `,
    ])
    const own = new Map<string, BlogShare>()
    const original = new Map<string, BlogShare>()
    for (const row of shares) {
      ;(row.postId === post.id ? own : original).set(row.channelId, toShare(row))
    }
    const ownIds = [...own.values()].map((share) => share.id)
    const results = new Map<string, BlogShareResult>()
    if (ownIds.length > 0) {
      const rows = await this.sql<(BlogShareResult & { shareId: string; readAt: Date })[]>`
        SELECT DISTINCT ON (share_id) share_id, read_at, source, views, reactions, comments, score
        FROM blog_share_results WHERE share_id IN ${this.sql(ownIds)}
        ORDER BY share_id, read_at DESC, id DESC
      `
      for (const { shareId, readAt, ...result } of rows) {
        results.set(shareId, { ...result, readAt: readAt.toISOString() })
      }
    }
    return {
      post: { ...post, tldr: post.tldr ?? [], publishedAt: iso(post.publishedAt) },
      channels,
      own,
      original,
      results,
      posting: await this.posting(post.id, ownIds),
    }
  }

  /**
   * Adds a channel. A create retried with the same id and fields answers the channel the first one
   * made; any other reuse of an id is refused.
   */
  async createChannel(
    id: string,
    fields: BlogChannelFields,
    actor: SharingActor,
  ): Promise<BlogChannel> {
    return await this.writeChannels(async (tx) => {
      const [first] = await tx<ChannelRow[]>`
        SELECT ${tx.unsafe(CHANNEL_COLUMNS)} FROM blog_channels WHERE id = ${id}
      `
      if (first) {
        const same = first.version === 1 && first.name === fields.name &&
          first.utmSource === fields.utmSource && first.kind === fields.kind
        if (same) return toChannel(first)
        throw new BlogSharingError(`ID_ALREADY_EXISTS`, `A channel with this id exists already.`)
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM blog_channels
      `
      if (count >= BLOG_CHANNELS_MAX) {
        throw new BlogSharingError(
          `TOO_MANY_CHANNELS`,
          `The blog keeps ${BLOG_CHANNELS_MAX} channels at most. Delete one first.`,
        )
      }
      await taken(tx, id, fields)
      const [row] = await tx<ChannelRow[]>`
        INSERT INTO blog_channels (
          id, name, kind, address, utm_source, add_utm, languages, starts_at, auto_post
        ) VALUES (
          ${id}, ${fields.name}, ${fields.kind}, ${fields.address}, ${fields.utmSource},
          ${fields.addUtm}, ${tx.array(fields.languages)}::text[], ${fields.startsAt},
          ${fields.autoPost}
        )
        RETURNING ${tx.unsafe(CHANNEL_COLUMNS)}
      `
      await auditChannel(tx, actor, BLOG_SHARING_AUDIT_KINDS.channelCreated, row)
      return toChannel(row)
    })
  }

  /** Saves every field of the channel at `version`. */
  async updateChannel(
    id: string,
    version: number,
    fields: BlogChannelFields,
    actor: SharingActor,
  ): Promise<BlogChannel> {
    return await this.writeChannels(async (tx) => {
      await current(tx, id, version)
      await taken(tx, id, fields)
      const [row] = await tx<ChannelRow[]>`
        UPDATE blog_channels SET name = ${fields.name}, kind = ${fields.kind},
          address = ${fields.address}, utm_source = ${fields.utmSource}, add_utm = ${fields.addUtm},
          languages = ${tx.array(fields.languages)}::text[], starts_at = ${fields.startsAt},
          auto_post = ${fields.autoPost}, updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING ${tx.unsafe(CHANNEL_COLUMNS)}
      `
      await auditChannel(tx, actor, BLOG_SHARING_AUDIT_KINDS.channelUpdated, row)
      return toChannel(row)
    })
  }

  /** Archives the channel at `version`, or restores it with `archived` false. */
  async archiveChannel(
    id: string,
    version: number,
    archived: boolean,
    actor: SharingActor,
  ): Promise<BlogChannel> {
    return await this.writeChannels(async (tx) => {
      await current(tx, id, version)
      const [row] = await tx<ChannelRow[]>`
        UPDATE blog_channels
        SET archived_at = ${archived ? tx`now()` : null}, updated_at = now(),
          version = version + 1
        WHERE id = ${id}
        RETURNING ${tx.unsafe(CHANNEL_COLUMNS)}
      `
      const kind = archived
        ? BLOG_SHARING_AUDIT_KINDS.channelArchived
        : BLOG_SHARING_AUDIT_KINDS.channelRestored
      await auditChannel(tx, actor, kind, row)
      return toChannel(row)
    })
  }

  /** Deletes the channel at `version`; refused with `HAS_SHARES` once any post has a row on it. */
  async deleteChannel(id: string, version: number, actor: SharingActor): Promise<void> {
    await this.writeChannels(async (tx) => {
      const row = await current(tx, id, version)
      const [used] = await tx`SELECT 1 FROM blog_post_shares WHERE channel_id = ${id} LIMIT 1`
      if (used) {
        throw new BlogSharingError(
          `HAS_SHARES`,
          `This channel has shares, so it can only be archived.`,
        )
      }
      await tx`DELETE FROM blog_channels WHERE id = ${id}`
      await auditChannel(tx, actor, BLOG_SHARING_AUDIT_KINDS.channelDeleted, row)
    })
  }

  /**
   * Sets `change` on post `postId`'s rows of `channelIds`, making the rows that do not exist.
   * `none` removes a row with no results. Refused with `NOT_PUBLISHED` for a post that is not live
   * and `CHANNEL_NOT_FOUND` when a channel is gone. Writes one audit row on the post.
   */
  async setShares(
    postId: string,
    channelIds: readonly string[],
    change: ShareChange,
    actor: SharingActor,
  ): Promise<void> {
    const ids = [...new Set(channelIds)]
    await this.sql.begin(async (tx) => {
      const [post] = await tx<{ status: string }[]>`
        SELECT status FROM blog_posts WHERE id = ${postId} FOR UPDATE
      `
      if (!post) throw new BlogSharingError(`POST_NOT_FOUND`, `This post does not exist.`)
      if (post.status !== `published`) {
        throw new BlogSharingError(`NOT_PUBLISHED`, `Only a live post can be shared.`)
      }
      const found = await tx<{ id: string }[]>`
        SELECT id FROM blog_channels WHERE id IN ${tx(ids)}
      `
      if (found.length !== ids.length) {
        throw new BlogSharingError(`CHANNEL_NOT_FOUND`, `This channel does not exist any more.`)
      }
      if (change.status === `none`) {
        await tx`
          DELETE FROM blog_post_shares AS share
          WHERE share.post_id = ${postId} AND share.channel_id IN ${tx(ids)}
            AND NOT EXISTS (SELECT 1 FROM blog_share_results WHERE share_id = share.id)
        `
      } else {
        const shared = change.status === `posted` || change.status === `suggested`
        const at = shared ? change.sharedAt ?? new Date().toISOString() : null
        const rows = ids.map((channelId) => ({
          id: uuidV7(),
          post_id: postId,
          channel_id: channelId,
          status: change.status,
          url: change.url,
          shared_at: at,
          skip_reason: change.skipReason,
          automatic: change.restore?.automatic ?? false,
          error: change.restore?.error ?? null,
        }))
        const restore = change.restore !== null
        await tx`
          INSERT INTO blog_post_shares ${
          tx(
            rows,
            `id`,
            `post_id`,
            `channel_id`,
            `status`,
            `url`,
            `shared_at`,
            `skip_reason`,
            `automatic`,
            `error`,
          )
        }
          ON CONFLICT (post_id, channel_id) DO UPDATE SET
            status = EXCLUDED.status, url = EXCLUDED.url, shared_at = EXCLUDED.shared_at,
            skip_reason = EXCLUDED.skip_reason, automatic = EXCLUDED.automatic,
            error = CASE
              WHEN ${restore} THEN EXCLUDED.error
              WHEN EXCLUDED.status = 'posted' THEN NULL
              ELSE blog_post_shares.error
            END,
            -- A new link is read afresh: the old link's failure no longer says anything.
            read_error = CASE WHEN blog_post_shares.url IS DISTINCT FROM EXCLUDED.url
              THEN NULL ELSE blog_post_shares.read_error END,
            read_failed_at = CASE WHEN blog_post_shares.url IS DISTINCT FROM EXCLUDED.url
              THEN NULL ELSE blog_post_shares.read_failed_at END,
            updated_at = now()
        `
      }
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
        VALUES (
          ${BLOG_SHARING_AUDIT_KINDS.shareChanged}, ${actor.userId}, ${actor.requestId}, ${BLOG_POST_ENTITY},
          ${postId}, ${tx.json({ channelIds: ids, status: change.status, url: change.url })}
        )
      `
    })
  }

  /** Records numbers typed by hand for post `postId`'s row on `channelId`. */
  async enterResults(
    postId: string,
    channelId: string,
    counts: BlogShareResultsRequest,
    actor: SharingActor,
  ): Promise<BlogShareResult> {
    return await this.sql.begin(async (tx) => {
      const [share] = await tx<{ id: string }[]>`
        SELECT id FROM blog_post_shares WHERE post_id = ${postId} AND channel_id = ${channelId}
      `
      if (!share) {
        throw new BlogSharingError(`SHARE_NOT_FOUND`, `Mark the post posted on this channel first.`)
      }
      const [row] = await tx<(BlogShareResult & { readAt: Date })[]>`
        INSERT INTO blog_share_results (id, share_id, source, views, reactions, comments, score)
        VALUES (
          ${uuidV7()}, ${share.id}, 'hand', ${counts.views}, ${counts.reactions},
          ${counts.comments}, ${counts.score}
        )
        RETURNING read_at, source, views, reactions, comments, score
      `
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
        VALUES (
          ${BLOG_SHARING_AUDIT_KINDS.resultsEntered}, ${actor.userId}, ${actor.requestId},
          ${BLOG_POST_ENTITY}, ${postId}, ${tx.json({ channelId, ...counts })}
        )
      `
      return { ...row, readAt: row.readAt.toISOString() }
    }) as BlogShareResult
  }

  /**
   * Asks for post `postId`'s automatic post to channel `channelId` again, after it failed or was
   * left to the operator: the row goes back to "to do" without its error or its mark of an earlier
   * try, and its kind's job is queued unless one waits already. Refused with `NOT_AUTOMATIC` for a
   * channel that does not post by itself, `NOT_PUBLISHED` for a post that is not live, and
   * `SHARE_NOT_FOUND` for a row already posted, suggested or skipped. Writes one audit row on the
   * post. Asking twice queues one job.
   */
  async retryShare(postId: string, channelId: string, actor: SharingActor): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [post] = await tx<{ status: string; translationOf: string | null }[]>`
        SELECT status, translation_of FROM blog_posts WHERE id = ${postId} FOR UPDATE
      `
      if (!post) throw new BlogSharingError(`POST_NOT_FOUND`, `This post does not exist.`)
      if (post.status !== `published`) {
        throw new BlogSharingError(`NOT_PUBLISHED`, `Only a live post can be shared.`)
      }
      const [channel] = await tx<{ kind: BlogChannelKind; autoPost: boolean }[]>`
        SELECT kind, auto_post FROM blog_channels
        WHERE id = ${channelId} AND archived_at IS NULL
      `
      if (!channel) {
        throw new BlogSharingError(`CHANNEL_NOT_FOUND`, `This channel does not exist any more.`)
      }
      if (!channelPostsAutomatically(channel, post.translationOf !== null)) {
        throw new BlogSharingError(`NOT_AUTOMATIC`, `This channel does not post by itself.`)
      }
      const [share] = await tx<{ id: string }[]>`
        INSERT INTO blog_post_shares (id, post_id, channel_id, status, automatic)
        VALUES (${uuidV7()}, ${postId}, ${channelId}, 'todo', true)
        ON CONFLICT (post_id, channel_id) DO UPDATE SET automatic = true, error = NULL,
          post_attempted_at = NULL, updated_at = now()
        WHERE blog_post_shares.status = 'todo'
        RETURNING id
      `
      if (!share) {
        throw new BlogSharingError(`SHARE_NOT_FOUND`, `This post is not to do on this channel.`)
      }
      if (channel.kind === `devto`) {
        // The cross-post settles once ever; asking again unsettles a post Dev.to never got.
        await tx`
          UPDATE blog_posts SET crossposted_at = NULL
          WHERE id = ${postId} AND devto_url IS NULL
        `
        const [waiting] = await tx`
          SELECT 1 FROM outbox_events
          WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${postId}
            AND event_kind = ${BLOG_CROSSPOST_JOB} AND processed_at IS NULL
        `
        if (!waiting) await enqueueJob(tx, BLOG_CROSSPOST_JOB, postId, { inMs: 0 })
      } else {
        await queueAutoPost(tx, channel.kind as BlogPostJobKind, share.id)
      }
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
        VALUES (
          ${BLOG_SHARING_AUDIT_KINDS.shareRetried}, ${actor.userId}, ${actor.requestId},
          ${BLOG_POST_ENTITY}, ${postId}, ${tx.json({ channelId, kind: channel.kind })}
        )
      `
    })
  }

  /** The channels of post `postId` whose automatic post is waiting or running. */
  private async posting(postId: string, shareIds: readonly string[]): Promise<Set<string>> {
    const rows = await this.sql<{ channelId: string }[]>`
      SELECT share.channel_id FROM blog_post_shares share
      JOIN outbox_events job ON job.aggregate_id = share.id
      WHERE share.id IN ${this.sql(shareIds.length > 0 ? shareIds : [postId])}
        AND job.aggregate_type = ${JOB_AGGREGATE} AND job.processed_at IS NULL
        AND job.event_kind IN ${this.sql(Object.values(BLOG_POST_JOBS))}
      UNION
      SELECT channel.id FROM blog_channels channel
      JOIN outbox_events job ON job.aggregate_id = ${postId}
      WHERE channel.kind = 'devto' AND job.aggregate_type = ${JOB_AGGREGATE}
        AND job.processed_at IS NULL AND job.event_kind = ${BLOG_CROSSPOST_JOB}
    `
    return new Set(rows.map((row) => row.channelId))
  }

  private async listChannels(sql: postgres.Sql | postgres.TransactionSql): Promise<BlogChannel[]> {
    const rows = await sql<ChannelRow[]>`
      SELECT ${sql.unsafe(CHANNEL_COLUMNS)} FROM blog_channels ORDER BY lower(name), id
    `
    return rows.map(toChannel)
  }

  private async livePosts(): Promise<SharingPost[]> {
    const rows = await this.sql<(Omit<SharingPost, `publishedAt`> & { publishedAt: Date })[]>`
      SELECT id, language, translation_of, status, published_at
      FROM blog_posts WHERE status = 'published' AND published_at IS NOT NULL
    `
    return rows.map((row) => ({ ...row, publishedAt: row.publishedAt.toISOString() }))
  }

  private async liveShares(): Promise<Pick<BlogShare, `postId` | `channelId` | `status`>[]> {
    return await this.sql<Pick<BlogShare, `postId` | `channelId` | `status`>[]>`
      SELECT share.post_id, share.channel_id, share.status
      FROM blog_post_shares share JOIN blog_posts post ON post.id = share.post_id
      WHERE post.status = 'published'
    `
  }

  /** Runs `body` in a transaction that holds the channels' write lock. */
  private async writeChannels<T>(body: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return await this.sql.begin(async (tx) => {
      await tx`LOCK TABLE blog_channels IN SHARE ROW EXCLUSIVE MODE`
      return await body(tx)
    }) as T
  }
}

/** The share rows looked up by post and channel, as the gap rule asks for them. */
function lookup(
  shares: readonly Pick<BlogShare, `postId` | `channelId` | `status`>[],
): (postId: string, channelId: string) => Pick<BlogShare, `status`> | undefined {
  const map = new Map(shares.map((share) => [`${share.postId}:${share.channelId}`, share]))
  return (postId, channelId) => map.get(`${postId}:${channelId}`)
}

/** Refuses a name or source tag another channel than `id` uses. */
async function taken(
  tx: postgres.TransactionSql,
  id: string,
  fields: Pick<BlogChannelFields, `name` | `utmSource`>,
): Promise<void> {
  const [name] = await tx`
    SELECT 1 FROM blog_channels WHERE lower(name) = lower(${fields.name}) AND id <> ${id}
  `
  if (name) {
    throw new BlogSharingError(
      `NAME_TAKEN`,
      `Another channel already uses this name.`,
      `name`,
      { code: `channelNameTaken` },
    )
  }
  const [source] = await tx`
    SELECT 1 FROM blog_channels WHERE utm_source = ${fields.utmSource} AND id <> ${id}
  `
  if (source) {
    throw new BlogSharingError(
      `UTM_SOURCE_TAKEN`,
      `Another channel already uses this source tag.`,
      `utmSource`,
      { code: `channelSourceTaken` },
    )
  }
}

/** The channel at `id`, checked to still be at `version`. */
async function current(
  tx: postgres.TransactionSql,
  id: string,
  version: number,
): Promise<ChannelRow> {
  const [row] = await tx<ChannelRow[]>`
    SELECT ${tx.unsafe(CHANNEL_COLUMNS)} FROM blog_channels WHERE id = ${id}
  `
  if (!row) throw new BlogSharingError(`CHANNEL_NOT_FOUND`, `This channel does not exist any more.`)
  if (row.version !== version) throw new BlogChannelVersionConflictError(row.version)
  return row
}

/** Writes the operator's audit row of one change to a channel. */
async function auditChannel(
  tx: postgres.TransactionSql,
  actor: SharingActor,
  kind: string,
  channel: Pick<ChannelRow, `id` | `name` | `kind`>,
): Promise<void> {
  await tx`
    INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
    VALUES (
      ${kind}, ${actor.userId}, ${actor.requestId}, ${BLOG_CHANNEL_ENTITY}, ${channel.id},
      ${tx.json({ name: channel.name, kind: channel.kind })}
    )
  `
}
