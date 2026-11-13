/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { BLOG_SHARE_RESULTS_JOB, type BlogChannelKind, type BlogPostFields } from "@domain/blog"
import { PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import { PostgresSharingRepository } from "@server/blog/postgres-sharing-repository.ts"
import {
  blogShareResultsJob,
  type ShareRead,
  type ShareResultsSetup,
  sharesToRead,
} from "@server/blog/blog-share-results-job.ts"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * The sharing results job against a real Postgres: which copies it picks, and what it stores for a
 * good read, a failed one and a kind it has no reader for. The readers are fakes; nothing leaves
 * the machine. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it
 * fails when they are missing rather than skipping.
 */

const DAY = 86_400_000
const NOW = new Date(`2026-11-06T10:17:00.000Z`)
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `share_results_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql, migrationNames())
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A live English post. */
async function livePost(sql: postgres.Sql, slug: string): Promise<string> {
  const [{ id: userId }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, 'Maya', 'Chen', 3 FROM auth_user RETURNING id
  `
  const actor = { userId, requestId: `req-${slug}` }
  const fields: BlogPostFields = {
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
  }
  const blog = new PostgresBlogRepository(sql)
  const id = uuidV7()
  await blog.create(id, fields, actor)
  await blog.publish(id, 1, null, null, actor)
  return id
}

async function channel(
  sql: postgres.Sql,
  kind: BlogChannelKind,
  name: string,
  extra: { address?: string; archived?: boolean } = {},
): Promise<string> {
  const id = uuidV7()
  await sql`
    INSERT INTO blog_channels (id, name, kind, address, utm_source, languages, archived_at)
    VALUES (
      ${id}, ${name}, ${kind}, ${extra.address ?? `news.ycombinator.com`}, ${name}, ${[`en`]},
      ${extra.archived ? NOW.toISOString() : null}
    )
  `
  return id
}

async function share(
  sql: postgres.Sql,
  postId: string,
  channelId: string,
  fields: { status?: string; url?: string | null; sharedAt?: string } = {},
): Promise<string> {
  const id = uuidV7()
  const status = fields.status ?? `posted`
  await sql`
    INSERT INTO blog_post_shares (id, post_id, channel_id, status, url, shared_at)
    VALUES (
      ${id}, ${postId}, ${channelId}, ${status},
      ${fields.url === undefined ? `https://news.ycombinator.com/item?id=1` : fields.url},
      ${status === `posted` ? fields.sharedAt ?? ago(DAY) : null}
    )
  `
  return id
}

const reading = async (sql: postgres.Sql, shareId: string, source: string, at: string) =>
  await sql`
    INSERT INTO blog_share_results (id, share_id, source, read_at, score)
    VALUES (${uuidV7()}, ${shareId}, ${source}, ${at}, 1)
  `

const ok = (output: Partial<ShareRead[`output`]> & object): ShareRead => ({
  success: true,
  output: { views: null, reactions: null, comments: null, score: null, ...output },
  error: ``,
})

const run = (sql: postgres.Sql, setup: ShareResultsSetup, log: (line: string) => void = () => {}) =>
  blogShareResultsJob({ sql, setup, log, now: () => NOW })(
    { id: uuidV7(), eventKind: BLOG_SHARE_RESULTS_JOB } as OutboxEvent,
  )

Deno.test(`share results: the job picks posted copies with a link on active readable channels, shared in the last 90 days and due`, async () => {
  await withSchema(async (sql) => {
    const post = await livePost(sql, `picked`)
    const other = await livePost(sql, `other`)
    const hn = await channel(sql, `hackernews`, `hn`)
    const reddit = await channel(sql, `reddit`, `reddit`)
    const linkedin = await channel(sql, `linkedin`, `linkedin`, { address: `https://example.com` })
    const archived = await channel(sql, `hackernews`, `hn-old`, { archived: true })

    const fresh = await share(sql, post, hn)
    const handRead = await share(sql, post, reddit, { url: `https://redd.it/abc` })
    await reading(sql, handRead, `hand`, ago(60_000))
    const jobReadToday = await share(sql, other, hn)
    await reading(sql, jobReadToday, `job`, ago(2 * 3_600_000))
    const failedToday = await share(sql, other, reddit, { url: `https://redd.it/abd` })
    await sql`
      UPDATE blog_post_shares SET read_error = 'refused', read_failed_at = ${ago(3_600_000 * 3)}
      WHERE id = ${failedToday}
    `
    await share(sql, post, linkedin, { url: `https://www.linkedin.com/posts/x` })
    await share(sql, post, archived)
    const oldPost = await livePost(sql, `old`)
    await share(sql, oldPost, hn, { sharedAt: ago(91 * DAY) })
    const todoPost = await livePost(sql, `todo`)
    await share(sql, todoPost, hn, { status: `todo`, url: null })
    const noLink = await livePost(sql, `no-link`)
    await share(sql, noLink, hn, { url: null })

    const picked = await sharesToRead(sql, NOW)
    expect(picked.map((row) => row.id).sort()).toEqual([fresh, handRead].sort())
    expect(picked.find((row) => row.id === fresh)).toMatchObject({
      kind: `hackernews`,
      url: `https://news.ycombinator.com/item?id=1`,
      slug: `picked`,
      language: `en`,
      lastReadAt: null,
    })
  })
})

Deno.test(`share results: a good read stores a job row with unknown numbers left null and clears an old failure`, async () => {
  await withSchema(async (sql) => {
    const post = await livePost(sql, `good`)
    const id = await share(sql, post, await channel(sql, `hackernews`, `hn`))
    await sql`
      UPDATE blog_post_shares SET read_error = 'old', read_failed_at = ${ago(2 * DAY)}
      WHERE id = ${id}
    `
    const asked: unknown[] = []
    await run(sql, {
      siteUrl: null,
      missing: {},
      readers: {
        hackernews: (target) => {
          asked.push(target)
          return Promise.resolve(ok({ score: 42, comments: 7 }))
        },
      },
    })
    expect(asked).toEqual([{ kind: `hackernews`, id: 1 }])
    const rows = await sql`
      SELECT source, views, reactions, comments, score FROM blog_share_results WHERE share_id = ${id}
    `
    expect(rows).toEqual([
      { source: `job`, views: null, reactions: null, comments: 7, score: 42 },
    ])
    const [row] =
      await sql`SELECT read_error, read_failed_at FROM blog_post_shares WHERE id = ${id}`
    expect(row).toEqual({ readError: null, readFailedAt: null })
    expect(await sharesToRead(sql, NOW)).toEqual([])
  })
})

Deno.test(`share results: a failed or crashing read is stored on its copy, waits a day, and the other copies are still read`, async () => {
  await withSchema(async (sql) => {
    const post = await livePost(sql, `mixed`)
    // Read first, so a crash that escaped the job would stop the copies after it.
    const crashed = await share(sql, post, await channel(sql, `bluesky`, `bluesky`), {
      url: `https://bsky.app/profile/did:plc:abc123/post/3kxyz`,
    })
    const refused = await share(sql, post, await channel(sql, `reddit`, `reddit`), {
      url: `https://redd.it/abc`,
    })
    const broken = await share(sql, post, await channel(sql, `hackernews`, `hn`), {
      url: `https://news.ycombinator.com/user?id=1`,
    })
    const read = await share(
      sql,
      post,
      await channel(sql, `mastodon`, `mastodon`, { address: `@seed@mastodon.social` }),
      { url: `https://mastodon.social/@seed/1134` },
    )
    const lines: string[] = []
    await run(sql, {
      siteUrl: null,
      missing: {},
      readers: {
        reddit: () =>
          Promise.resolve({ success: false, output: null, error: `reddit answered 403` }),
        hackernews: () => Promise.reject(new Error(`must not be asked`)),
        bluesky: () => Promise.reject(new Error(`socket hang up`)),
        mastodon: () => Promise.resolve(ok({ reactions: 3, comments: 1 })),
      },
    }, (line) => lines.push(line))

    const failures = await sql<{ id: string; readError: string | null }[]>`
      SELECT id, read_error FROM blog_post_shares WHERE read_failed_at IS NOT NULL ORDER BY id
    `
    expect(failures).toEqual(
      [
        { id: crashed, readError: `the reader failed: Error: socket hang up` },
        { id: refused, readError: `reddit answered 403` },
        { id: broken, readError: expect.stringContaining(`Hacker News item`) },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
    const results = await sql`SELECT share_id, reactions FROM blog_share_results`
    expect(results).toEqual([{ shareId: read, reactions: 3 }])
    expect(lines).toHaveLength(3)
    // A refusal is not asked again an hour later.
    const later = new Date(NOW.getTime() + 3_600_000)
    expect(await sharesToRead(sql, later)).toEqual([])
  })
})

Deno.test(`share results: a copy whose channel has no such post, or reports no number, is a failure, not a row`, async () => {
  await withSchema(async (sql) => {
    const post = await livePost(sql, `gone`)
    const hn = await channel(sql, `hackernews`, `hn`)
    const gone = await share(sql, post, hn)
    const empty = await share(sql, await livePost(sql, `empty`), hn)
    await run(sql, {
      siteUrl: null,
      missing: {},
      readers: {
        hackernews: () => Promise.resolve({ success: true, output: null, error: `` }),
      },
    })
    await sql`UPDATE blog_post_shares SET read_error = NULL, read_failed_at = NULL WHERE id = ${empty}`
    await run(sql, {
      siteUrl: null,
      missing: {},
      readers: { hackernews: () => Promise.resolve(ok({})) },
    })
    const rows = await sql<{ id: string; readError: string }[]>`
      SELECT id, read_error FROM blog_post_shares ORDER BY id
    `
    expect(rows).toEqual(
      [
        { id: gone, readError: expect.stringContaining(`no such post`) },
        { id: empty, readError: expect.stringContaining(`no numbers`) },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(await sql`SELECT 1 FROM blog_share_results`).toHaveLength(0)
  })
})

Deno.test(`share results: a kind with no reader is skipped with one log line and nothing stored`, async () => {
  await withSchema(async (sql) => {
    const devto = await channel(sql, `devto`, `devto`, { address: `https://dev.to/seed` })
    await share(sql, await livePost(sql, `one`), devto, { url: `https://dev.to/seed/one` })
    await share(sql, await livePost(sql, `two`), devto, { url: `https://dev.to/seed/two` })
    const lines: string[] = []
    await run(sql, {
      siteUrl: null,
      missing: { devto: `DEVTO_API_KEY is unset` },
      readers: {},
    }, (line) => lines.push(line))
    expect(lines).toEqual([`blog share results: devto skipped: DEVTO_API_KEY is unset`])
    expect(await sql`SELECT 1 FROM blog_post_shares WHERE read_failed_at IS NOT NULL`).toHaveLength(
      0,
    )
    expect(await sql`SELECT 1 FROM blog_share_results`).toHaveLength(0)
  })
})

Deno.test(`share results: Dev.to is read by the post's canonical address on the website`, async () => {
  await withSchema(async (sql) => {
    const devto = await channel(sql, `devto`, `devto`, { address: `https://dev.to/seed` })
    const id = await share(sql, await livePost(sql, `canon`), devto, {
      url: `https://dev.to/seed/canon-1a2b`,
    })
    const asked: string[] = []
    await run(sql, {
      siteUrl: `https://www.example.com`,
      missing: {},
      readers: {
        devto: (canonical) => {
          asked.push(canonical)
          return Promise.resolve(ok({ views: 120, reactions: 9, comments: 2 }))
        },
      },
    })
    expect(asked).toEqual([`https://www.example.com/blog/canon`])
    expect(await sql`SELECT views FROM blog_share_results WHERE share_id = ${id}`).toEqual([
      { views: 120 },
    ])
  })
})

Deno.test(`share results: a new link from the operator drops the old link's failure, and the same link keeps it`, async () => {
  await withSchema(async (sql) => {
    const post = await livePost(sql, `relink`)
    const hn = await channel(sql, `hackernews`, `hn`)
    const id = await share(sql, post, hn, { url: `https://news.ycombinator.com/user?id=1` })
    await run(sql, { siteUrl: null, missing: {}, readers: { hackernews: () => Promise.reject() } })
    const failed = async () =>
      (await sql`SELECT read_error FROM blog_post_shares WHERE id = ${id}`)[0].readError
    expect(await failed()).toContain(`Hacker News item`)

    const [{ userId }] = await sql<{ userId: number }[]>`SELECT id AS user_id FROM users LIMIT 1`
    const repository = new PostgresSharingRepository(sql)
    const change = (url: string) => ({
      status: `posted` as const,
      url,
      skipReason: null,
      sharedAt: null,
      restore: null,
    })
    const actor = { userId, requestId: `req-relink` }
    await repository.setShares(post, [hn], change(`https://news.ycombinator.com/user?id=1`), actor)
    expect(await failed()).toContain(`Hacker News item`)
    await repository.setShares(post, [hn], change(`https://news.ycombinator.com/item?id=2`), actor)
    expect(await failed()).toBeNull()
  })
})
