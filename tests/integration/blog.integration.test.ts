/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { OutboxEvent } from "@spy4x/server/outbox"
import {
  BLOG_AUDIT_KINDS,
  BLOG_CROSSPOST_JOB,
  BLOG_INDEXNOW_JOB,
  BLOG_PUBLISH_JOB,
  BlogError,
  type BlogPostFields,
  BlogVersionConflictError,
  parseBlogPostEdit,
  parseBlogPostFields,
} from "@domain/blog"
import { type BlogActor, PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import {
  BlogPostNotLiveError,
  blogPublishJob,
  queueDueBlogJobs,
} from "@server/blog/blog-publish-job.ts"
import { blogIndexNowJob, type IndexNowSetup } from "@server/blog/blog-indexnow-job.ts"
import {
  createPublicFeed,
  listPublicFeed,
  listPublicPosts,
  listPublicTopics,
  readMovedPost,
  readPublicPost,
} from "@server/blog/public-blog.ts"
import {
  loadDemoBlogPosts,
  readSeedPosts,
  type SeedPost,
  upsertSeedPosts,
} from "@server/blog/seed-posts.ts"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { SUBSCRIBER_SEND_ISSUE_JOB } from "@server/jobs/subscriber-mail.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import {
  blogCrosspostJob,
  type BlogCrosspostSetup,
  type DevtoArticle,
  DevtoCrosspostError,
} from "@server/blog/blog-crosspost-job.ts"
import { cancelJob, runJobNow } from "@server/jobs/admin-jobs.ts"
import { AdminJobActionOutcome, type Language } from "@domain/identity"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { blogBodyLength } from "@server/blog/render.ts"
import { createAdminBlog } from "../../apps/api/routes/admin/blog.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * The blog (#395) against a real Postgres with every migration applied: the admin writes and
 * their audit rows, version and slug checks, two operators at once, the public reads that never
 * show a draft or a scheduled post, and the `blog.publish` job that publishes at the time and
 * queues the newsletter issue once ever.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const SETUP: SubscribersSetup = {
  secret: `integration-blog-secret-0123456789abcdef`,
  previousSecrets: [],
  siteUrl: `https://www.example.com`,
}
const BRAND = { webAppUrl: `https://app.example.com` }

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `blog_test_${uuidV7().replaceAll(`-`, ``)}`
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

/** A new operator named `name`, as the actor of the writes. */
async function operator(sql: postgres.Sql, name = `Maya Chen`): Promise<BlogActor> {
  const [first, last] = name.split(` `)
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, ${first}, ${last}, 3 FROM auth_user RETURNING id
  `
  return { userId: id, requestId: `req-${id}` }
}

function fields(slug: string, extra: Partial<BlogPostFields> = {}): BlogPostFields {
  return {
    title: `Post ${slug}`,
    slug,
    description: `About ${slug}.`,
    seoTitle: null,
    tldr: [`First point`, `Second point`],
    topic: `Product`,
    coverUrl: null,
    coverAlt: null,
    authorUrl: null,
    intro: null,
    relatedFeature: null,
    bodyMd: `Hello <b>there</b>.`,
    language: `en`,
    translationOf: null,
    ...extra,
  }
}

/** The job's event for post `id`, as the processor hands it to the handler. */
function jobEvent(id: string): OutboxEvent {
  return { id: uuidV7(), aggregateId: id, eventKind: BLOG_PUBLISH_JOB } as OutboxEvent
}

/**
 * The public website as the publish job asks it: a live post's page answers 200 with its title,
 * any other address 404, as the MPA does.
 */
function liveSite(sql: postgres.Sql): typeof fetch {
  return async (input) => {
    const slug = new URL(String(input)).pathname.split(`/`).pop()
    const [post] = await sql<{ title: string }[]>`
      SELECT title FROM blog_posts WHERE slug = ${slug ?? ``} AND status = 'published'
    `
    return post
      ? new Response(`<h1>${post.title}</h1>`, { status: 200 })
      : new Response(`Not found`, { status: 404 })
  }
}

/** The worker's processor, with the newsletter set up, `sender` sending its mail. */
function processorFor(
  sql: postgres.Sql,
  sender: EmailSender | null = null,
  crosspost: BlogCrosspostSetup | null = null,
) {
  return createOutboxProcessor(
    sql,
    { store: createPostgresAuthStore(sql), sender, brand: BRAND, log: () => {} },
    null,
    SETUP,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    crosspost,
    liveSite(sql),
  )
}

/** Runs every due outbox row once, as the worker does, with the newsletter set up. */
async function drain(sql: postgres.Sql): Promise<void> {
  await processorFor(sql).drainOnce()
}

/** The `blog.publish` rows of post `id` that still wait: their ids and due times. */
async function waitingJobs(
  sql: postgres.Sql,
  id: string,
): Promise<{ id: string; availableAt: Date; cancelledAt: Date | null }[]> {
  return await sql`
    SELECT id, available_at, cancelled_at FROM outbox_events
    WHERE event_kind = ${BLOG_PUBLISH_JOB} AND aggregate_id = ${id} AND processed_at IS NULL
  `
}

/** The audit kinds written about post `id`, oldest first. */
async function auditKinds(sql: postgres.Sql, id: string): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events WHERE entity_id = ${id} ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

/** The issue rows queued for post `id`, and the send jobs waiting. */
async function issues(sql: postgres.Sql, id: string): Promise<{ rows: number; jobs: number }> {
  const [{ rows }] = await sql<{ rows: number }[]>`
    SELECT COUNT(*)::int AS rows FROM subscriber_issue_content WHERE issue_id = ${id}
  `
  const [{ jobs }] = await sql<{ jobs: number }[]>`
    SELECT COUNT(*)::int AS jobs FROM outbox_events WHERE event_kind = ${SUBSCRIBER_SEND_ISSUE_JOB}
  `
  return { rows, jobs }
}

/** Moves the post's publish time into the past, as the clock reaching it would. */
async function makeDue(sql: postgres.Sql, id: string): Promise<void> {
  await sql`UPDATE blog_posts SET publish_at = now() - interval '1 second' WHERE id = ${id}`
  await sql`UPDATE outbox_events SET available_at = now() - interval '1 second'
    WHERE aggregate_id = ${id} AND processed_at IS NULL`
}

async function rejection(promise: Promise<unknown>): Promise<BlogError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof BlogError) return error
    throw error
  }
  throw new Error(`expected a refusal`)
}

const LATER = () => new Date(Date.now() + 3_600_000)
const DAY_MS = 86_400_000

/** A post file as `readSeedPosts` answers it: published a day ago, not mailed. */
function seedPost(slug: string, extra: Partial<SeedPost> = {}): SeedPost {
  return {
    file: `${slug}.md`,
    fields: fields(slug),
    translationOf: null,
    author: `Anton Shubin`,
    publishAt: new Date(Date.now() - DAY_MS),
    newsletter: false,
    devto: false,
    coverFile: null,
    ...extra,
  }
}

/** The stored post with `slug`. */
async function bySlug(sql: postgres.Sql, slug: string) {
  const [row] = await sql<
    {
      id: string
      title: string
      status: string
      publishedAt: Date | null
      translationOf: string | null
      authorName: string | null
      authorUrl: string | null
      newsletterList: string | null
      newsletterSentAt: Date | null
      version: number
      updatedAt: Date
    }[]
  >`
    SELECT id, title, status, published_at, translation_of, author_name, author_url,
      newsletter_list, newsletter_sent_at, version, updated_at
    FROM blog_posts WHERE slug = ${slug}
  `
  return row
}

Deno.test(`blog: writes, audit rows and the checks every write makes`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()

    await t.step(`creates a draft by the operator, with their name, and audits it`, async () => {
      const post = await blog.create(id, fields(`hello-world`), maya)
      expect(post).toMatchObject({
        status: `draft`,
        version: 1,
        authorId: maya.userId,
        authorName: `Maya Chen`,
        tldr: [`First point`, `Second point`],
      })
      expect(await auditKinds(sql, id)).toEqual([BLOG_AUDIT_KINDS.created])
    })

    await t.step(
      `answers a retried create with the first post and writes nothing more`,
      async () => {
        const again = await blog.create(id, fields(`hello-world`), maya)
        expect(again.version).toBe(1)
        expect(await auditKinds(sql, id)).toEqual([BLOG_AUDIT_KINDS.created])
        const other = await operator(sql, `Lee Park`)
        expect((await rejection(blog.create(id, fields(`hello-world`), other))).code).toBe(
          `ID_ALREADY_EXISTS`,
        )
      },
    )

    await t.step(`refuses a second post with the same slug, naming the field`, async () => {
      const taken = await rejection(blog.create(uuidV7(), fields(`hello-world`), maya))
      expect([taken.code, taken.field]).toEqual([`SLUG_TAKEN`, `slug`])
    })

    await t.step(`refuses a save that names an old version, with the current one`, async () => {
      await blog.update(id, 1, fields(`hello-world`, { title: `Renamed` }), false, maya)
      const stale = await rejection(blog.update(id, 1, fields(`hello-world`), false, maya))
      expect(stale).toBeInstanceOf(BlogVersionConflictError)
      expect((stale as BlogVersionConflictError).currentVersion).toBe(2)
    })

    await t.step(`locks the slug once published; Change URL still changes it`, async () => {
      await blog.publish(id, 2, null, null, maya)
      const locked = await rejection(blog.update(id, 3, fields(`new-address`), false, maya))
      expect(locked.code).toBe(`SLUG_LOCKED`)
      const moved = await blog.changeUrl(id, 3, `new-address`, maya)
      expect(moved.slug).toBe(`new-address`)
    })

    await t.step(`moves the Updated date only for a significant update`, async () => {
      const plain = await blog.update(id, 4, fields(`new-address`), false, maya)
      expect(plain.contentUpdatedAt).toBeNull()
      const significant = await blog.update(id, 5, fields(`new-address`), true, maya)
      expect(significant.contentUpdatedAt).not.toBeNull()
    })

    await t.step(
      `keeps the first publish date after unpublishing and publishing again`,
      async () => {
        const first = (await blog.get(id))!.publishedAt
        await blog.unpublish(id, 6, maya)
        const again = await blog.publish(id, 7, null, null, maya)
        expect(again.publishedAt).toBe(first)
      },
    )

    await t.step(`deletes the post for good, whatever its status`, async () => {
      await blog.delete(id, 8, maya)
      expect(await blog.get(id)).toBeNull()
      expect((await rejection(blog.delete(id, 9, maya))).code).toBe(`POST_NOT_FOUND`)
    })

    await t.step(`writes one audit row per action, each on the operator`, async () => {
      expect(await auditKinds(sql, id)).toEqual([
        BLOG_AUDIT_KINDS.created,
        BLOG_AUDIT_KINDS.updated,
        BLOG_AUDIT_KINDS.published,
        BLOG_AUDIT_KINDS.urlChanged,
        BLOG_AUDIT_KINDS.updated,
        BLOG_AUDIT_KINDS.updated,
        BLOG_AUDIT_KINDS.unpublished,
        BLOG_AUDIT_KINDS.published,
        BLOG_AUDIT_KINDS.deleted,
      ])
      const actors = await sql<{ actorUserId: number; requestId: string }[]>`
        SELECT DISTINCT actor_user_id, request_id FROM audit_events WHERE entity_id = ${id}
      `
      expect(actors).toEqual([{ actorUserId: maya.userId, requestId: maya.requestId }])
    })
  })
})

Deno.test(`blog: every save keeps the post's fields as an earlier version, the newest 50 (#418)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const lee = await operator(sql, `Lee Park`)
    const id = uuidV7()
    const first = fields(`hello`, { bodyMd: `The good paragraph.`, tldr: [`One`] })
    await blog.create(id, first, maya)

    await t.step(`keeps the created fields, with who saved them`, async () => {
      const list = await blog.revisions(id)
      expect(list?.map((row) => [row.title, row.savedBy])).toEqual([[`Post hello`, `Maya Chen`]])
      expect(await blog.revision(id, list![0].id)).toMatchObject({
        ...first,
        savedBy: `Maya Chen`,
      })
    })

    await t.step(`keeps each save, newest first, and the earlier text stays readable`, async () => {
      await blog.update(
        id,
        1,
        fields(`hello`, { title: `Worse`, bodyMd: `Saved over.` }),
        false,
        lee,
      )
      const list = await blog.revisions(id)
      expect(list?.map((row) => [row.title, row.savedBy])).toEqual([
        [`Worse`, `Lee Park`],
        [`Post hello`, `Maya Chen`],
      ])
      expect((await blog.revision(id, list![1].id))?.bodyMd).toBe(`The good paragraph.`)
    })

    await t.step(`keeps nothing for a save that changed no field`, async () => {
      await blog.update(
        id,
        2,
        fields(`hello`, { title: `Worse`, bodyMd: `Saved over.` }),
        false,
        maya,
      )
      expect((await blog.revisions(id))?.length).toBe(2)
    })

    await t.step(`keeps the newest 50 and deletes the older ones in the same save`, async () => {
      for (let version = 3; version <= 52; version++) {
        await blog.update(id, version, fields(`hello`, { bodyMd: `Save ${version}.` }), false, maya)
      }
      const list = await blog.revisions(id)
      expect(list?.length).toBe(50)
      // 52 versions were kept: the create's and Lee's are gone, the oldest left is the next save's.
      expect((await blog.revision(id, list!.at(-1)!.id))?.bodyMd).toBe(`Save 3.`)
      expect((await blog.revision(id, list![0].id))?.bodyMd).toBe(`Save 52.`)
    })

    await t.step(
      `answers no version of another post, and no list for a post that is gone`,
      async () => {
        const other = uuidV7()
        await blog.create(other, fields(`other`), maya)
        const [mine] = (await blog.revisions(id))!
        expect(await blog.revision(other, mine.id)).toBeNull()
        expect(await blog.revisions(uuidV7())).toBeNull()
      },
    )

    await t.step(`names an operator without a name by their address`, async () => {
      const [{ id: nameless }] = await sql<{ id: number }[]>`
        WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
        INSERT INTO users (id, role) SELECT id, 3 FROM auth_user RETURNING id
      `
      await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ops@example.com', ${nameless})`
      const post = uuidV7()
      await blog.create(post, fields(`nameless`), { userId: nameless, requestId: null })
      expect((await blog.revisions(post))?.[0].savedBy).toBe(`ops@example.com`)
    })

    await t.step(`deletes a post's versions with it`, async () => {
      const post = await blog.get(id)
      await blog.delete(id, post!.version, maya)
      const [{ rows }] = await sql<{ rows: number }[]>`
        SELECT COUNT(*)::int AS rows FROM blog_post_revisions WHERE post_id = ${id}
      `
      expect(rows).toBe(0)
    })

    await t.step(`keeps no version of Seed's own posts from files`, async () => {
      await upsertSeedPosts(sql, [seedPost(`from-a-file`)])
      // The file changed: the next start writes the post again.
      const edited = fields(`from-a-file`, { title: `Edited in the file` })
      expect(await upsertSeedPosts(sql, [seedPost(`from-a-file`, { fields: edited })])).toBe(1)
      const post = await bySlug(sql, `from-a-file`)
      expect(post.title).toBe(`Edited in the file`)
      expect(await blog.revisions(post.id)).toEqual([])
    })
  })
})

Deno.test(`blog: two operators publishing at once publish once`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const [maya, lee] = [await operator(sql), await operator(sql, `Lee Park`)]
    const id = uuidV7()
    await blog.create(id, fields(`race`), maya)

    const results = await Promise.allSettled([
      blog.publish(id, 1, null, `news`, maya),
      blog.publish(id, 1, null, `news`, lee),
    ])

    expect(results.map((result) => result.status).sort()).toEqual([`fulfilled`, `rejected`])
    const refused = results.find((result) => result.status === `rejected`)!
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(BlogVersionConflictError)
    const [{ jobs }] = await sql<{ jobs: number }[]>`
      SELECT COUNT(*)::int AS jobs FROM outbox_events WHERE event_kind = ${BLOG_PUBLISH_JOB}
    `
    expect(jobs).toBe(1)
  })
})

Deno.test(`blog: the public reads show live posts only`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [live, draft, scheduled, unpublished] = [uuidV7(), uuidV7(), uuidV7(), uuidV7()]
    await blog.create(live, fields(`live`, { topic: `Engineering` }), maya)
    await blog.publish(live, 1, null, null, maya)
    await blog.create(draft, fields(`draft`), maya)
    await blog.create(scheduled, fields(`scheduled`), maya)
    await blog.publish(scheduled, 1, LATER(), null, maya)
    await blog.create(unpublished, fields(`unpublished`), maya)
    await blog.publish(unpublished, 1, null, null, maya)
    await blog.unpublish(unpublished, 2, maya)

    expect((await listPublicPosts(sql, null)).map((post) => post.slug)).toEqual([`live`])
    expect(await listPublicPosts(sql, `Product`)).toEqual([])
    expect(await listPublicTopics(sql)).toEqual([{ topic: `Engineering`, count: 1 }])
    expect((await listPublicFeed(sql)).map((post) => post.slug)).toEqual([`live`])
    for (const slug of [`draft`, `scheduled`, `unpublished`]) {
      expect(await readPublicPost(sql, slug)).toBeNull()
    }
    const found = await readPublicPost(sql, `live`)
    expect(found?.post).toMatchObject({
      slug: `live`,
      authorName: `Maya Chen`,
      topic: `Engineering`,
    })
    expect(Object.keys(found!.post)).not.toContain(`authorId`)
    expect(Object.keys(found!.post)).not.toContain(`id`)
    expect(JSON.stringify(found!.post.segments)).not.toContain(`<b>`)
    expect(found!.readNext).toEqual([])
  })
})

Deno.test(`blog: a live post's old slugs lead to its current address, and only while it is live (#418)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const post = uuidV7()
    const rows = async () =>
      (await sql<{ slug: string; postId: string }[]>`
        SELECT slug, post_id FROM blog_slug_redirects ORDER BY slug
      `).map(({ slug, postId }) => `${slug} → ${postId === post ? `post` : postId}`)
    await blog.create(post, fields(`first`, { language: `de` }), maya)
    await blog.publish(post, 1, null, null, maya)

    await t.step(`sends every old slug of a chain straight to the current one`, async () => {
      await blog.changeUrl(post, 2, `second`, maya)
      await blog.changeUrl(post, 3, `third`, maya)
      for (const slug of [`first`, `second`]) {
        expect(await readPublicPost(sql, slug)).toBeNull()
        expect(await readMovedPost(sql, slug)).toEqual({ language: `de`, slug: `third` })
      }
      expect(await readMovedPost(sql, `third`)).toBeNull()
      expect(await readMovedPost(sql, `never-was`)).toBeNull()
    })

    await t.step(`lists only the current address in the index and the feed`, async () => {
      expect((await listPublicPosts(sql, null)).map(({ slug }) => slug)).toEqual([`third`])
      expect((await listPublicFeed(sql)).map(({ slug }) => slug)).toEqual([`third`])
    })

    await t.step(`keeps no row for the slug a post moves back to`, async () => {
      await blog.changeUrl(post, 4, `first`, maya)
      expect(await rows()).toEqual([`second → post`, `third → post`])
      expect((await readPublicPost(sql, `first`))?.post.slug).toBe(`first`)
      expect(await readMovedPost(sql, `third`)).toEqual({ language: `de`, slug: `first` })
    })

    await t.step(`gives an old slug to the post that takes it, from its draft on`, async () => {
      const other = uuidV7()
      await blog.create(other, fields(`second`), maya)
      expect(await rows()).toEqual([`third → post`])
      expect(await readMovedPost(sql, `second`)).toBeNull()
      await blog.publish(other, 1, null, null, maya)
      expect((await readPublicPost(sql, `second`))?.post.title).toBe(`Post second`)
    })

    await t.step(`answers nothing for the old slug of a post that is not live`, async () => {
      await blog.unpublish(post, 5, maya)
      expect(await readMovedPost(sql, `third`)).toBeNull()
      await blog.publish(post, 6, null, null, maya)
      expect(await readMovedPost(sql, `third`)).toEqual({ language: `de`, slug: `first` })
    })

    await t.step(`keeps no row for a slug the public never saw`, async () => {
      const draft = uuidV7()
      await blog.create(draft, fields(`draft-a`), maya)
      await blog.update(draft, 1, fields(`draft-b`), false, maya)
      const scheduled = uuidV7()
      await blog.create(scheduled, fields(`later-a`), maya)
      await blog.publish(scheduled, 1, LATER(), null, maya)
      await blog.changeUrl(scheduled, 2, `later-b`, maya)
      expect(await rows()).toEqual([`third → post`])
    })

    await t.step(`deletes a post's old slugs with it`, async () => {
      await blog.delete(post, 7, maya)
      expect(await rows()).toEqual([])
    })
  })
})

Deno.test(`blog: every writer stores the reading minutes the renderer counts, and the reads answer them (#416)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    // Words split by JavaScript's whitespace beyond ASCII (no-break, ideographic, em space), and
    // a zero-width space, which splits no word: 420 words, 2 minutes. A split on plain spaces
    // alone counts 240 words, 1 minute, so this body catches a pattern that drops those spaces.
    const tricky = Array.from(
      { length: 240 },
      (_, i) => [`w\u00a0x`, `w\u3000x`, `w\u2003x`, `w\u200bx`][i % 4],
    ).join(` `)
    const bodies = [``, `one`, tricky, `word `.repeat(344), `word `.repeat(2_000)]
    for (const [i, bodyMd] of bodies.entries()) {
      const id = uuidV7()
      await blog.create(id, fields(`post-${i}`, { bodyMd: `x` }), maya)
      await blog.update(id, 1, fields(`post-${i}`, { bodyMd }), false, maya)
      await blog.publish(id, 2, null, null, maya)
    }
    await upsertSeedPosts(sql, [
      seedPost(`from-file`, { fields: fields(`from-file`, { bodyMd: tricky }) }),
    ])

    const stored = await sql<{ slug: string; bodyMd: string; readingMinutes: number }[]>`
      SELECT slug, body_md, reading_minutes FROM blog_posts
    `
    expect(stored).toHaveLength(bodies.length + 1)
    for (const row of stored) {
      expect({ slug: row.slug, minutes: row.readingMinutes })
        .toEqual({ slug: row.slug, minutes: blogBodyLength(row.bodyMd).readingMinutes })
    }
    const minutes = Object.fromEntries(stored.map((row) => [row.slug, row.readingMinutes]))
    expect(minutes[`post-2`]).toBe(blogBodyLength(tricky).readingMinutes)
    for (const post of await listPublicPosts(sql, null)) {
      expect(post.readingMinutes).toBe(minutes[post.slug])
    }
    expect((await readPublicPost(sql, `post-4`))!.post.readingMinutes).toBe(minutes[`post-4`])
    for (const post of await listPublicFeed(sql)) {
      expect(post.readingMinutes).toBe(minutes[post.slug])
    }
  })
})

Deno.test(`blog: the feed is read and rendered again only when a post in it changed (#416)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const feed = createPublicFeed(sql)
    const first = uuidV7()
    await blog.create(first, fields(`first`), maya)
    await blog.publish(first, 1, null, null, maya)

    const kept = await feed()
    expect(kept.map((post) => post.slug)).toEqual([`first`])
    expect(await feed()).toBe(kept)

    await blog.update(first, 2, fields(`first`, { title: `Retitled` }), false, maya)
    const edited = await feed()
    expect(edited).not.toBe(kept)
    expect(edited[0].title).toBe(`Retitled`)
    expect(await feed()).toBe(edited)

    const second = uuidV7()
    await blog.create(second, fields(`second`), maya)
    expect(await feed()).toBe(edited)
    await blog.publish(second, 1, null, null, maya)
    await sql`UPDATE blog_posts SET published_at = now() + interval '1 second' WHERE id = ${second}`
    expect((await feed()).map((post) => post.slug)).toEqual([`second`, `first`])

    await blog.unpublish(second, 2, maya)
    expect((await feed()).map((post) => post.slug)).toEqual([`first`])
  })
})

Deno.test(`blog: read next puts the same topic first`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    for (const [slug, topic] of [[`a`, `Product`], [`b`, `Engineering`], [`c`, `Product`]]) {
      const id = uuidV7()
      await blog.create(id, fields(slug, { topic }), maya)
      await blog.publish(id, 1, null, null, maya)
    }
    // `b` is the newest of the others, but `c` shares the topic.
    await sql`UPDATE blog_posts SET published_at = now() + interval '1 minute' WHERE slug = 'b'`

    const found = await readPublicPost(sql, `a`)
    expect(found!.readNext.map((post) => post.slug)).toEqual([`c`, `b`])
  })
})

Deno.test(`blog: a post and its live translations name each other, and read next keeps to the language (#527)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [english, german, spanish, other] = [uuidV7(), uuidV7(), uuidV7(), uuidV7()]
    await blog.create(english, fields(`hello`), maya)
    await blog.create(german, fields(`hallo`, { language: `de`, translationOf: english }), maya)
    await blog.create(spanish, fields(`hola`, { language: `es`, translationOf: english }), maya)
    await blog.create(other, fields(`anderes`, { language: `de` }), maya)
    for (const id of [english, german, other]) await blog.publish(id, 1, null, null, maya)

    const original = await readPublicPost(sql, `hello`)
    expect(original!.post.language).toBe(`en`)
    // The Spanish one is a draft, so it is not named.
    expect(original!.post.translations).toEqual([{ language: `de`, slug: `hallo` }])
    expect(original!.readNext).toEqual([])
    const translation = await readPublicPost(sql, `hallo`)
    expect(translation!.post.translations).toEqual([{ language: `en`, slug: `hello` }])
    expect(translation!.readNext.map((post) => post.slug)).toEqual([`anderes`])
    expect((await readPublicPost(sql, `anderes`))!.post.translations).toEqual([])
  })
})

Deno.test(`blog: refuses a translation that does not name a post in another language (#527)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [english, german] = [uuidV7(), uuidV7()]
    await blog.create(english, fields(`hello`), maya)
    await blog.create(german, fields(`hallo`, { language: `de`, translationOf: english }), maya)
    const refused = async (id: string, extra: Partial<BlogPostFields>) => {
      const error = await rejection(blog.create(id, fields(`p-${id}`, extra), maya))
      return [error.code, error.field]
    }
    const refusal = [`TRANSLATION_INVALID`, `translationOf`]

    await t.step(`a post that does not exist`, async () => {
      expect(await refused(uuidV7(), { language: `es`, translationOf: uuidV7() })).toEqual(refusal)
    })
    await t.step(`a post in the same language`, async () => {
      expect(await refused(uuidV7(), { translationOf: english })).toEqual(refusal)
    })
    await t.step(`a post that is itself a translation`, async () => {
      expect(await refused(uuidV7(), { language: `es`, translationOf: german })).toEqual(refusal)
    })
    await t.step(`a second translation into a language the post has`, async () => {
      expect(await refused(uuidV7(), { language: `de`, translationOf: english })).toEqual(refusal)
    })
    await t.step(`itself`, async () => {
      const id = uuidV7()
      await blog.create(id, fields(`alone`, { language: `es` }), maya)
      const error = await rejection(
        blog.update(id, 1, fields(`alone`, { language: `ru`, translationOf: id }), false, maya),
      )
      expect([error.code, error.field]).toEqual(refusal)
    })
    await t.step(`a post that others translate`, async () => {
      const ru = uuidV7()
      await blog.create(ru, fields(`privet`, { language: `ru` }), maya)
      const error = await rejection(
        blog.update(english, 1, fields(`hello`, { translationOf: ru }), false, maya),
      )
      expect([error.code, error.field]).toEqual(refusal)
    })
  })
})

Deno.test(`blog: a save that names no language or link keeps the post's (#530)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [english, german] = [uuidV7(), uuidV7()]
    await blog.create(english, fields(`hello`), maya)
    await blog.create(german, fields(`hallo`, { language: `de`, translationOf: english }), maya)

    const edit = parseBlogPostEdit({
      title: `Hallo, neu`,
      slug: `hallo`,
      description: `Neu.`,
      bodyMd: `Hallo.`,
    })
    const saved = await blog.update(german, 1, edit, false, maya)

    expect([saved.title, saved.language, saved.translationOf]).toEqual([
      `Hallo, neu`,
      `de`,
      english,
    ])
  })
})

Deno.test(`blog: a save that makes an original a translation while another save makes it one waits, and is refused (#530)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [english, german, spanish] = [uuidV7(), uuidV7(), uuidV7()]
    await blog.create(english, fields(`hello`), maya)
    await blog.create(german, fields(`hallo`, { language: `de` }), maya)
    await blog.create(spanish, fields(`hola`, { language: `es` }), maya)

    // Another operator's save, half done: the German post now translates the Spanish one.
    let release!: () => void
    const held = new Promise<void>((resolve) => release = resolve)
    let changed!: () => void
    const isChanged = new Promise<void>((resolve) => changed = resolve)
    const other = sql.begin(async (tx) => {
      await tx`SELECT 1 FROM blog_posts WHERE id = ${german} FOR UPDATE`
      await tx`UPDATE blog_posts SET translation_of = ${spanish}, version = version + 1
        WHERE id = ${german}`
      changed()
      await held
    })
    await isChanged
    // The English post to translate the German one: it must wait for the other save to end.
    const save = rejection(
      blog.update(english, 1, fields(`hello`, { translationOf: german }), false, maya),
    )
    // Awaited below; this only keeps a save that did not wait from failing the whole file.
    save.catch(() => {})
    try {
      const deadline = Date.now() + 10_000
      while (true) {
        const [{ waiting }] = await sql<{ waiting: number }[]>`
          SELECT COUNT(*)::int AS waiting FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'
        `
        if (waiting > 0) break
        if (Date.now() > deadline) throw new Error(`the save did not wait for the other one`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    } finally {
      // Ends the other save even when the check failed, so the schema can be dropped.
      release()
      await other
    }

    const error = await save
    expect([error.code, error.field]).toEqual([`TRANSLATION_INVALID`, `translationOf`])
    expect((await blog.get(english))!.translationOf).toBeNull()
  })
})

Deno.test(`blog: deleting an original keeps its translations linked, the main language's first (#530)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [german, spanish, english, french] = [uuidV7(), uuidV7(), uuidV7(), uuidV7()]
    await blog.create(german, fields(`hallo`, { language: `de` }), maya)
    // The Spanish one is older, but English is the main language.
    await blog.create(spanish, fields(`hola`, { language: `es`, translationOf: german }), maya)
    await blog.create(english, fields(`hello`, { language: `en`, translationOf: german }), maya)
    await blog.create(french, fields(`salut`, { language: `fr`, translationOf: german }), maya)
    for (const id of [german, spanish, english, french]) await blog.publish(id, 1, null, null, maya)

    await blog.delete(german, 2, maya)

    expect((await blog.get(english))!.translationOf).toBeNull()
    expect((await blog.get(spanish))!.translationOf).toBe(english)
    expect((await blog.get(french))!.translationOf).toBe(english)
    expect((await readPublicPost(sql, `hola`))!.post.translations).toEqual([
      { language: `en`, slug: `hello` },
      { language: `fr`, slug: `salut` },
    ])
  })
})

Deno.test(`blog: the public reads leave out a post in a language the apps no longer ship (#530)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [english, dropped] = [uuidV7(), uuidV7()]
    await blog.create(english, fields(`hello`), maya)
    await blog.create(
      dropped,
      fields(`moin`, { language: `nds` as Language, translationOf: english }),
      maya,
    )
    for (const id of [english, dropped]) await blog.publish(id, 1, null, null, maya)

    expect((await listPublicPosts(sql, null)).map((post) => post.slug)).toEqual([`hello`])
    expect(await readPublicPost(sql, `moin`)).toBeNull()
    expect((await readPublicPost(sql, `hello`))!.post.translations).toEqual([])
    expect((await listPublicFeed(sql)).map((post) => post.slug)).toEqual([`hello`])
  })
})

Deno.test(`blog: a scheduled post goes live through its job, and is emailed once ever`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    const job = blogPublishJob({
      sql,
      fetch: liveSite(sql),
      brand: BRAND,
      setup: SETUP,
      log: () => {},
    })
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now()), ('news', 'bob@example.com', 'k2', now())`
    await blog.create(id, fields(`launch`), maya)
    await blog.publish(id, 1, LATER(), `news`, maya)

    await t.step(`does nothing before the post's time`, async () => {
      await job(jobEvent(id))
      expect((await blog.get(id))!.status).toBe(`scheduled`)
      expect(await issues(sql, id)).toEqual({ rows: 0, jobs: 0 })
    })

    await t.step(`publishes at the time, through the worker's processor`, async () => {
      await makeDue(sql, id)
      await processorFor(sql).drainOnce()

      const post = (await blog.get(id))!
      expect(post).toMatchObject({ status: `published`, newsletterRecipients: 2, version: 3 })
      expect(post.newsletterSentAt).not.toBeNull()
      expect((await listPublicPosts(sql, null)).map((row) => row.slug)).toEqual([`launch`])
    })

    await t.step(
      `queued one teaser issue, named by the post's id, linking to the post`,
      async () => {
        expect((await issues(sql, id)).rows).toBe(1)
        const [issue] = await sql<{ subject: string; html: string }[]>`
        SELECT subject, html FROM subscriber_issue_content WHERE issue_id = ${id}
      `
        expect(issue.subject).toBe(`Post launch`)
        expect(issue.html).toContain(`https://www.example.com/blog/launch`)
        expect(issue.html).toContain(`Read the post`)
      },
    )

    await t.step(`a retried job queues nothing more`, async () => {
      const before = await issues(sql, id)
      await job(jobEvent(id))
      expect(await issues(sql, id)).toEqual(before)
    })

    await t.step(`unpublishing and publishing again with the list emails nothing`, async () => {
      const before = await issues(sql, id)
      await blog.unpublish(id, 3, maya)
      const again = await blog.publish(id, 4, null, `news`, maya)
      await job(jobEvent(id))
      expect(again.newsletterList).toBe(`news`)
      expect(await issues(sql, id)).toEqual(before)
    })
  })
})

Deno.test(`blog: a post's issue goes only to the subscribers of its language, written in it (#527)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const crypto = await createListCrypto(SETUP, `news`)
    // Ada signed up before #527 and has no language: she reads the main language, English.
    for (
      const [email, language] of [[`ada@seed.test`, null], [`bob@seed.test`, `de`], [
        `cat@seed.test`,
        `es`,
      ]]
    ) {
      await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at, language)
        VALUES ('news', ${email}, ${await crypto.subscriberKey(email!)}, now(), ${language})`
    }
    const sent: EmailMessage[] = []
    const sender = {
      send: (message: EmailMessage) => {
        sent.push(message)
        return Promise.resolve({ ok: true as const, id: String(sent.length) })
      },
    } as unknown as EmailSender
    const processor = processorFor(sql, sender)
    const german = uuidV7()
    const english = uuidV7()
    await blog.create(german, fields(`hallo`, { language: `de`, title: `Hallo` }), maya)
    await blog.create(english, fields(`hello`, { title: `Hello` }), maya)
    await blog.publish(german, 1, null, `news`, maya)
    await blog.publish(english, 1, null, `news`, maya)
    for (let run = 0; run < 3; run++) await processor.drainOnce()

    expect((await blog.get(german))!.newsletterRecipients).toBe(1)
    expect((await blog.get(english))!.newsletterRecipients).toBe(1)
    const byIssue = (subject: string) => sent.filter((mail) => mail.subject === subject)
    expect(byIssue(`Hallo`).map((mail) => mail.to)).toEqual([`bob@seed.test`])
    expect(byIssue(`Hallo`)[0].text).toContain(`Beitrag lesen`)
    expect(byIssue(`Hallo`)[0].text).toContain(`Du bekommst diese E-Mail`)
    expect(byIssue(`Hallo`)[0].text).toContain(`Abbestellen`)
    expect(byIssue(`Hallo`)[0].text).not.toContain(`Unsubscribe`)
    expect(byIssue(`Hallo`)[0].text).not.toContain(`Read the post`)
    expect(byIssue(`Hallo`)[0].text).toContain(`https://www.example.com/de/blog/hallo`)
    expect(byIssue(`Hello`).map((mail) => mail.to)).toEqual([`ada@seed.test`])
    expect(byIssue(`Hello`)[0].text).toContain(`Read the post`)
    expect(sent.map((mail) => mail.to)).not.toContain(`cat@seed.test`)
  })
})

Deno.test(`blog: a job left over from an earlier time does not publish early`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const job = blogPublishJob({
      sql,
      fetch: liveSite(sql),
      brand: BRAND,
      setup: SETUP,
      log: () => {},
    })
    const [moved, unscheduled] = [uuidV7(), uuidV7()]
    await blog.create(moved, fields(`moved`), maya)
    await blog.publish(moved, 1, LATER(), null, maya)
    await blog.unschedule(moved, 2, maya)
    await blog.publish(moved, 3, new Date(Date.now() + 7_200_000), null, maya)
    await blog.create(unscheduled, fields(`unscheduled`), maya)
    await blog.publish(unscheduled, 1, LATER(), `news`, maya)
    const back = await blog.unschedule(unscheduled, 2, maya)

    // The first job of each comes due; the posts' own times have not.
    await job(jobEvent(moved))
    await job(jobEvent(unscheduled))

    expect((await blog.get(moved))!.status).toBe(`scheduled`)
    expect((await blog.get(unscheduled))!.status).toBe(`draft`)
    expect(back.newsletterList).toBeNull()
  })
})

Deno.test(`blog: with the newsletter off the post goes live and no issue is queued`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const lines: string[] = []
    const id = uuidV7()
    await blog.create(id, fields(`quiet`), maya)
    await blog.publish(id, 1, LATER(), `news`, maya)
    await makeDue(sql, id)

    await blogPublishJob({
      sql,
      fetch: liveSite(sql),
      brand: BRAND,
      setup: null,
      log: (line) => lines.push(line),
    })(
      jobEvent(id),
    )

    expect(await blog.get(id)).toMatchObject({ status: `published`, newsletterList: null })
    expect(await issues(sql, id)).toEqual({ rows: 0, jobs: 0 })
    expect(lines.filter((line) => line.includes(`newsletter`))).toHaveLength(1)
  })
})

Deno.test(`blog: a post that went live while the newsletter was off is not emailed once it is on (#414)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now())`
    await blog.create(id, fields(`old-news`), maya)
    await blog.publish(id, 1, LATER(), `news`, maya)
    await makeDue(sql, id)
    await blogPublishJob({ sql, fetch: liveSite(sql), brand: BRAND, setup: null, log: () => {} })(
      jobEvent(id),
    )

    // The worker starts again months later, with the newsletter on.
    await queueDueBlogJobs(sql)
    await blogPublishJob({ sql, fetch: liveSite(sql), brand: BRAND, setup: SETUP, log: () => {} })(
      jobEvent(id),
    )
    await drain(sql)

    expect(await issues(sql, id)).toEqual({ rows: 0, jobs: 0 })
    expect((await blog.get(id))!.newsletterSentAt).not.toBeNull()
  })
})

Deno.test(`blog: publishing a scheduled post now without naming a list keeps its email (#414)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now())`
    const [kept, dropped] = [uuidV7(), uuidV7()]
    for (const id of [kept, dropped]) {
      await blog.create(id, fields(id === kept ? `kept` : `dropped`), maya)
      await blog.publish(id, 1, LATER(), `news`, maya)
    }

    await t.step(`a list left out keeps the post's list, and the post is emailed`, async () => {
      expect((await blog.publish(kept, 2, null, undefined, maya)).newsletterList).toBe(`news`)
      await drain(sql)
      expect((await issues(sql, kept)).rows).toBe(1)
    })

    await t.step(`a list given as null drops the email`, async () => {
      expect((await blog.publish(dropped, 2, null, null, maya)).newsletterList).toBeNull()
      await drain(sql)
      expect((await issues(sql, dropped)).rows).toBe(0)
    })
  })
})

Deno.test(`blog: a cover written HTTPS:// is stored, not refused by the database (#414)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const { coverUrl, coverAlt } = parseBlogPostFields({
      ...fields(`cover`),
      coverUrl: `HTTPS://images.example.com/a.png`,
      coverAlt: `A chart`,
    })
    const post = await blog.create(uuidV7(), fields(`cover`, { coverUrl, coverAlt }), maya)
    expect(post.coverUrl).toBe(`https://images.example.com/a.png`)
  })
})

Deno.test(`blog: an author link is stored, changed and cleared, and the public post answers it (#730)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    const about = `https://maya.example.org/about`
    const created = await blog.create(id, fields(`linked`, { authorUrl: about }), maya)
    expect(created.authorUrl).toBe(about)
    expect((await blog.get(id))?.authorUrl).toBe(about)
    await blog.publish(id, 1, null, null, maya)
    expect((await readPublicPost(sql, `linked`))?.post.authorUrl).toBe(about)

    const other = `https://maya.example.net/`
    expect(
      (await blog.update(id, 2, fields(`linked`, { authorUrl: other }), false, maya)).authorUrl,
    )
      .toBe(other)
    expect((await blog.update(id, 3, fields(`linked`), false, maya)).authorUrl).toBeNull()
    expect((await readPublicPost(sql, `linked`))?.post.authorUrl).toBeNull()

    // The database refuses what the API would: a link that is not https.
    await expect(
      sql`UPDATE blog_posts SET author_url = 'http://maya.example.org/' WHERE id = ${id}`,
    )
      .rejects.toThrow(`blog_posts_author_url_check`)
  })
})

Deno.test(`blog: lost jobs come back once`, async () => {
  await withSchema(async (sql) => {
    await upsertSeedPosts(sql, [seedPost(`live`), seedPost(`later`, { publishAt: LATER() })])

    // The demo's wipe empties the job table but keeps the posts.
    await sql`DELETE FROM outbox_events`
    expect(await queueDueBlogJobs(sql)).toBe(1)
    expect(await queueDueBlogJobs(sql)).toBe(0)
  })
})

Deno.test(`blog: Seed's post files load only in demo mode, and loading twice writes nothing (#621)`, async (t) => {
  await withSchema(async (sql) => {
    await t.step(`demo off reads no file and loads nothing`, async () => {
      const untouchable = {
        readDir: () => Promise.reject(new Error(`read a file with demo mode off`)),
        readText: () => Promise.reject(new Error(`read a file with demo mode off`)),
      }
      expect(await loadDemoBlogPosts(sql, { demo: false, fs: untouchable })).toBe(0)
      const [{ posts }] = await sql<
        { posts: number }[]
      >`SELECT COUNT(*)::int AS posts FROM blog_posts`
      expect(posts).toBe(0)
    })

    const files = await readSeedPosts(denoFileSystem)
    await t.step(`demo on loads every file, with its author and no account`, async () => {
      expect(await loadDemoBlogPosts(sql, { demo: true, fs: denoFileSystem })).toBe(files.length)
      const welcome = await bySlug(sql, `welcome-to-the-seed-blog`)
      expect(welcome).toMatchObject({
        status: `published`,
        authorName: `Anton Shubin`,
        authorUrl: `https://antonshubin.com/about`,
      })
      expect((await listPublicPosts(sql, null)).map((post) => post.slug)).toContain(
        `welcome-to-the-seed-blog`,
      )
    })

    await t.step(`a second load writes nothing`, async () => {
      const before = await sql`SELECT * FROM blog_posts ORDER BY id`
      expect(await loadDemoBlogPosts(sql, { demo: true, fs: denoFileSystem })).toBe(0)
      expect(await sql`SELECT * FROM blog_posts ORDER BY id`).toEqual(before)
    })
  })
})

Deno.test(`blog: a changed post file updates its post, and a post no file names is left alone (#621)`, async () => {
  await withSchema(async (sql) => {
    await upsertSeedPosts(sql, [seedPost(`kept`), seedPost(`changed`)])
    const kept = await bySlug(sql, `kept`)
    const changed = await bySlug(sql, `changed`)

    const edited = seedPost(`changed`, { fields: fields(`changed`, { title: `A new title` }) })
    expect(await upsertSeedPosts(sql, [edited])).toBe(1)

    expect(await bySlug(sql, `changed`)).toMatchObject({
      id: changed.id,
      title: `A new title`,
      version: 2,
    })
    expect(await bySlug(sql, `kept`)).toEqual(kept)
  })
})

Deno.test(`blog: a post file's author link is written, changed and cleared with the file (#730)`, async () => {
  await withSchema(async (sql) => {
    const publishAt = new Date(Date.now() - DAY_MS)
    const linked = (authorUrl: string | null) =>
      seedPost(`linked`, { fields: fields(`linked`, { authorUrl }), publishAt })
    await upsertSeedPosts(sql, [linked(`https://antonshubin.com/about`)])
    expect((await bySlug(sql, `linked`)).authorUrl).toBe(`https://antonshubin.com/about`)
    expect(await upsertSeedPosts(sql, [linked(`https://antonshubin.com/about`)])).toBe(0)
    expect(await upsertSeedPosts(sql, [linked(`https://example.com/about`)])).toBe(1)
    expect((await bySlug(sql, `linked`)).authorUrl).toBe(`https://example.com/about`)
    expect(await upsertSeedPosts(sql, [linked(null)])).toBe(1)
    expect((await bySlug(sql, `linked`)).authorUrl).toBeNull()
  })
})

Deno.test(`blog: a post file dated in the past is published with its date, one in the future waits for its job (#621)`, async () => {
  await withSchema(async (sql) => {
    const past = new Date(Date.now() - 3 * DAY_MS)
    const future = LATER()
    await upsertSeedPosts(sql, [
      seedPost(`old-news`, { publishAt: past }),
      seedPost(`coming-soon`, { publishAt: future }),
    ])

    expect(await bySlug(sql, `old-news`)).toMatchObject({ status: `published`, publishedAt: past })
    const soon = await bySlug(sql, `coming-soon`)
    expect(soon).toMatchObject({ status: `scheduled`, publishedAt: null })
    expect((await waitingJobs(sql, soon.id)).map((job) => job.availableAt)).toEqual([future])
    expect((await listPublicPosts(sql, null)).map((post) => post.slug)).toEqual([`old-news`])

    await makeDue(sql, soon.id)
    await drain(sql)
    expect((await bySlug(sql, `coming-soon`)).status).toBe(`published`)
  })
})

Deno.test(`blog: a translation's file links it to its original by slug (#621)`, async () => {
  await withSchema(async (sql) => {
    // The translation comes first, as no file order is promised.
    await upsertSeedPosts(sql, [
      seedPost(`hallo`, { fields: fields(`hallo`, { language: `de` }), translationOf: `hello` }),
      seedPost(`hello`),
    ])

    const original = await bySlug(sql, `hello`)
    expect((await bySlug(sql, `hallo`)).translationOf).toBe(original.id)
  })
})

Deno.test(`blog: a post file is emailed once, and only when it asks for the newsletter (#621)`, async (t) => {
  await withSchema(async (sql) => {
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now())`
    const posts = [seedPost(`mailed`, { newsletter: true }), seedPost(`quiet`)]
    await upsertSeedPosts(sql, posts)
    const mailed = await bySlug(sql, `mailed`)
    const quiet = await bySlug(sql, `quiet`)

    await t.step(`the post that asks is emailed through its job`, async () => {
      await drain(sql)
      expect((await issues(sql, mailed.id)).rows).toBe(1)
      expect((await bySlug(sql, `mailed`)).newsletterSentAt).not.toBeNull()
    })

    await t.step(`the other is recorded as mailed, with no list, and never emailed`, async () => {
      expect(quiet).toMatchObject({ newsletterList: null })
      expect(quiet.newsletterSentAt).not.toBeNull()
      expect((await issues(sql, quiet.id)).rows).toBe(0)
    })

    await t.step(`a list added later, or the file asking later, emails nothing`, async () => {
      await sql`UPDATE blog_posts SET newsletter_list = 'news' WHERE id = ${quiet.id}`
      expect(await queueDueBlogJobs(sql)).toBe(0)
      await upsertSeedPosts(sql, [posts[0], seedPost(`quiet`, { newsletter: true })])
      await blogPublishJob({
        sql,
        fetch: liveSite(sql),
        brand: BRAND,
        setup: SETUP,
        log: () => {},
      })(jobEvent(quiet.id))
      await drain(sql)
      expect((await issues(sql, quiet.id)).rows).toBe(0)
    })

    await t.step(`loading again emails nothing more`, async () => {
      await upsertSeedPosts(sql, posts)
      await drain(sql)
      expect((await issues(sql, mailed.id)).rows).toBe(1)
    })
  })
})

Deno.test(`blog: the admin reads the confirmed subscribers of every list, in each language`, async () => {
  await withSchema(async (sql) => {
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now()), ('other', 'bob@example.com', 'k2', now())`

    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at, language)
      VALUES ('news', 'cat@example.com', 'k3', now(), 'de'), ('news', 'dan@example.com', 'k4', now(), 'en')`

    // One with no language counts as the main language's, as the issue's send does (#527).
    expect(await createAdminBlog(sql).confirmedSubscribers()).toEqual([
      { list: `news`, byLanguage: { en: 2, de: 1 } },
    ])
  })
})

Deno.test(`blog: scheduling again for the same time keeps the one job waiting`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    const at = LATER()
    await blog.create(id, fields(`same-time`), maya)
    await blog.publish(id, 1, at, null, maya)
    await blog.unschedule(id, 2, maya)

    const again = await blog.publish(id, 3, at, null, maya)

    expect(again.status).toBe(`scheduled`)
    const [{ jobs }] = await sql<{ jobs: number }[]>`
      SELECT COUNT(*)::int AS jobs FROM outbox_events
      WHERE event_kind = ${BLOG_PUBLISH_JOB} AND aggregate_id = ${id} AND processed_at IS NULL
    `
    expect(jobs).toBe(1)
  })
})

Deno.test(`blog: Run now on a post's job still publishes the post at its time`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    const at = LATER()
    await blog.create(id, fields(`run-now`), maya)
    await blog.publish(id, 1, at, null, maya)
    const [first] = await waitingJobs(sql, id)

    const outcome = await sql.begin((tx) => runJobNow(tx, first.id, maya.userId, null))
    await drain(sql)

    expect(outcome).toBe(AdminJobActionOutcome.Done)
    expect((await blog.get(id))!.status).toBe(`scheduled`)
    const waiting = await waitingJobs(sql, id)
    expect(waiting.map((job) => job.availableAt.getTime())).toEqual([at.getTime()])
    await makeDue(sql, id)
    await drain(sql)
    expect((await blog.get(id))!.status).toBe(`published`)
  })
})

Deno.test(`blog: Cancel on a post's job is refused, and the post keeps its job`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    await blog.create(id, fields(`no-cancel`), maya)
    await blog.publish(id, 1, LATER(), null, maya)
    const [job] = await waitingJobs(sql, id)

    const outcome = await sql.begin((tx) => cancelJob(tx, job.id, maya.userId, null))

    expect(outcome).toBe(AdminJobActionOutcome.NotCancellable)
    expect(await waitingJobs(sql, id)).toEqual([{ ...job, cancelledAt: null }])
    expect((await blog.get(id))!.status).toBe(`scheduled`)
  })
})

const INDEXNOW: IndexNowSetup = {
  key: `indexnow-test-key-0123`,
  siteUrl: `https://www.example.com`,
}

/**
 * A fake IndexNow that answers `status` (or throws when it is `null`) and records the addresses of
 * every submission.
 */
function fakeIndexNow(status: number | null = 200) {
  const sent: string[][] = []
  const fetch = async (_input: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)).urlList)
    if (status === null) throw new TypeError(`connection refused`)
    return new Response(null, { status })
  }
  return { sent, fetch: fetch as typeof globalThis.fetch }
}

/**
 * Runs the `blog.indexnow` rows of post `id` that wait, as the worker would, and closes them.
 * Answers how many ran.
 */
async function runIndexNow(
  sql: postgres.Sql,
  id: string,
  deps: Omit<Parameters<typeof blogIndexNowJob>[0], `sql`>,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM outbox_events
    WHERE event_kind = ${BLOG_INDEXNOW_JOB} AND aggregate_id = ${id} AND processed_at IS NULL
  `
  const job = blogIndexNowJob({ sql, ...deps })
  for (const row of rows) {
    await job({ id: row.id, aggregateId: id, eventKind: BLOG_INDEXNOW_JOB } as OutboxEvent)
    await sql`UPDATE outbox_events SET processed_at = now() WHERE id = ${row.id}`
  }
  return rows.length
}

Deno.test(`blog: IndexNow hears every address of a post that goes live, moves, changes or leaves (#418)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const post = uuidV7()
    const indexNow = fakeIndexNow()
    const run = () =>
      runIndexNow(sql, post, { setup: INDEXNOW, log: () => {}, fetch: indexNow.fetch })
    await blog.create(post, fields(`first`, { language: `de` }), maya)

    await t.step(`queues nothing for a draft that was never live`, async () => {
      await blog.update(
        post,
        1,
        parseBlogPostEdit(fields(`first`, { language: `de` })),
        false,
        maya,
      )
      expect(await run()).toBe(0)
    })

    await t.step(`sends the post's address when it is published now`, async () => {
      await blog.publish(post, 2, null, null, maya)
      expect(await run()).toBe(1)
      expect(indexNow.sent.at(-1)).toEqual([`https://www.example.com/de/blog/first`])
    })

    await t.step(`sends the new address and the old one after Change URL`, async () => {
      await blog.changeUrl(post, 3, `second`, maya)
      expect(await run()).toBe(1)
      expect(indexNow.sent.at(-1)).toEqual([
        `https://www.example.com/de/blog/second`,
        `https://www.example.com/de/blog/first`,
      ])
    })

    await t.step(
      `sends them again when the live post is saved, once for saves before it ran`,
      async () => {
        const edit = parseBlogPostEdit(fields(`second`, { language: `de`, title: `Changed` }))
        await blog.update(post, 4, edit, true, maya)
        await blog.update(post, 5, edit, false, maya)
        expect(await run()).toBe(1)
        expect(indexNow.sent.at(-1)).toHaveLength(2)
      },
    )

    await t.step(
      `sends them when the post is unpublished, so the engines see it gone`,
      async () => {
        await blog.unpublish(post, 6, maya)
        expect(await run()).toBe(1)
        expect(indexNow.sent.at(-1)).toEqual([
          `https://www.example.com/de/blog/second`,
          `https://www.example.com/de/blog/first`,
        ])
      },
    )
  })
})

Deno.test(`blog: a scheduled post that goes live through its job is sent to IndexNow (#418)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const post = uuidV7()
    const indexNow = fakeIndexNow()
    await blog.create(post, fields(`later`), maya)
    await blog.publish(post, 1, LATER(), null, maya)
    expect(await runIndexNow(sql, post, { setup: INDEXNOW, log: () => {}, fetch: indexNow.fetch }))
      .toBe(0)

    await makeDue(sql, post)
    await blogPublishJob({ sql, fetch: liveSite(sql), brand: BRAND, setup: null, log: () => {} })(
      jobEvent(post),
    )
    await runIndexNow(sql, post, { setup: INDEXNOW, log: () => {}, fetch: indexNow.fetch })

    expect(indexNow.sent).toEqual([[`https://www.example.com/blog/later`]])
  })
})

Deno.test(`blog: with IndexNow off a post goes live and nothing is sent (#418)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const post = uuidV7()
    const indexNow = fakeIndexNow()
    await blog.create(post, fields(`quiet`), maya)
    await blog.publish(post, 1, null, null, maya)

    expect(await runIndexNow(sql, post, { setup: null, log: () => {}, fetch: indexNow.fetch }))
      .toBe(1)
    expect(indexNow.sent).toEqual([])
    expect((await bySlug(sql, `quiet`)).status).toBe(`published`)
  })
})

Deno.test(`blog: a failing IndexNow is logged once without the key and fails no publish (#418)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    for (const [slug, status] of [[`refused`, 403], [`unreachable`, null]] as const) {
      const post = uuidV7()
      const lines: string[] = []
      await blog.create(post, fields(slug), maya)
      await blog.publish(post, 1, null, null, maya)

      const indexNow = fakeIndexNow(status)
      await runIndexNow(sql, post, {
        setup: INDEXNOW,
        log: (line) => lines.push(line),
        fetch: indexNow.fetch,
      })

      expect(indexNow.sent).toHaveLength(1)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain(`IndexNow was not told about blog post ${post}`)
      expect(lines[0]).not.toContain(INDEXNOW.key)
      expect((await bySlug(sql, slug)).status).toBe(`published`)
    }
  })
})

Deno.test(`blog: Seed's live post files are sent to IndexNow, a scheduled one only when it goes live (#418)`, async () => {
  await withSchema(async (sql) => {
    await upsertSeedPosts(sql, [seedPost(`live`), seedPost(`later`, { publishAt: LATER() })])
    const queued = async (slug: string) => {
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM outbox_events o JOIN blog_posts p ON p.id = o.aggregate_id
        WHERE o.event_kind = ${BLOG_INDEXNOW_JOB} AND p.slug = ${slug}
      `
      return count
    }
    expect(await queued(`live`)).toBe(1)
    expect(await queued(`later`)).toBe(0)
  })
})

Deno.test(`blog: a post the website does not show yet is not emailed, and a retry emails it once (#733)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now())`
    await blog.create(id, fields(`slow-deploy`), maya)
    await blog.publish(id, 1, null, `news`, maya)
    const asked: string[] = []
    const notYet: typeof fetch = (input) => {
      asked.push(String(input))
      return Promise.resolve(new Response(`Not found`, { status: 404 }))
    }

    await expect(
      blogPublishJob({ sql, fetch: notYet, brand: BRAND, setup: SETUP, log: () => {} })(
        jobEvent(id),
      ),
    ).rejects.toThrow(BlogPostNotLiveError)
    expect(asked).toEqual([`https://www.example.com/blog/slow-deploy`])
    expect(await issues(sql, id)).toEqual({ rows: 0, jobs: 0 })
    expect((await blog.get(id))!.newsletterSentAt).toBeNull()

    const job = blogPublishJob({
      sql,
      fetch: liveSite(sql),
      brand: BRAND,
      setup: SETUP,
      log: () => {},
    })
    await job(jobEvent(id))
    await job(jobEvent(id))
    expect((await issues(sql, id)).rows).toBe(1)
  })
})

Deno.test(`blog: a post's issue opens with its intro (#733)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now())`
    await blog.create(id, fields(`opened`, { intro: `I wrote this after a long night.` }), maya)
    await blog.publish(id, 1, null, `news`, maya)
    await drain(sql)

    const [issue] = await sql<{ html: string }[]>`
      SELECT html FROM subscriber_issue_content WHERE issue_id = ${id}
    `
    expect(issue.html).toContain(`<p style="margin:0 0 16px">I wrote this after a long night.</p>`)
    expect(issue.html).not.toContain(`<p style="margin:0 0 16px">About opened.</p>`)
  })
})

/** A Dev.to that keeps its articles in memory, answering as `@spy4x/integrations/devto` does. */
function fakeDevto(articles: DevtoArticle[] = []) {
  const made: DevtoArticle[] = []
  const client: BlogCrosspostSetup[`client`] = {
    find: (canonical) => {
      const at = articles.findIndex((article) => article.canonical_url === canonical)
      return Promise.resolve({
        success: true as const,
        output: at === -1 ? null : { id: at + 1, url: `https://dev.to/seed/article-${at}` },
        error: `` as const,
      })
    },
    create: (article) => {
      made.push(article)
      articles.push(article)
      return Promise.resolve({
        success: true as const,
        output: { id: articles.length, url: `https://dev.to/seed/article-${articles.length - 1}` },
        error: `` as const,
      })
    },
  }
  return { made, setup: { siteUrl: `https://www.example.com`, client } }
}

/** The post's cross-post record. */
async function crosspostOf(sql: postgres.Sql, id: string) {
  const [row] = await sql<{ crosspostedAt: Date | null; devtoUrl: string | null }[]>`
    SELECT crossposted_at, devto_url FROM blog_posts WHERE id = ${id}
  `
  return row
}

/** A Dev.to channel with "Post automatically" on, which a cross-post needs (#839). */
async function devtoChannel(sql: postgres.Sql, autoPost = true): Promise<void> {
  await sql`
    INSERT INTO blog_channels (id, name, kind, address, utm_source, languages, auto_post)
    VALUES (${uuidV7()}, 'Dev.to', 'devto', 'https://dev.to/seed', 'devto', '{en}', ${autoPost})
  `
}

/** The job's event for post `id`'s cross-post. */
function crosspostEvent(id: string): OutboxEvent {
  return { id: uuidV7(), aggregateId: id, eventKind: BLOG_CROSSPOST_JOB } as OutboxEvent
}

Deno.test(`blog: a live post is cross-posted to Dev.to once ever, with its canonical address (#733)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const devto = fakeDevto()
    await devtoChannel(sql)
    const id = uuidV7()
    await blog.create(id, fields(`crossed`, { intro: `Why I built it.` }), maya)
    await blog.publish(id, 1, null, null, maya)

    await t.step(`the worker posts it and records the article`, async () => {
      const processor = processorFor(sql, null, devto.setup)
      for (let run = 0; run < 3; run++) await processor.drainOnce()
      expect(devto.made).toHaveLength(1)
      expect(devto.made[0]).toMatchObject({
        title: `Post crossed`,
        canonical_url: `https://www.example.com/blog/crossed`,
        published: true,
      })
      expect(devto.made[0].body_markdown).toMatch(/^Why I built it\./)
      const record = await crosspostOf(sql, id)
      expect(record.crosspostedAt).not.toBeNull()
      expect(record.devtoUrl).toBe(`https://dev.to/seed/article-0`)
    })

    await t.step(`a repeated job, and publishing again, post nothing more`, async () => {
      // A Dev.to whose search misses the article: only the post's own record stops a second one.
      const blind = fakeDevto()
      await blogCrosspostJob({ sql, setup: blind.setup, log: () => {} })(crosspostEvent(id))
      await blog.unpublish(id, 2, maya)
      await blog.publish(id, 3, null, null, maya)
      const processor = processorFor(sql, null, blind.setup)
      for (let run = 0; run < 3; run++) await processor.drainOnce()
      expect(devto.made).toHaveLength(1)
      expect(blind.made).toHaveLength(0)
    })
  })
})

Deno.test(`blog: a cross-post that died before it was recorded finds its article, and posts none (#733)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    await devtoChannel(sql)
    const id = uuidV7()
    await blog.create(id, fields(`half-done`), maya)
    await blog.publish(id, 1, null, null, maya)
    // The run before posted the article, then the worker died before it wrote the record.
    const devto = fakeDevto([{
      title: `Post half-done`,
      body_markdown: `Hello.`,
      canonical_url: `https://www.example.com/blog/half-done`,
      published: true,
    }])

    await blogCrosspostJob({ sql, setup: devto.setup, log: () => {} })(crosspostEvent(id))

    expect(devto.made).toHaveLength(0)
    expect((await crosspostOf(sql, id)).devtoUrl).toBe(`https://dev.to/seed/article-0`)
  })
})

Deno.test(`blog: a Dev.to error fails the cross-post for a retry, and records nothing (#733)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    await devtoChannel(sql)
    const id = uuidV7()
    await blog.create(id, fields(`flaky`), maya)
    await blog.publish(id, 1, null, null, maya)
    const devto = fakeDevto()
    const down = {
      ...devto.setup,
      client: {
        ...devto.setup.client,
        create: () =>
          Promise.resolve({ success: false as const, output: null, error: `Dev.to answered 503` }),
      },
    }

    await expect(
      blogCrosspostJob({ sql, setup: down, log: () => {} })(crosspostEvent(id)),
    ).rejects.toThrow(DevtoCrosspostError)
    expect((await crosspostOf(sql, id)).crosspostedAt).toBeNull()

    await blogCrosspostJob({ sql, setup: devto.setup, log: () => {} })(crosspostEvent(id))
    expect(devto.made).toHaveLength(1)
    expect((await crosspostOf(sql, id)).crosspostedAt).not.toBeNull()
  })
})

Deno.test(`blog: with the cross-post off, or for a translation, a post is settled and never posted (#733)`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const [off, original, german] = [uuidV7(), uuidV7(), uuidV7()]
    await devtoChannel(sql)

    await t.step(
      `off: settled with a log line, and turning it on later posts nothing`,
      async () => {
        await blog.create(off, fields(`before-devto`), maya)
        await blog.publish(off, 1, null, null, maya)
        await drain(sql)
        expect((await crosspostOf(sql, off)).crosspostedAt).not.toBeNull()

        const devto = fakeDevto()
        await queueDueBlogJobs(sql)
        const processor = processorFor(sql, null, devto.setup)
        for (let run = 0; run < 3; run++) await processor.drainOnce()
        expect(devto.made).toHaveLength(0)
      },
    )

    await t.step(`a translation: settled, its original posted`, async () => {
      const devto = fakeDevto()
      await blog.create(original, fields(`hello-devto`), maya)
      await blog.create(
        german,
        fields(`hallo-devto`, { language: `de`, translationOf: original }),
        maya,
      )
      for (const id of [original, german]) await blog.publish(id, 1, null, null, maya)
      const processor = processorFor(sql, null, devto.setup)
      for (let run = 0; run < 3; run++) await processor.drainOnce()
      expect(devto.made.map((article) => article.canonical_url)).toEqual([
        `https://www.example.com/blog/hello-devto`,
      ])
      expect((await crosspostOf(sql, german)).crosspostedAt).not.toBeNull()
      expect((await crosspostOf(sql, german)).devtoUrl).toBeNull()
    })
  })
})

Deno.test(`blog: a Dev.to channel with Post automatically off gets no cross-post (#839)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    await devtoChannel(sql, false)
    const devto = fakeDevto()
    const id = uuidV7()
    await blog.create(id, fields(`manual-devto`), maya)
    await blog.publish(id, 1, null, null, maya)

    await blogCrosspostJob({ sql, setup: devto.setup, log: () => {} })(crosspostEvent(id))

    expect(devto.made).toHaveLength(0)
    expect((await crosspostOf(sql, id)).crosspostedAt).not.toBeNull()
  })
})

Deno.test(`blog: a post going live queues each automatic channel's job once, with the newsletter off (#839)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const channel = uuidV7()
    await sql`
      INSERT INTO blog_channels (id, name, kind, address, utm_source, languages, auto_post)
      VALUES (${channel}, 'News', 'telegram', 'https://t.me/seednews', 'telegram', '{en}', true)
    `
    const id = uuidV7()
    await blog.create(id, fields(`told`), maya)
    await blog.publish(id, 1, null, null, maya)
    const job = blogPublishJob({
      sql,
      fetch: liveSite(sql),
      brand: BRAND,
      setup: null,
      siteUrl: SETUP.siteUrl,
      log: () => {},
    })

    await job(jobEvent(id))
    await job(jobEvent(id))

    const jobs = await sql`
      SELECT job.event_kind FROM outbox_events job
      JOIN blog_post_shares share ON share.id = job.aggregate_id
      WHERE share.post_id = ${id} AND share.channel_id = ${channel} AND share.automatic
        AND share.status = 'todo'
    `
    expect(jobs).toEqual([{ eventKind: `blog.post-telegram` }])
  })
})

Deno.test(`blog: a post file's cover, intro and related feature are written with the file (#733)`, async () => {
  await withSchema(async (sql) => {
    const publishAt = new Date(Date.now() - DAY_MS)
    const post = (relatedFeature: string | null) =>
      seedPost(`covered`, {
        publishAt,
        fields: fields(`covered`, {
          intro: `Two sentences.`,
          relatedFeature,
          coverAlt: `A seedling`,
        }),
        coverFile: `covered.webp`,
      })
    await upsertSeedPosts(sql, [post(`realtime`)])
    const read = async () =>
      (await sql<{ coverFile: string; intro: string; relatedFeature: string | null }[]>`
        SELECT cover_file, intro, related_feature FROM blog_posts WHERE slug = 'covered'
      `)[0]
    expect(await read()).toEqual({
      coverFile: `covered.webp`,
      intro: `Two sentences.`,
      relatedFeature: `realtime`,
    })
    expect(await upsertSeedPosts(sql, [post(`realtime`)])).toBe(0)
    expect(await upsertSeedPosts(sql, [post(null)])).toBe(1)
    expect((await read()).relatedFeature).toBeNull()
  })
})

Deno.test(`blog: an admin save of a post file with a cover keeps the cover and its description (#733)`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    await upsertSeedPosts(sql, [
      seedPost(`covered`, {
        fields: fields(`covered`, { coverAlt: `A seedling` }),
        coverFile: `covered.webp`,
      }),
    ])
    const { id, version } = await bySlug(sql, `covered`)
    // What the editor sends for this post, parsed as `POST /admin/blog/posts/:id` parses it.
    const edit = parseBlogPostEdit({
      title: `Covered, edited`,
      slug: `covered`,
      description: `About covered.`,
      bodyMd: `Hello.`,
      coverUrl: null,
      coverAlt: `A seedling`,
    })
    const saved = await blog.update(id, version, edit, false, maya)

    expect([saved.title, saved.coverFile, saved.coverAlt]).toEqual([
      `Covered, edited`,
      `covered.webp`,
      `A seedling`,
    ])
  })
})
