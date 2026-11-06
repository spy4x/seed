/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { OutboxEvent } from "@spy4x/server/outbox"
import {
  BLOG_CROSSPOST_JOB,
  type BlogChannelFields,
  type BlogPostFields,
  BlogSharingError,
} from "@domain/blog"
import { PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import {
  PostgresSharingRepository,
  type SharingActor,
} from "@server/blog/postgres-sharing-repository.ts"
import {
  blogCrosspostJob,
  type BlogCrosspostSetup,
  DEVTO_KEY_MISSING,
  DevtoCrosspostError,
} from "@server/blog/blog-crosspost-job.ts"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * Sharing channels against a real Postgres: the migration that turns Dev.to cross-posts into
 * shares, the Dev.to job's share row, the channel writes and the gap counts. Needs `DB_HOST`,
 * `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing
 * rather than skipping.
 */

const SHARING_MIGRATION = `2026_12_15_0002_blog_sharing_channels.sql`

async function withSchema(
  body: (sql: postgres.Sql) => Promise<void>,
  migrations: readonly string[] = migrationNames(),
): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `sharing_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql, migrations)
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

function post(slug: string, extra: Partial<BlogPostFields> = {}): BlogPostFields {
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

function channel(name: string, extra: Partial<BlogChannelFields> = {}): BlogChannelFields {
  return {
    name,
    kind: `other`,
    address: `https://example.com/${name}`,
    utmSource: name,
    addUtm: true,
    languages: [`en`, `de`],
    startsAt: null,
    ...extra,
  }
}

/** A live post, published now, or at `at` when given. */
async function livePost(
  sql: postgres.Sql,
  actor: SharingActor,
  fields: BlogPostFields,
  at?: string,
): Promise<string> {
  const blog = new PostgresBlogRepository(sql)
  const id = uuidV7()
  await blog.create(id, fields, actor)
  await blog.publish(id, 1, null, null, actor)
  if (at) await sql`UPDATE blog_posts SET published_at = ${at} WHERE id = ${id}`
  return id
}

const shareOf = async (sql: postgres.Sql, postId: string) =>
  await sql<{ status: string; url: string | null; automatic: boolean; error: string | null }[]>`
    SELECT status, url, automatic, error FROM blog_post_shares WHERE post_id = ${postId}
  `

const crosspostEvent = (id: string) =>
  ({ id: uuidV7(), aggregateId: id, eventKind: BLOG_CROSSPOST_JOB }) as OutboxEvent

function devto(create: BlogCrosspostSetup[`client`][`create`]): BlogCrosspostSetup {
  return {
    siteUrl: `https://www.example.com`,
    client: {
      find: () => Promise.resolve({ success: true as const, output: null, error: `` as const }),
      create,
    },
  }
}

Deno.test(`sharing: the migration turns Dev.to cross-posts into one channel and posted shares, and adds nothing when run again`, async () => {
  const names = migrationNames()
  const at = names.indexOf(SHARING_MIGRATION)
  expect(at).toBeGreaterThan(0)
  await withSchema(async (sql) => {
    for (const [slug, url] of [[`crossed`, `https://dev.to/a/1`], [`plain`, null]] as const) {
      await sql`
        INSERT INTO blog_posts (
          id, slug, title, description, status, publish_at, published_at, language,
          crossposted_at, devto_url
        ) VALUES (
          ${uuidV7()}, ${slug}, ${slug}, 'About.', 'published', now(), now(), 'en', now(), ${url}
        )
      `
    }
    await applyMigrations(sql, names.slice(at))
    await applyMigrations(sql, [SHARING_MIGRATION])

    const channels = await sql`SELECT kind, utm_source, languages FROM blog_channels`
    expect(channels).toEqual([{ kind: `devto`, utmSource: `devto`, languages: [`en`] }])
    const shares = await sql`
      SELECT post.slug, share.status, share.url, share.automatic
      FROM blog_post_shares share JOIN blog_posts post ON post.id = share.post_id
    `
    expect(shares).toEqual([
      { slug: `crossed`, status: `posted`, url: `https://dev.to/a/1`, automatic: true },
    ])
    const [{ devtoUrl }] = await sql`SELECT devto_url FROM blog_posts WHERE slug = 'crossed'`
    expect(devtoUrl).toBe(`https://dev.to/a/1`)
  }, names.slice(0, at))
})

Deno.test(`sharing: the migration makes no channel when nothing was cross-posted`, async () => {
  await withSchema(async (sql) => {
    expect(await sql`SELECT id FROM blog_channels`).toEqual([])
  })
})

Deno.test(`sharing: the Dev.to job writes the post's share row: posted, failed, or waiting for its key, never over a skip`, async (t) => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const sharing = new PostgresSharingRepository(sql)
    await sharing.createChannel(uuidV7(), channel(`devto`, { kind: `devto` }), maya)

    await t.step(
      `a cross-post records a posted, automatic row with the article's address`,
      async () => {
        const id = await livePost(sql, maya, post(`posted`))
        const setup = devto(() =>
          Promise.resolve({
            success: true as const,
            output: { id: 1, url: `https://dev.to/seed/posted` },
            error: `` as const,
          })
        )
        await blogCrosspostJob({ sql, setup, log: () => {} })(crosspostEvent(id))
        expect(await shareOf(sql, id)).toEqual([
          { status: `posted`, url: `https://dev.to/seed/posted`, automatic: true, error: null },
        ])
      },
    )

    await t.step(
      `a Dev.to error keeps the row to do and says why, while the job still fails`,
      async () => {
        const id = await livePost(sql, maya, post(`failed`))
        const setup = devto(() =>
          Promise.resolve({ success: false as const, output: null, error: `Dev.to answered 503` })
        )
        await expect(blogCrosspostJob({ sql, setup, log: () => {} })(crosspostEvent(id)))
          .rejects.toThrow(DevtoCrosspostError)
        expect(await shareOf(sql, id)).toEqual([
          { status: `todo`, url: null, automatic: true, error: `Dev.to answered 503` },
        ])
      },
    )

    await t.step(`without the key, the row waits for it; a translation gets none`, async () => {
      const id = await livePost(sql, maya, post(`no-key`))
      const german = await livePost(
        sql,
        maya,
        post(`kein-key`, { language: `de`, translationOf: id }),
      )
      for (const each of [id, german]) {
        await blogCrosspostJob({ sql, setup: null, log: () => {} })(crosspostEvent(each))
      }
      expect(await shareOf(sql, id)).toEqual([
        { status: `todo`, url: null, automatic: true, error: DEVTO_KEY_MISSING },
      ])
      expect(await shareOf(sql, german)).toEqual([])
    })

    await t.step(`a later error leaves a row the operator skipped as it was`, async () => {
      const id = await livePost(sql, maya, post(`skipped`))
      const [{ id: channelId }] = await sql`SELECT id FROM blog_channels WHERE kind = 'devto'`
      await sql`
        INSERT INTO blog_post_shares (id, post_id, channel_id, status, skip_reason)
        VALUES (${uuidV7()}, ${id}, ${channelId}, 'skipped', 'Not for Dev.to')
      `
      await blogCrosspostJob({ sql, setup: null, log: () => {} })(crosspostEvent(id))
      expect(await shareOf(sql, id)).toEqual([
        { status: `skipped`, url: null, automatic: false, error: null },
      ])
    })
  })
})

Deno.test(`sharing: channel writes check names, source tags and versions, and a used channel is only archived`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const sharing = new PostgresSharingRepository(sql)
    const id = uuidV7()
    const made = await sharing.createChannel(id, channel(`reddit`), maya)
    expect(await sharing.createChannel(id, channel(`reddit`), maya)).toEqual(made)

    const refusal = async (promise: Promise<unknown>) => {
      try {
        await promise
      } catch (error) {
        if (error instanceof BlogSharingError) return [error.code, error.field]
        throw error
      }
      return null
    }
    expect(
      await refusal(sharing.createChannel(uuidV7(), channel(`REDDIT`, { utmSource: `x` }), maya)),
    )
      .toEqual([`NAME_TAKEN`, `name`])
    expect(
      await refusal(sharing.createChannel(uuidV7(), channel(`hn`, { utmSource: `reddit` }), maya)),
    )
      .toEqual([`UTM_SOURCE_TAKEN`, `utmSource`])
    expect(await refusal(sharing.updateChannel(id, 7, channel(`reddit`), maya)))
      .toEqual([`VERSION_CONFLICT`, null])

    const postId = await livePost(sql, maya, post(`shared`))
    await sharing.setShares(postId, [id], {
      status: `posted`,
      url: `https://reddit.com/1`,
      skipReason: null,
      sharedAt: null,
      restore: null,
    }, maya)
    expect(await refusal(sharing.deleteChannel(id, 1, maya))).toEqual([`HAS_SHARES`, null])
    const archived = await sharing.archiveChannel(id, 1, true, maya)
    expect(archived.archivedAt).not.toBeNull()

    const unused = await sharing.createChannel(uuidV7(), channel(`unused`), maya)
    await sharing.deleteChannel(unused.id, 1, maya)
    const kinds = await sql<{ eventKind: string }[]>`
      SELECT event_kind FROM audit_events WHERE entity_type = 'blog_channel' ORDER BY id
    `
    expect(kinds.map((row) => row.eventKind)).toEqual([
      `blog.channel_created`,
      `blog.channel_archived`,
      `blog.channel_created`,
      `blog.channel_deleted`,
    ])
  })
})

Deno.test(`sharing: the gaps count old posts, cover translations, respect start dates and drop archived channels`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const sharing = new PostgresSharingRepository(sql)
    const all = await sharing.createChannel(uuidV7(), channel(`all`), maya)
    const later = await sharing.createChannel(
      uuidV7(),
      channel(`later`, { startsAt: `2026-06-01T00:00:00.000Z` }),
      maya,
    )
    const old = await livePost(sql, maya, post(`old`), `2020-01-01T00:00:00.000Z`)
    const recent = await livePost(sql, maya, post(`recent`))
    const german = await livePost(sql, maya, post(`neu`, { language: `de`, translationOf: recent }))

    expect((await sharing.gaps()).toDo).toEqual({ [old]: 1, [recent]: 2, [german]: 2 })

    const none = { url: null, skipReason: null, sharedAt: null, restore: null }
    await sharing.setShares(recent, [all.id], { ...none, status: `posted` }, maya)
    await sharing.setShares(recent, [later.id], { ...none, status: `suggested` }, maya)
    expect((await sharing.gaps()).toDo).toEqual({ [old]: 1 })

    await sharing.setShares(german, [all.id], { ...none, status: `todo` }, maya)
    expect((await sharing.gaps()).toDo).toEqual({ [old]: 1, [german]: 1 })
    await sharing.setShares(german, [all.id], { ...none, status: `none` }, maya)

    await sharing.setShares(old, [all.id], { ...none, status: `skipped`, skipReason: `Old` }, maya)
    expect((await sharing.gaps()).toDo).toEqual({})

    const third = await sharing.createChannel(uuidV7(), channel(`third`), maya)
    expect(Object.keys((await sharing.gaps()).toDo)).toHaveLength(3)
    await sharing.archiveChannel(third.id, 1, true, maya)
    expect(await sharing.gaps()).toEqual({ activeChannels: 2, toDo: {} })
  })
})

Deno.test(`sharing: Undo puts an automatic posted row back with its date, flag and error`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const sharing = new PostgresSharingRepository(sql)
    const devto = await sharing.createChannel(uuidV7(), channel(`devto`, { kind: `devto` }), maya)
    const postId = await livePost(sql, maya, post(`undone`))
    const sharedAt = `2026-11-02T09:30:00.000Z`
    await sql`
      INSERT INTO blog_post_shares
        (id, post_id, channel_id, status, url, shared_at, automatic, error)
      VALUES (
        ${uuidV7()}, ${postId}, ${devto.id}, 'posted', 'https://dev.to/seed/undone', ${sharedAt},
        true, 'Dev.to answered 503 once'
      )
    `
    const none = { url: null, skipReason: null, sharedAt: null, restore: null }
    await sharing.setShares(postId, [devto.id], { ...none, status: `todo` }, maya)
    await sharing.setShares(postId, [devto.id], {
      status: `posted`,
      url: `https://dev.to/seed/undone`,
      skipReason: null,
      sharedAt,
      restore: { automatic: true, error: `Dev.to answered 503 once` },
    }, maya)
    const [row] = await sql`
      SELECT status, url, shared_at, automatic, error FROM blog_post_shares
      WHERE post_id = ${postId}
    `
    expect(row).toEqual({
      status: `posted`,
      url: `https://dev.to/seed/undone`,
      sharedAt: new Date(sharedAt),
      automatic: true,
      error: `Dev.to answered 503 once`,
    })
  })
})

Deno.test(`sharing: numbers typed by hand are kept per share, the latest first`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const sharing = new PostgresSharingRepository(sql)
    const hn = await sharing.createChannel(uuidV7(), channel(`hn`, { kind: `hackernews` }), maya)
    const postId = await livePost(sql, maya, post(`numbers`))
    const counts = { views: null, reactions: null, comments: 4, score: 12 }
    const none = { url: null, skipReason: null, sharedAt: null, restore: null }
    await expect(sharing.enterResults(postId, hn.id, counts, maya)).rejects.toThrow(
      BlogSharingError,
    )
    await sharing.setShares(postId, [hn.id], { ...none, status: `posted` }, maya)
    await sharing.enterResults(postId, hn.id, counts, maya)
    await sharing.enterResults(postId, hn.id, { ...counts, score: 30 }, maya)
    const read = await sharing.postSharing(postId)
    const share = read!.own.get(hn.id)!
    expect(read!.results.get(share.id)).toMatchObject({ source: `hand`, score: 30, comments: 4 })
  })
})
