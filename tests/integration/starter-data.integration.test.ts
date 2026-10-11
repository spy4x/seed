/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import {
  scheduleStarterData,
  starterDataJob,
  WELCOME_NOTE_TITLE,
} from "@server/jobs/starter-data.ts"
import { entitlementsOf, FREE_PLAN_ID } from "@domain/billing"
import { JOB_AGGREGATE } from "@server/jobs/jobs.ts"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `starter_test_${uuidV7().replaceAll("-", "")}`
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

/** A person with a first group, as sign-up leaves them. */
async function signedUpPerson(sql: postgres.Sql, groupName = "Personal") {
  const [row] = await sql<{ userId: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id),
    u AS (INSERT INTO users (id) SELECT id FROM auth_user RETURNING id)
    SELECT id AS user_id FROM u
  `
  const groupId = uuidV7()
  await sql.begin((tx) =>
    new PostgresGroupRepository(tx).createFirst({ id: groupId, name: groupName }, row.userId)
  )
  return { userId: row.userId, groupId }
}

const notesOf = (sql: postgres.Sql, groupId: string) =>
  sql<{ title: string; body: string; createdByUserId: number }[]>`
    SELECT title, body, created_by_user_id FROM notes WHERE group_id = ${groupId}
  `

const mailOff = (sql: postgres.Sql) => ({
  store: createPostgresAuthStore(sql),
  sender: null,
  brand: { webAppUrl: "http://app.localhost" },
  log: () => {},
})

Deno.test("a new account gets one welcome note from the worker, however often the job runs", async (t) => {
  await withSchema(async (sql) => {
    const { userId, groupId } = await signedUpPerson(sql)
    await sql.begin((tx) => scheduleStarterData(tx, userId))
    const [request] = await sql<{ id: string }[]>`SELECT id FROM starter_data_requests`

    await t.step(
      "the sign-up's transaction writes no note, only the request and the job",
      async () => {
        expect(await notesOf(sql, groupId)).toEqual([])
        expectVersion7Ids([request])
        const [job] = await sql<{ eventKind: string }[]>`SELECT event_kind FROM outbox_events
        WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${request.id}`
        expect(job.eventKind).toBe("onboarding.starter-data")
      },
    )

    await t.step("the worker creates the note in the first group, by the person", async () => {
      const result = await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
      expect(result.failed).toBe(0)
      const notes = await notesOf(sql, groupId)
      expect(notes.map((note) => note.title)).toEqual([WELCOME_NOTE_TITLE])
      expect(notes[0].createdByUserId).toBe(userId)
    })

    await t.step("a forced retry of the job adds no second note", async () => {
      const event = {
        aggregateType: JOB_AGGREGATE,
        aggregateId: request.id,
        eventKind: "onboarding.starter-data",
      } as OutboxEvent
      await starterDataJob(sql)(event)
      await starterDataJob(sql)(event)
      // The outbox row put back as unprocessed, as a crash after the commit would leave it.
      await sql`UPDATE outbox_events SET processed_at = NULL, available_at = now()
        WHERE aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${request.id}`
      await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
      expect(await notesOf(sql, groupId)).toHaveLength(1)
    })

    await t.step("a note the person deleted does not come back on a retry", async () => {
      await sql`UPDATE notes SET deleted_at = now() WHERE group_id = ${groupId}`
      await starterDataJob(sql)({
        aggregateType: JOB_AGGREGATE,
        aggregateId: request.id,
        eventKind: "onboarding.starter-data",
      } as OutboxEvent)
      expect(await sql`SELECT 1 FROM notes WHERE group_id = ${groupId} AND deleted_at IS NULL`)
        .toHaveLength(0)
    })
  })
})

Deno.test("the welcome note goes in the person's first group, and a request with no group is closed", async (t) => {
  await withSchema(async (sql) => {
    await t.step("with two groups, the older one gets it", async () => {
      const first = await signedUpPerson(sql, "Personal")
      const second = uuidV7()
      await new PostgresGroupRepository(sql).create({ id: second, name: "Team" }, first.userId)
      await sql.begin((tx) => scheduleStarterData(tx, first.userId))
      await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
      expect(await notesOf(sql, first.groupId)).toHaveLength(1)
      expect(await notesOf(sql, second)).toHaveLength(0)
    })

    await t.step(
      "a person whose group is gone gets no note and the job still succeeds",
      async () => {
        const person = await signedUpPerson(sql)
        await sql`UPDATE groups SET deleted_at = now() WHERE id = ${person.groupId}`
        await sql.begin((tx) => scheduleStarterData(tx, person.userId))
        const result = await createOutboxProcessor(sql, mailOff(sql)).drainOnce()
        expect(result.failed).toBe(0)
        expect(await notesOf(sql, person.groupId)).toHaveLength(0)
        const [row] = await sql<{ doneAt: Date | null }[]>`
        SELECT done_at FROM starter_data_requests WHERE user_id = ${person.userId}`
        expect(row.doneAt).not.toBeNull()
      },
    )
  })
})

/** The job's event for one request, as the outbox hands it over. */
/** The free plan's note cap, read from the plan, not copied. */
const FREE_NOTES = entitlementsOf(FREE_PLAN_ID, true).limits.maxNotes!

const eventOf = (requestId: string) =>
  ({
    aggregateType: JOB_AGGREGATE,
    aggregateId: requestId,
    eventKind: "onboarding.starter-data",
  }) as OutboxEvent

/** Queues a request for `userId` and returns its id. */
async function requestFor(sql: postgres.Sql, userId: number): Promise<string> {
  await sql.begin((tx) => scheduleStarterData(tx, userId))
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM starter_data_requests WHERE user_id = ${userId}`
  return row.id
}

Deno.test("the welcome note is made once after a crash between the note and its marker", async () => {
  await withSchema(async (sql) => {
    const { userId, groupId } = await signedUpPerson(sql)
    const requestId = await requestFor(sql, userId)
    await starterDataJob(sql)(eventOf(requestId))
    // The marker lost, as a crash after the note's commit and before `done_at` leaves it.
    await sql`UPDATE starter_data_requests SET done_at = NULL WHERE id = ${requestId}`

    await starterDataJob(sql)(eventOf(requestId))

    expect((await notesOf(sql, groupId)).map((note) => note.title)).toEqual([WELCOME_NOTE_TITLE])
    const [row] = await sql<{ doneAt: Date | null }[]>`
      SELECT done_at FROM starter_data_requests WHERE id = ${requestId}`
    expect(row.doneAt).not.toBeNull()
  })
})

Deno.test("four workers running the same job at once make one welcome note", async () => {
  await withSchema(async (sql) => {
    const { userId, groupId } = await signedUpPerson(sql)
    const requestId = await requestFor(sql, userId)

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => starterDataJob(sql)(eventOf(requestId))),
    )

    expect(results.map((result) => result.status)).toEqual(Array(4).fill("fulfilled"))
    expect(await notesOf(sql, groupId)).toHaveLength(1)
  })
})

Deno.test("the welcome note respects the group's plan cap", async (t) => {
  await withSchema(async (sql) => {
    const free = { billingEnabled: true }
    const fill = async (groupId: string, userId: number, count: number) => {
      for (let index = 0; index < count; index++) {
        await sql`
          INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id,
            updated_by_user_id)
          VALUES (${uuidV7()}, ${groupId}, ${`Note ${index}`}, '', 1, ${userId}, ${userId})`
      }
    }

    await t.step("takes the last free slot", async () => {
      const { userId, groupId } = await signedUpPerson(sql)
      await fill(groupId, userId, FREE_NOTES - 1)
      await starterDataJob(sql, free)(eventOf(await requestFor(sql, userId)))
      expect(await notesOf(sql, groupId)).toHaveLength(FREE_NOTES)
    })

    await t.step("a full group gets no note and the request is closed, not retried", async () => {
      const { userId, groupId } = await signedUpPerson(sql)
      await fill(groupId, userId, FREE_NOTES)
      const requestId = await requestFor(sql, userId)

      await starterDataJob(sql, free)(eventOf(requestId))

      expect(await notesOf(sql, groupId)).toHaveLength(FREE_NOTES)
      const [row] = await sql<{ doneAt: Date | null }[]>`
        SELECT done_at FROM starter_data_requests WHERE id = ${requestId}`
      expect(row.doneAt).not.toBeNull()
    })

    await t.step("with billing off nothing caps it", async () => {
      const { userId, groupId } = await signedUpPerson(sql)
      await fill(groupId, userId, FREE_NOTES)
      await starterDataJob(sql)(eventOf(await requestFor(sql, userId)))
      expect(await notesOf(sql, groupId)).toHaveLength(FREE_NOTES + 1)
    })
  })
})
