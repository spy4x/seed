/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { OutboxEvent } from "@spy4x/server/outbox"
import {
  BLOG_AUTO_POST_KEY_MISSING,
  BLOG_AUTO_POST_SIGN_IN_EXPIRED,
  BLOG_POST_JOBS,
  type BlogChannelKind,
  type BlogPostFields,
  type BlogPostJobKind,
  BlogSharingError,
} from "@domain/blog"
import { PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import {
  PostgresSharingRepository,
  type SharingActor,
} from "@server/blog/postgres-sharing-repository.ts"
import {
  AUTO_POST_INTERRUPTED,
  type AutoPoster,
  AutoPostError,
  autoPostJob,
  queueAutoPosts,
} from "@server/blog/auto-post.ts"
import { type TelegramPostClient, telegramPoster } from "@server/blog/blog-post-telegram-job.ts"
import { type MastodonPostClient, mastodonPoster } from "@server/blog/blog-post-mastodon-job.ts"
import {
  BLUESKY_FIND_WAIT_MS,
  type BlueskyPostClient,
  blueskyPoster,
} from "@server/blog/blog-post-bluesky-job.ts"
import { type HashnodePostClient, hashnodePoster } from "@server/blog/blog-post-hashnode-job.ts"
import { type LinkedinPostClient, linkedinPoster } from "@server/blog/blog-post-linkedin-job.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * The automatic posts to Telegram, Mastodon, Bluesky, Hashnode and LinkedIn against a real
 * Postgres, each kind's real poster over a fake client: which rows a live post queues, and how
 * each job posts once, records the copy, and never posts a second copy after a failure that may
 * have posted. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md);
 * it fails when they are missing rather than skipping.
 */

const SITE = `https://www.example.com`
const TOKEN = `fake-token-0123456789abcdef`
const ADDRESSES: Record<BlogPostJobKind, string> = {
  telegram: `https://t.me/seednews`,
  mastodon: `@seed@mastodon.social`,
  bluesky: `https://bsky.app/profile/seed.example.com`,
  hashnode: `https://seed.hashnode.dev`,
  linkedin: `https://www.linkedin.com/in/seed`,
}

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `auto_post_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function operator(sql: postgres.Sql): Promise<SharingActor> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, 'Maya', 'Chen', 3 FROM auth_user RETURNING id
  `
  return { userId: id, requestId: `req-${id}` }
}

function fields(slug: string, extra: Partial<BlogPostFields> = {}): BlogPostFields {
  return {
    title: `Post ${slug}`,
    slug,
    description: `About ${slug}.`,
    seoTitle: null,
    tldr: [],
    topic: null,
    coverUrl: null,
    coverAlt: null,
    authorUrl: null,
    intro: null,
    relatedFeature: null,
    bodyMd: `Hello.`,
    language: `en`,
    translationOf: null,
    ...extra,
  }
}

async function livePost(
  sql: postgres.Sql,
  actor: SharingActor,
  slug: string,
  extra: Partial<BlogPostFields> = {},
): Promise<string> {
  const blog = new PostgresBlogRepository(sql)
  const id = uuidV7()
  await blog.create(id, fields(slug, extra), actor)
  await blog.publish(id, 1, null, null, actor)
  return id
}

async function channel(
  sql: postgres.Sql,
  kind: BlogChannelKind,
  extra: { autoPost?: boolean; archived?: boolean; address?: string } = {},
): Promise<string> {
  const id = uuidV7()
  const address = extra.address ?? ADDRESSES[kind as BlogPostJobKind] ?? `https://example.com`
  await sql`
    INSERT INTO blog_channels (id, name, kind, address, utm_source, languages, auto_post, archived_at)
    VALUES (
      ${id}, ${kind}, ${kind}, ${address}, ${`${kind}-${id.slice(-6)}`}, '{en,de}',
      ${extra.autoPost ?? true}, ${extra.archived ? new Date() : null}
    )
  `
  return id
}

/** Runs `blog.publish`'s queueing step for post `id`, as the job does in its transaction. */
async function queue(sql: postgres.Sql, id: string): Promise<number> {
  return await sql.begin(async (tx) => {
    const [post] = await tx`SELECT * FROM blog_posts WHERE id = ${id}`
    return await queueAutoPosts(tx, post as never)
  })
}

interface Row {
  id: string
  status: string
  url: string | null
  automatic: boolean
  error: string | null
  sharedAt: Date | null
  attempted: boolean
}

async function rowOf(sql: postgres.Sql, postId: string, channelId: string): Promise<Row> {
  const [row] = await sql<Row[]>`
    SELECT id, status, url, automatic, error, shared_at, post_attempted_at IS NOT NULL AS attempted
    FROM blog_post_shares WHERE post_id = ${postId} AND channel_id = ${channelId}
  `
  return row
}

async function waitingJobs(sql: postgres.Sql, kind: BlogPostJobKind): Promise<string[]> {
  const rows = await sql<{ aggregateId: string }[]>`
    SELECT aggregate_id::text FROM outbox_events
    WHERE event_kind = ${BLOG_POST_JOBS[kind]} AND processed_at IS NULL ORDER BY created_at
  `
  return rows.map((row) => row.aggregateId)
}

const eventOf = (kind: BlogPostJobKind, shareId: string) =>
  ({ id: uuidV7(), aggregateId: shareId, eventKind: BLOG_POST_JOBS[kind] }) as OutboxEvent

/** A share row to do, queued as `blog.publish` queues it. */
async function queued(sql: postgres.Sql, kind: BlogPostJobKind, slug: string) {
  const maya = await operator(sql)
  const channelId = await channel(sql, kind)
  const postId = await livePost(sql, maya, slug)
  await queue(sql, postId)
  const row = await rowOf(sql, postId, channelId)
  return { maya, channelId, postId, shareId: row.id }
}

type Answer<T> = { success: true; output: T; error?: never } | { success: false; error: string }

const ok = <T>(output: T): Answer<T> => ({ success: true, output })
const failed = (error: string): Answer<never> => ({ success: false, error })

/** Every kind's real poster over a client that answers from a script and counts its calls. */
function posters() {
  const calls: { kind: string; method: string; input: unknown }[] = []
  const script: Partial<Record<string, Answer<{ url: string } | null>[]>> = {}
  const next = (kind: string, method: string, input: unknown) => {
    calls.push({ kind, method, input })
    return Promise.resolve(script[`${kind}.${method}`]?.shift() ?? ok({ url: `https://${kind}/1` }))
  }
  const telegram: TelegramPostClient = {
    call: <T>(method: string, params: object) => {
      calls.push({ kind: `telegram`, method, input: params })
      const answer = script[`telegram.post`]?.shift()
      if (answer && !answer.success) {
        const [code, status] = answer.error.split(` `)
        return Promise.resolve({
          ok: false as const,
          code: code as never,
          status: Number(status) || undefined,
          message: `Telegram said no ${TOKEN}`,
          attempts: 1,
        })
      }
      return Promise.resolve({ ok: true as const, result: { message_id: 42 } as T, attempts: 1 })
    },
  }
  const mastodon: MastodonPostClient = {
    post: (input) => next(`mastodon`, `post`, input) as ReturnType<MastodonPostClient[`post`]>,
  }
  const bluesky: BlueskyPostClient = {
    post: (input) => next(`bluesky`, `post`, input) as ReturnType<BlueskyPostClient[`post`]>,
    find: (uri) => next(`bluesky`, `find`, uri),
  }
  const hashnode: HashnodePostClient = {
    publish: (input) =>
      next(`hashnode`, `post`, input) as ReturnType<HashnodePostClient[`publish`]>,
    find: (slug) => next(`hashnode`, `find`, slug),
  }
  const linkedin: LinkedinPostClient = {
    post: (input) => next(`linkedin`, `post`, input) as ReturnType<LinkedinPostClient[`post`]>,
  }
  const made: Record<BlogPostJobKind, AutoPoster> = {
    telegram: telegramPoster(telegram, TOKEN),
    mastodon: mastodonPoster(mastodon, TOKEN, `https://mastodon.social`),
    bluesky: blueskyPoster(bluesky, TOKEN),
    hashnode: hashnodePoster(hashnode, TOKEN),
    linkedin: linkedinPoster(linkedin, { accessToken: TOKEN, expiresAt: null }),
  }
  const posts = (kind: string) =>
    calls.filter((call) => call.kind === kind && call.method !== `find`)
  return { made, calls, script, posts }
}

function jobOf(
  sql: postgres.Sql,
  kind: BlogPostJobKind,
  poster: AutoPoster | null,
  extra: { log?: string[]; slept?: number[] } = {},
) {
  return autoPostJob(kind, {
    sql,
    siteUrl: SITE,
    poster,
    log: (line) => extra.log?.push(line),
    sleep: (ms) => (extra.slept?.push(ms), Promise.resolve()),
  })
}

const KINDS = Object.keys(BLOG_POST_JOBS) as BlogPostJobKind[]

Deno.test(`auto-post: a live post queues one automatic row and one job per automatic channel, once`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const telegram = await channel(sql, `telegram`)
    const manual = await channel(sql, `mastodon`, { autoPost: false })
    const archived = await channel(sql, `bluesky`, { archived: true })
    const reddit = await channel(sql, `reddit`, { address: `r/selfhosted` })
    const skipped = await channel(sql, `linkedin`)
    const postId = await livePost(sql, maya, `queued`)
    await sql`
      INSERT INTO blog_post_shares (id, post_id, channel_id, status, skip_reason)
      VALUES (${uuidV7()}, ${postId}, ${skipped}, 'skipped', 'Not for LinkedIn')
    `

    expect(await queue(sql, postId)).toBe(1)
    expect(await queue(sql, postId)).toBe(1)

    const row = await rowOf(sql, postId, telegram)
    expect(row).toMatchObject({ status: `todo`, automatic: true, error: null })
    expect(await waitingJobs(sql, `telegram`)).toEqual([row.id])
    for (const id of [manual, archived, reddit]) {
      expect(await rowOf(sql, postId, id)).toBeUndefined()
    }
    expect((await rowOf(sql, postId, skipped)).status).toBe(`skipped`)
    expect(await waitingJobs(sql, `linkedin`)).toEqual([])
  })
})

Deno.test(`auto-post: a translation is never queued where its original was posted or suggested`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const [posted, suggested, open] = [
      await channel(sql, `telegram`),
      await channel(sql, `mastodon`),
      await channel(sql, `hashnode`),
    ]
    const original = await livePost(sql, maya, `original`)
    for (const [id, status] of [[posted, `posted`], [suggested, `suggested`]] as const) {
      await sql`
        INSERT INTO blog_post_shares (id, post_id, channel_id, status)
        VALUES (${uuidV7()}, ${original}, ${id}, ${status})
      `
    }
    const german = await livePost(sql, maya, `uebersetzt`, {
      language: `de`,
      translationOf: original,
    })

    expect(await queue(sql, german)).toBe(1)
    expect(await rowOf(sql, german, posted)).toBeUndefined()
    expect(await rowOf(sql, german, suggested)).toBeUndefined()
    expect((await rowOf(sql, german, open)).status).toBe(`todo`)
  })
})

Deno.test(`auto-post: each kind posts once, records the copy's address, and a second run posts nothing`, async () => {
  for (const kind of KINDS) {
    await withSchema(async (sql) => {
      const { postId, channelId, shareId } = await queued(sql, kind, `posted-${kind}`)
      const fake = posters()
      const job = jobOf(sql, kind, fake.made[kind])

      await job(eventOf(kind, shareId))
      await job(eventOf(kind, shareId))

      expect(fake.posts(kind)).toHaveLength(1)
      const row = await rowOf(sql, postId, channelId)
      const url = kind === `telegram` ? `https://t.me/seednews/42` : `https://${kind}/1`
      expect(row).toMatchObject({ status: `posted`, url, automatic: true, error: null })
      expect(row.sharedAt).not.toBeNull()
    })
  }
})

Deno.test(`auto-post: a row the operator skipped or posted by hand posts nothing`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `mastodon`, `handled`)
    const fake = posters()
    for (const status of [`skipped`, `posted`]) {
      await sql`UPDATE blog_post_shares SET status = ${status} WHERE id = ${shareId}`
      await jobOf(sql, `mastodon`, fake.made.mastodon)(eventOf(`mastodon`, shareId))
      expect((await rowOf(sql, postId, channelId)).status).toBe(status)
    }
    expect(fake.calls).toEqual([])
  })
})

Deno.test(`auto-post: a channel switched to manual or archived after the queueing posts nothing`, async () => {
  for (const change of [`manual`, `archived`] as const) {
    await withSchema(async (sql) => {
      const { postId, channelId, shareId } = await queued(sql, `mastodon`, `changed-${change}`)
      const fake = posters()
      if (change === `manual`) {
        await sql`UPDATE blog_channels SET auto_post = false WHERE id = ${channelId}`
      } else {
        await sql`UPDATE blog_channels SET archived_at = now() WHERE id = ${channelId}`
      }

      await jobOf(sql, `mastodon`, fake.made.mastodon)(eventOf(`mastodon`, shareId))

      expect(fake.calls).toEqual([])
      expect((await rowOf(sql, postId, channelId)).status).toBe(`todo`)
    })
  }
})

Deno.test(`auto-post: Mastodon sends the share's id as its idempotency key, the same on a retry`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `mastodon`, `mastodon-twice`)
    const fake = posters()
    fake.script[`mastodon.post`] = [failed(`Mastodon timed out; the status may exist`)]
    const job = jobOf(sql, `mastodon`, fake.made.mastodon)

    await expect(job(eventOf(`mastodon`, shareId))).rejects.toThrow(AutoPostError)
    await job(eventOf(`mastodon`, shareId))

    const keys = fake.posts(`mastodon`).map((call) =>
      (call.input as { idempotencyKey: string }).idempotencyKey
    )
    expect(keys).toEqual([shareId, shareId])
    expect((await rowOf(sql, postId, channelId)).status).toBe(`posted`)
  })
})

Deno.test(`auto-post: after a Bluesky failure that may have posted, the retry waits, looks the copy up and posts none`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `bluesky`, `bluesky-maybe`)
    const fake = posters()
    const slept: number[] = []
    const copy = `https://bsky.app/profile/did:plc:abc/post/3k`
    fake.script[`bluesky.post`] = [failed(`Bluesky timed out; the post may exist`)]
    fake.script[`bluesky.find`] = [ok({ url: copy })]
    const job = jobOf(sql, `bluesky`, fake.made.bluesky, { slept })

    await expect(job(eventOf(`bluesky`, shareId))).rejects.toThrow(AutoPostError)
    expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `todo`, attempted: true })
    expect(slept).toEqual([])

    await job(eventOf(`bluesky`, shareId))

    expect(slept).toEqual([BLUESKY_FIND_WAIT_MS])
    expect(fake.calls.map((call) => call.method)).toEqual([`post`, `find`])
    expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `posted`, url: copy })
  })
})

Deno.test(`auto-post: after a Hashnode failure that may have posted, the retry looks first and posts only when it finds none`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `hashnode`, `hashnode-maybe`)
    const fake = posters()
    const slept: number[] = []
    fake.script[`hashnode.post`] = [failed(`Hashnode answered 502; the article may exist`)]
    fake.script[`hashnode.find`] = [ok(null)]
    const job = jobOf(sql, `hashnode`, fake.made.hashnode, { slept })

    await expect(job(eventOf(`hashnode`, shareId))).rejects.toThrow(AutoPostError)
    await job(eventOf(`hashnode`, shareId))

    expect(slept).toEqual([])
    expect(fake.calls.map((call) => call.method)).toEqual([`post`, `find`, `post`])
    expect(fake.calls[1].input).toBe(`hashnode-maybe`)
    expect(await rowOf(sql, postId, channelId)).toMatchObject({
      status: `posted`,
      attempted: false,
    })
  })
})

Deno.test(`auto-post: after a Hashnode failure that may have posted, a copy the retry finds is recorded and not posted again`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `hashnode`, `hashnode-found`)
    const fake = posters()
    const copy = `https://seed.hashnode.dev/hashnode-found`
    fake.script[`hashnode.post`] = [failed(`Hashnode answered 502; the article may exist`)]
    fake.script[`hashnode.find`] = [ok({ url: copy })]
    const job = jobOf(sql, `hashnode`, fake.made.hashnode)

    await expect(job(eventOf(`hashnode`, shareId))).rejects.toThrow(AutoPostError)
    await job(eventOf(`hashnode`, shareId))

    expect(fake.calls.map((call) => call.method)).toEqual([`post`, `find`])
    expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `posted`, url: copy })
  })
})

Deno.test(`auto-post: a Bluesky or Hashnode run that dies after its post lands is followed by a lookup that records the copy, with no second post`, async () => {
  for (const kind of [`bluesky`, `hashnode`] as const) {
    await withSchema(async (sql) => {
      const { postId, channelId, shareId } = await queued(sql, kind, `died-${kind}`)
      const fake = posters()
      const copy = `https://${kind}/landed`
      fake.script[`${kind}.find`] = [ok({ url: copy })]
      const gone = (): Promise<never> => Promise.reject(new Error(`worker gone`))
      const dying: Record<typeof kind, AutoPoster> = {
        bluesky: blueskyPoster({ post: gone, find: () => gone() }, TOKEN),
        hashnode: hashnodePoster({ publish: gone, find: () => gone() }, TOKEN),
      }
      const slept: number[] = []

      await expect(jobOf(sql, kind, dying[kind])(eventOf(kind, shareId))).rejects.toThrow(
        `worker gone`,
      )
      expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `todo`, attempted: true })

      await jobOf(sql, kind, fake.made[kind], { slept })(eventOf(kind, shareId))

      expect(fake.calls.map((call) => call.method)).toEqual([`find`])
      expect(slept).toEqual(kind === `bluesky` ? [BLUESKY_FIND_WAIT_MS] : [])
      expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `posted`, url: copy })
    })
  }
})

Deno.test(`auto-post: after a Telegram or LinkedIn failure that may have posted, the row keeps the reason and is never posted again`, async () => {
  const uncertain: Record<`telegram` | `linkedin`, Answer<never>> = {
    telegram: failed(`network_error`),
    linkedin: failed(`LinkedIn timed out; the post may exist`),
  }
  for (const kind of [`telegram`, `linkedin`] as const) {
    await withSchema(async (sql) => {
      const { postId, channelId, shareId } = await queued(sql, kind, `once-${kind}`)
      const fake = posters()
      fake.script[`${kind}.post`] = [uncertain[kind]]
      const job = jobOf(sql, kind, fake.made[kind])

      await job(eventOf(kind, shareId))
      const row = await rowOf(sql, postId, channelId)
      expect(row).toMatchObject({ status: `todo`, automatic: true, attempted: true })
      expect(row.error).not.toBeNull()

      await job(eventOf(kind, shareId))
      expect(fake.posts(kind)).toHaveLength(1)
      expect((await rowOf(sql, postId, channelId)).error).toBe(row.error)
    })
  }
})

Deno.test(`auto-post: a Telegram refusal fails the run for a retry, which posts`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `telegram`, `telegram-refused`)
    const fake = posters()
    fake.script[`telegram.post`] = [failed(`http_error 400`)]
    const job = jobOf(sql, `telegram`, fake.made.telegram)

    await expect(job(eventOf(`telegram`, shareId))).rejects.toThrow(AutoPostError)
    expect(await rowOf(sql, postId, channelId)).toMatchObject({ status: `todo`, attempted: false })
    await job(eventOf(`telegram`, shareId))

    expect(fake.posts(`telegram`)).toHaveLength(2)
    expect((await rowOf(sql, postId, channelId)).status).toBe(`posted`)
  })
})

Deno.test(`auto-post: a run cut off before it heard back leaves a once-only row to the operator`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `linkedin`, `cut-off`)
    await sql`UPDATE blog_post_shares SET post_attempted_at = now() WHERE id = ${shareId}`
    const fake = posters()

    await jobOf(sql, `linkedin`, fake.made.linkedin)(eventOf(`linkedin`, shareId))

    expect(fake.calls).toEqual([])
    expect((await rowOf(sql, postId, channelId)).error).toBe(AUTO_POST_INTERRUPTED)
  })
})

Deno.test(`auto-post: without its key a row stays manual, with one log line and no key in it`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `hashnode`, `no-key`)
    const log: string[] = []

    await jobOf(sql, `hashnode`, null, { log })(eventOf(`hashnode`, shareId))

    expect(log).toHaveLength(1)
    expect(log[0]).toContain(`hashnode`)
    expect(log[0]).not.toContain(TOKEN)
    expect(await rowOf(sql, postId, channelId)).toMatchObject({
      status: `todo`,
      error: BLOG_AUTO_POST_KEY_MISSING,
    })
  })
})

Deno.test(`auto-post: an expired LinkedIn sign-in keeps the row manual and posts nothing`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `linkedin`, `expired`)
    const fake = posters()
    const client: LinkedinPostClient = { post: () => Promise.reject(new Error(`must not post`)) }
    const expired = linkedinPoster(client, {
      accessToken: TOKEN,
      expiresAt: `2026-01-01T00:00:00.000Z`,
    })
    const log: string[] = []

    await jobOf(sql, `linkedin`, expired, { log })(eventOf(`linkedin`, shareId))

    expect(fake.calls).toEqual([])
    expect(log).toHaveLength(1)
    expect((await rowOf(sql, postId, channelId)).error).toBe(BLOG_AUTO_POST_SIGN_IN_EXPIRED)
  })
})

Deno.test(`auto-post: the key never reaches a stored error or the job's error`, async () => {
  await withSchema(async (sql) => {
    const { postId, channelId, shareId } = await queued(sql, `telegram`, `secret`)
    const fake = posters()
    fake.script[`telegram.post`] = [failed(`http_error 401`)]

    const run = jobOf(sql, `telegram`, fake.made.telegram)(eventOf(`telegram`, shareId))
    const error = await run.then(() => null, (thrown: Error) => thrown)

    const stored = (await rowOf(sql, postId, channelId)).error ?? ``
    expect(stored).toContain(`<REDACTED:TOKEN>`)
    expect(stored).not.toContain(TOKEN)
    expect(error?.message ?? ``).not.toContain(TOKEN)
  })
})

Deno.test(`auto-post: Try again clears the reason and the mark, queues the job and writes the audit row`, async () => {
  await withSchema(async (sql) => {
    const { maya, postId, channelId, shareId } = await queued(sql, `telegram`, `try-again`)
    const sharing = new PostgresSharingRepository(sql)
    await sql`DELETE FROM outbox_events`
    await sql`
      UPDATE blog_post_shares SET error = 'Telegram timed out', post_attempted_at = now()
      WHERE id = ${shareId}
    `

    await sharing.retryShare(postId, channelId, maya)
    await sharing.retryShare(postId, channelId, maya)

    expect(await rowOf(sql, postId, channelId)).toMatchObject({ error: null, attempted: false })
    expect(await waitingJobs(sql, `telegram`)).toEqual([shareId])
    const audit = await sql`
      SELECT event_kind FROM audit_events WHERE entity_id = ${postId} AND event_kind LIKE 'blog.share%'
    `
    expect(audit).toEqual([
      { eventKind: `blog.share_retried` },
      { eventKind: `blog.share_retried` },
    ])
    expect((await sharing.postSharing(postId))?.posting).toEqual(new Set([channelId]))

    const manual = await channel(sql, `mastodon`, { autoPost: false })
    await expect(sharing.retryShare(postId, manual, maya)).rejects.toThrow(BlogSharingError)
    await sql`UPDATE blog_post_shares SET status = 'posted' WHERE id = ${shareId}`
    await expect(sharing.retryShare(postId, channelId, maya)).rejects.toThrow(BlogSharingError)
  })
})
