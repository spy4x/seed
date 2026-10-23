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
import type { SubscribersSetup } from "@server/subscribers/subscribers.ts"
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
    expect(published.map((post) => post.slug)).toEqual([`hello-world`])

    // The demo's wipe empties the job table but keeps the posts.
    await sql`DELETE FROM outbox_events`
    expect(await queueDueBlogJobs(sql)).toBe(1)
    expect(await queueDueBlogJobs(sql)).toBe(0)
  })
})

Deno.test(`blog: the admin reads the confirmed subscribers of every list`, async () => {
  await withSchema(async (sql) => {
    await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
      VALUES ('news', 'ada@example.com', 'k1', now()), ('other', 'bob@example.com', 'k2', now())`

    expect(await createAdminBlog(sql).confirmedSubscribers()).toEqual([
      { list: `news`, confirmed: 1 },
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
