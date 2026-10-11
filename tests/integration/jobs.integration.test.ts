/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  JobPublisher,
  OutboxProcessor,
  PostgresOutboxRepository,
  scheduleOutboxEvent,
} from "@spy4x/server/outbox"
import { JOB_AGGREGATE, JOB_AGGREGATE_ID, OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, scheduleNightlyJobs } from "@server/jobs/wiring.ts"
import {
  enqueuePasswordResetMail,
  removeStalePasswordResetRequests,
} from "@server/jobs/password-reset-mail.ts"
import { enqueueEmailCodeMail, removeStaleEmailCodeRequests } from "@server/jobs/email-code-mail.ts"
import { emailChanges } from "@server/auth/email-verification.ts"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

const JOB = {
  eventKind: OUTBOX_CLEANUP_JOB,
  aggregateType: JOB_AGGREGATE,
  aggregateId: JOB_AGGREGATE_ID,
}

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `jobs_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/**
 * Moves every stored time `minutes` into the past. The claim reads the database clock, so this is
 * what the clock reaching those times looks like.
 */
async function advanceClock(sql: postgres.Sql, minutes: number): Promise<void> {
  await sql`
    UPDATE outbox_events
    SET available_at = available_at - make_interval(mins => ${minutes}),
        processed_at = processed_at - make_interval(mins => ${minutes})
  `
}

const BRAND = { webAppUrl: "http://app.localhost" }

/** The reset mail settings of a worker whose mail is off. */
function mailOff(sql: postgres.Sql) {
  return { store: createPostgresAuthStore(sql), sender: null, brand: BRAND, log: () => {} }
}

/** A sender that keeps what it is given, and fails while `failing` is set. */
function recordingSender(): EmailSender & { sent: EmailMessage[]; failing: boolean } {
  const sender = {
    sent: [] as EmailMessage[],
    failing: false,
    send(message: EmailMessage) {
      if (sender.failing) return Promise.resolve({ ok: false as const, error: "refused" })
      sender.sent.push(message)
      return Promise.resolve({ ok: true as const, id: String(sender.sent.length) })
    },
  }
  return sender as unknown as EmailSender & { sent: EmailMessage[]; failing: boolean }
}

Deno.test("password reset mails go through the worker's queue", async (t) => {
  await withSchema(async (sql) => {
    const store = createPostgresAuthStore(sql)
    await store.createUserWithKey({
      method: PASSWORD_METHOD,
      subject: "ann@example.com",
      email: "ann@example.com",
      secret: "hash",
      provenAt: null,
    })
    const count = async (table: string) =>
      (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)}`)[0].count

    await t.step(
      "only the address an account uses gets a mail, and no code is stored",
      async () => {
        const sender = recordingSender()
        const processor = createOutboxProcessor(sql, { store, sender, brand: BRAND, log: () => {} })
        await enqueuePasswordResetMail(sql, "ann@example.com")
        await enqueuePasswordResetMail(sql, "nobody@example.com")
        expectVersion7Ids(await sql<{ id: string }[]>`SELECT id FROM password_reset_requests`)

        const result = await processor.drainOnce()

        expect({ published: result.published, failed: result.failed }).toEqual({
          published: 2,
          failed: 0,
        })
        expect(sender.sent.map((mail) => mail.to)).toEqual(["ann@example.com"])
        const code = new URL(sender.sent[0].text!.match(/http\S+/)![0]).searchParams.get("code")!
        expect(code.length).toBeGreaterThan(40)
        const dump = JSON.stringify(
          await sql`
          SELECT (SELECT json_agg(c) FROM auth_challenges c) AS challenges,
            (SELECT json_agg(o) FROM outbox_events o) AS outbox
        `,
        )
        expect(dump).not.toContain(code)
        expect(await count("password_reset_requests")).toBe(0)
      },
    )

    await t.step("a failed send keeps the request and is retried", async () => {
      const sender = recordingSender()
      sender.failing = true
      const logged: string[] = []
      const processor = createOutboxProcessor(sql, {
        store,
        sender,
        brand: BRAND,
        log: (line) => logged.push(line),
      })
      await enqueuePasswordResetMail(sql, "ann@example.com")

      expect((await processor.drainOnce()).failed).toBe(1)
      expect(await count("password_reset_requests")).toBe(1)
      expect(logged.join("\n")).not.toContain("ann@example.com")

      sender.failing = false
      await advanceClock(sql, 60)
      expect((await processor.drainOnce()).published).toBe(1)
      expect(sender.sent.length).toBe(1)
      expect(await count("password_reset_requests")).toBe(0)
    })

    await t.step("with mail off the request is dropped and nothing is issued", async () => {
      await sql`DELETE FROM auth_challenges`
      await enqueuePasswordResetMail(sql, "ann@example.com")

      expect((await createOutboxProcessor(sql, mailOff(sql)).drainOnce()).published).toBe(1)

      expect(await count("auth_challenges")).toBe(0)
      expect(await count("password_reset_requests")).toBe(0)
    })

    await t.step("a request older than a day is removed by the cleanup", async () => {
      await sql`
        INSERT INTO password_reset_requests (id, email, created_at) VALUES
          (${uuidV7()}, 'old@example.com', now() - interval '25 hours'),
          (${uuidV7()}, 'new@example.com', now() - interval '23 hours')
      `

      expect(await removeStalePasswordResetRequests(sql)).toBe(1)
      const left = await sql<{ email: string }[]>`SELECT email FROM password_reset_requests`
      expect(left.map((row) => row.email)).toEqual(["new@example.com"])
    })
  })
})

Deno.test("e-mail code mails go through the worker's queue", async (t) => {
  await withSchema(async (sql) => {
    const store = createPostgresAuthStore(sql)
    const { user } = await store.createUserWithKey({
      method: PASSWORD_METHOD,
      subject: "ann@example.com",
      email: "ann@example.com",
      secret: "hash",
      provenAt: null,
    })
    const count = async (table: string) =>
      (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)}`)[0].count

    await t.step("the address to prove gets a code, and only its hash is stored", async () => {
      const sender = recordingSender()
      const processor = createOutboxProcessor(sql, { store, sender, brand: BRAND, log: () => {} })
      await enqueueEmailCodeMail(sql, user.id, "ann@example.com")
      expectVersion7Ids(await sql<{ id: string }[]>`SELECT id FROM email_code_requests`)

      expect((await processor.drainOnce()).published).toBe(1)

      expect(sender.sent.map((mail) => mail.to)).toEqual(["ann@example.com"])
      const code = sender.sent[0].text!.split("\n\n")[1]
      expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/)
      const dump = JSON.stringify(
        await sql`
          SELECT (SELECT json_agg(c) FROM auth_challenges c) AS challenges,
            (SELECT json_agg(o) FROM outbox_events o) AS outbox
        `,
      )
      expect(dump).not.toContain(code)
      expect(await count("email_code_requests")).toBe(0)
    })

    await t.step("a request for an address that no longer needs a code sends nothing", async () => {
      const sender = recordingSender()
      const processor = createOutboxProcessor(sql, { store, sender, brand: BRAND, log: () => {} })
      // The person asked to move to a new address since: the old one is no longer the one to prove.
      await emailChanges(sql).save(user.id, "new@example.com")
      await enqueueEmailCodeMail(sql, user.id, "ann@example.com")
      await enqueueEmailCodeMail(sql, user.id, "new@example.com")

      expect((await processor.drainOnce()).published).toBe(2)

      expect(sender.sent.map((mail) => mail.to)).toEqual(["new@example.com"])
      expect(await count("email_code_requests")).toBe(0)
      await emailChanges(sql).remove(user.id)
    })

    await t.step("a failed send keeps the request, is retried, and logs no address", async () => {
      const sender = recordingSender()
      sender.failing = true
      const logged: string[] = []
      const processor = createOutboxProcessor(sql, {
        store,
        sender,
        brand: BRAND,
        log: (line) => logged.push(line),
      })
      await enqueueEmailCodeMail(sql, user.id, "ann@example.com")

      expect((await processor.drainOnce()).failed).toBe(1)
      expect(await count("email_code_requests")).toBe(1)
      expect(logged.join("\n")).not.toContain("ann@example.com")

      sender.failing = false
      await advanceClock(sql, 60)
      expect((await processor.drainOnce()).published).toBe(1)
      expect(sender.sent.length).toBe(1)
      expect(await count("email_code_requests")).toBe(0)
    })

    await t.step("with mail off the request is dropped", async () => {
      await sql`DELETE FROM auth_challenges`
      await enqueueEmailCodeMail(sql, user.id, "ann@example.com")

      expect((await createOutboxProcessor(sql, mailOff(sql)).drainOnce()).published).toBe(1)

      expect(await count("auth_challenges")).toBe(0)
      expect(await count("email_code_requests")).toBe(0)
    })

    await t.step("a request older than a day is removed by the cleanup", async () => {
      await sql`
        INSERT INTO email_code_requests (id, user_id, email, created_at) VALUES
          (${uuidV7()}, ${user.id}, 'old@example.com', now() - interval '25 hours'),
          (${uuidV7()}, ${user.id}, 'new@example.com', now() - interval '23 hours')
      `

      expect(await removeStaleEmailCodeRequests(sql)).toBe(1)
      const left = await sql<{ email: string }[]>`SELECT email FROM email_code_requests`
      expect(left.map((row) => row.email)).toEqual(["new@example.com"])
    })
  })
})

Deno.test("delayed and repeating jobs in Postgres", async (t) => {
  await withSchema(async (sql) => {
    await t.step("a job scheduled for later runs at its time and not before", async () => {
      const ran: string[] = []
      const processor = new OutboxProcessor(
        new PostgresOutboxRepository(sql),
        new JobPublisher({
          aggregateType: JOB_AGGREGATE,
          handlers: { [OUTBOX_CLEANUP_JOB]: () => Promise.resolve(void ran.push("ran")) },
          fallback: { publish: () => Promise.resolve() },
        }),
      )
      await scheduleOutboxEvent(sql, JOB, { inMs: 60 * 60_000 })

      expect((await processor.drainOnce()).claimed).toBe(0)
      await advanceClock(sql, 30)
      expect((await processor.drainOnce()).claimed).toBe(0)
      expect(ran).toEqual([])

      await advanceClock(sql, 31)
      expect((await processor.drainOnce()).published).toBe(1)
      expect(ran).toEqual(["ran"])
    })

    await sql`DELETE FROM outbox_events`

    await t.step("a failing job backs off, then stops with its error stored", async () => {
      const processor = new OutboxProcessor(
        new PostgresOutboxRepository(sql),
        new JobPublisher({
          aggregateType: JOB_AGGREGATE,
          handlers: { [OUTBOX_CLEANUP_JOB]: () => Promise.reject(new TypeError("down")) },
          fallback: { publish: () => Promise.resolve() },
        }),
        { maxAttempts: 3, baseRetryDelayMs: 60_000 },
      )
      await scheduleOutboxEvent(sql, JOB, { inMs: 0 })

      const waits: number[] = []
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect((await processor.drainOnce()).failed).toBe(1)
        const [row] = await sql<{ minutes: number }[]>`
          SELECT round(extract(epoch FROM available_at - now()) / 60)::int AS minutes
          FROM outbox_events
        `
        waits.push(row.minutes)
        await advanceClock(sql, row.minutes + 1)
      }
      expect(waits).toEqual([1, 2, 4])

      expect((await processor.drainOnce()).claimed).toBe(0)
      const [row] = await sql<{ lastErrorCode: string; processedAt: Date | null }[]>`
        SELECT last_error_code, processed_at FROM outbox_events
      `
      expect(row).toEqual({ lastErrorCode: "TypeError", processedAt: null })
    })

    await sql`DELETE FROM outbox_events`

    await t.step(
      "the nightly cleanup repeats itself and removes only old processed rows",
      async () => {
        const group = await sql<{ id: string; userId: number }[]>`
        WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
        u AS (INSERT INTO users (id) SELECT id FROM auth_user RETURNING id)
        SELECT u.id AS user_id, ${uuidV7()}::uuid AS id FROM u
      `
        const { id: groupId, userId } = group[0]
        await sql`
        INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
        VALUES (${groupId}, 'jobs fixture', ${userId}, ${userId})
      `
        const insertChange = (version: number, processed: string | null) =>
          sql`
          INSERT INTO outbox_events (
            id, event_kind, aggregate_type, aggregate_id, aggregate_version, group_id,
            actor_user_id, processed_at
          ) VALUES (
            ${uuidV7()}, 'group.created', 'group', ${groupId}, ${version}, ${groupId},
            ${userId}, ${processed === null ? null : sql`now() - ${processed}::interval`}
          )
        `
        await insertChange(1, "8 days") // old and processed: removed
        await insertChange(2, "1 day") // recent and processed: kept
        await insertChange(3, null) // not processed: kept

        // The worker's own start-up and processor, so what the worker wires is what is tested.
        await scheduleNightlyJobs(sql, new Date())
        await scheduleNightlyJobs(sql, new Date())
        const [{ count: queued }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}
        `
        expect(queued).toBe(1)

        await advanceClock(sql, 25 * 60)
        const result = await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
        expect(result.failed).toBe(0)

        const versions = await sql<{ version: string }[]>`
        SELECT aggregate_version::text AS version FROM outbox_events
        WHERE aggregate_type = 'group' ORDER BY aggregate_version
      `
        expect(versions.map((row) => row.version)).toEqual(["2", "3"])

        const [next] = await sql<{ hours: number; count: number }[]>`
        SELECT round(extract(epoch FROM available_at - now()) / 3600)::int AS hours,
          (SELECT count(*)::int FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}) AS count
        FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
      `
        expect(next).toEqual({ hours: 24, count: 2 })
      },
    )

    await t.step(
      "the nightly cleanup removes a group deleted over 30 days ago and keeps a recent one",
      async () => {
        const [{ userId }] = await sql<{ userId: number }[]>`
          WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
          INSERT INTO users (id) SELECT id FROM auth_user RETURNING id AS user_id
        `
        const insertDeleted = async (name: string, days: number) => {
          const id = uuidV7()
          await sql`
            INSERT INTO groups (id, name, owner_user_id, created_by_user_id, deleted_at)
            VALUES (${id}, ${name}, ${userId}, ${userId}, now() - make_interval(days => ${days}))
          `
          return id
        }
        await insertDeleted("expired", 31)
        const recent = await insertDeleted("recent", 29)

        await advanceClock(sql, 25 * 60)
        const result = await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
        expect(result.failed).toBe(0)

        const names = await sql<{ name: string; id: string }[]>`
          SELECT name, id FROM groups WHERE deleted_at IS NOT NULL
        `
        expect(names).toEqual([{ name: "recent", id: recent }])
      },
    )

    await t.step(
      "the nightly cleanup removes an invitation dead over 30 days and keeps a recent one",
      async () => {
        const [{ userId }] = await sql<{ userId: number }[]>`
          WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
          INSERT INTO users (id) SELECT id FROM auth_user RETURNING id AS user_id
        `
        const groupId = uuidV7()
        await sql`
          INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
          VALUES (${groupId}, 'invitation fixture', ${userId}, ${userId})
        `
        const insertExpired = async (days: number) => {
          const id = uuidV7()
          await sql`
            INSERT INTO group_invitations (id, group_id, token_hash, role, created_by_user_id, expires_at)
            VALUES (${id}, ${groupId}, ${id.replaceAll("-", "").repeat(2)}, 1, ${userId},
              now() - make_interval(days => ${days}))
          `
          return id
        }
        await insertExpired(31)
        const recent = await insertExpired(29)

        await advanceClock(sql, 25 * 60)
        const result = await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
        expect(result.failed).toBe(0)

        const left = await sql<{ id: string }[]>`SELECT id FROM group_invitations`
        expect(left).toEqual([{ id: recent }])
      },
    )

    await t.step("a row names both its group and its actor, or neither", async () => {
      const [{ groupId, userId }] = await sql<{ groupId: string; userId: number }[]>`
        WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
        u AS (INSERT INTO users (id) SELECT id FROM auth_user RETURNING id)
        SELECT u.id AS user_id, ${uuidV7()}::uuid AS group_id FROM u
      `
      await sql`
        INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
        VALUES (${groupId}, 'check fixture', ${userId}, ${userId})
      `
      const insert = (group: string | null, actor: number | null, version: number) =>
        sql`
          INSERT INTO outbox_events (
            id, event_kind, aggregate_type, aggregate_id, aggregate_version, group_id,
            actor_user_id
          ) VALUES (
            ${uuidV7()}, 'group.created', 'group', ${groupId}, ${version}, ${group},
            ${actor}
          )
        `
      await expect(insert(groupId, null, 1)).rejects.toThrow("outbox_events_group_actor_check")
      await expect(insert(null, userId, 2)).rejects.toThrow("outbox_events_group_actor_check")
      await insert(groupId, userId, 3)
      await insert(null, null, 4)
    })
  })
})
