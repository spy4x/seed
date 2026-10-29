/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { OutboxEvent } from "@spy4x/server/outbox"
import {
  BLOG_AUDIT_KINDS,
  BLOG_PUBLISH_JOB,
  BlogError,
  type BlogPostFields,
  BlogVersionConflictError,
} from "@domain/blog"
import { type BlogActor, PostgresBlogRepository } from "@server/blog/postgres-blog-repository.ts"
import { blogPublishJob, queueDueBlogJobs } from "@server/blog/blog-publish-job.ts"
import {
  listPublicFeed,
  listPublicPosts,
  listPublicTopics,
  readPublicPost,
} from "@server/blog/public-blog.ts"
import { SAMPLE_POSTS, seedSamplePosts } from "@server/blog/sample-posts.ts"
import { SUBSCRIBER_SEND_ISSUE_JOB } from "@server/jobs/subscriber-mail.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import { cancelJob, runJobNow } from "@server/jobs/admin-jobs.ts"
import { AdminJobActionOutcome } from "@domain/identity"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
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

/** Runs every due outbox row once, as the worker does, with the newsletter set up. */
async function drain(sql: postgres.Sql): Promise<void> {
  const processor = createOutboxProcessor(
    sql,
    { store: createPostgresAuthStore(sql), sender: null, brand: BRAND, log: () => {} },
    null,
    SETUP,
  )
  await processor.drainOnce()
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
    expect(found!.post.html).not.toContain(`<b>`)
    expect(found!.readNext).toEqual([])
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

Deno.test(`blog: a scheduled post goes live through its job, and is emailed once ever`, async (t) => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const id = uuidV7()
    const job = blogPublishJob({ sql, brand: BRAND, setup: SETUP, log: () => {} })
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
      const processor = createOutboxProcessor(
        sql,
        {
          store: createPostgresAuthStore(sql),
          sender: null,
          brand: BRAND,
          log: () => {},
        },
        null,
        SETUP,
      )
      await processor.drainOnce()

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
      const [email, language] of [[`ada@example.com`, null], [`bob@example.com`, `de`], [
        `cat@example.com`,
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
    const processor = createOutboxProcessor(
      sql,
      { store: createPostgresAuthStore(sql), sender, brand: BRAND, log: () => {} },
      null,
      SETUP,
    )
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
    expect(byIssue(`Hallo`).map((mail) => mail.to)).toEqual([`bob@example.com`])
    expect(byIssue(`Hallo`)[0].text).toContain(`Beitrag lesen`)
    expect(byIssue(`Hallo`)[0].text).toContain(`Du bekommst diese Mail`)
    expect(byIssue(`Hallo`)[0].text).toContain(`Abbestellen`)
    expect(byIssue(`Hallo`)[0].text).not.toContain(`Unsubscribe`)
    expect(byIssue(`Hallo`)[0].text).not.toContain(`Read the post`)
    expect(byIssue(`Hallo`)[0].text).toContain(`https://www.example.com/de/blog/hallo`)
    expect(byIssue(`Hello`).map((mail) => mail.to)).toEqual([`ada@example.com`])
    expect(byIssue(`Hello`)[0].text).toContain(`Read the post`)
    expect(sent.map((mail) => mail.to)).not.toContain(`cat@example.com`)
  })
})

Deno.test(`blog: a job left over from an earlier time does not publish early`, async () => {
  await withSchema(async (sql) => {
    const blog = new PostgresBlogRepository(sql)
    const maya = await operator(sql)
    const job = blogPublishJob({ sql, brand: BRAND, setup: SETUP, log: () => {} })
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

    await blogPublishJob({ sql, brand: BRAND, setup: null, log: (line) => lines.push(line) })(
      jobEvent(id),
    )

    expect(await blog.get(id)).toMatchObject({ status: `published`, newsletterSentAt: null })
    expect(await issues(sql, id)).toEqual({ rows: 0, jobs: 0 })
    expect(lines).toHaveLength(1)
  })
})

Deno.test(`blog: lost jobs come back once, and the sample posts seed once`, async () => {
  await withSchema(async (sql) => {
    const maya = await operator(sql)
    const now = new Date()
    expect(await seedSamplePosts(sql, maya.userId, now)).toBe(SAMPLE_POSTS.length)
    expect(await seedSamplePosts(sql, maya.userId, now)).toBe(0)
    const published = await listPublicPosts(sql, null)
    // The published one in English, and its translation into each other language.
    expect(published.map((post) => `${post.language} ${post.slug}`).sort()).toEqual([
      `ar marhaban-bialalam`,
      `de hallo-welt`,
      `en hello-world`,
      `es hola-mundo`,
      `pt-BR ola-mundo`,
      `ru privet-mir`,
    ])

    // The demo's wipe empties the job table but keeps the posts.
    await sql`DELETE FROM outbox_events`
    expect(await queueDueBlogJobs(sql)).toBe(1)
    expect(await queueDueBlogJobs(sql)).toBe(0)
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
