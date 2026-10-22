/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  ADMIN_JOB_CANCELLED_KIND,
  ADMIN_JOB_NO_FILTER,
  ADMIN_JOB_RETRIED_KIND,
  ADMIN_JOB_RUN_NOW_KIND,
  AdminJobActionOutcome,
  AdminJobState,
  UserRole,
} from "@domain/identity"
import { JOB_AGGREGATE, JOB_AGGREGATE_ID } from "@server/jobs/jobs.ts"
import { readJob } from "@server/jobs/admin-jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's Jobs module (#394) against a real Postgres with every migration applied: the
 * state each row reads as, the list's counts and search, and run again, run now and cancel with
 * their guards and audit rows.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_jobs_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 4,
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

async function operator(sql: postgres.Sql): Promise<number> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, role) SELECT id, ${UserRole.OPERATOR} FROM auth_user RETURNING id
  `
  return id
}

interface Row {
  kind?: string
  type?: string
  aggregateId?: string
  version?: number
  available?: string
  claimed?: string | null
  processed?: string | null
  cancelled?: string | null
  error?: string | null
  attempts?: number
}

/** One outbox row; times are SQL intervals from now, such as `-10 minutes`. */
async function outbox(sql: postgres.Sql, row: Row = {}): Promise<string> {
  const id = uuidV7()
  const at = (offset: string | null | undefined) =>
    offset == null ? null : sql`now() + ${offset}::interval`
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at, claimed_at,
      processed_at, cancelled_at, last_error_code, attempt_count
    ) VALUES (
      ${id}, ${row.kind ?? "auth.password-reset-mail"}, ${row.type ?? JOB_AGGREGATE},
      ${row.aggregateId ?? uuidV7()}, ${row.version ?? 1}, ${at(row.available ?? "0 seconds")},
      ${at(row.claimed)}, ${at(row.processed)}, ${at(row.cancelled)}, ${row.error ?? null},
      ${row.attempts ?? 0}
    )
  `
  return id
}

/** A row the worker gave up: closed with its error's name. */
const failed: Row = { processed: "-1 hour", error: "MailSendError", attempts: 20 }
/** A row a worker holds: claimed now, hidden for exactly one lease. */
const running: Row = { claimed: "0 seconds", available: "60 seconds", attempts: 1 }

async function state(sql: postgres.Sql, id: string) {
  return (await readJob(sql, id))?.state
}

async function audits(sql: postgres.Sql) {
  return await sql`
    SELECT event_kind, actor_user_id, request_id, entity_type, entity_id, details
    FROM audit_events ORDER BY id
  `
}

Deno.test("jobs: reads each row's state from its columns", async () => {
  await withSchema(async (sql) => {
    const rows: [Row, AdminJobState][] = [
      [{ available: "1 day" }, AdminJobState.Scheduled],
      [{ available: "-1 minute" }, AdminJobState.Due],
      [running, AdminJobState.Running],
      // A retry's back-off is no lease, even when it lies in the future after a claim.
      [
        { claimed: "-1 minute", available: "2 minutes", error: "Boom", attempts: 2 },
        AdminJobState.Retrying,
      ],
      // A claim whose lease ran out with no answer is due again.
      [{ claimed: "-2 minutes", available: "-1 minute", attempts: 1 }, AdminJobState.Due],
      [failed, AdminJobState.Failed],
      // An older worker gave up without closing the row.
      [{ attempts: 20, error: "Boom", available: "-1 hour" }, AdminJobState.Failed],
      [{ processed: "-1 hour" }, AdminJobState.Done],
      [{ processed: "-1 hour", cancelled: "-1 hour" }, AdminJobState.Cancelled],
    ]
    for (const [row, expected] of rows) {
      expect({ row, state: await state(sql, await outbox(sql, row)) }).toEqual({
        row,
        state: expected,
      })
    }
  })
})

Deno.test("jobs: lists job rows newest first with each chip's count, never a group change", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await outbox(sql, failed)
    await outbox(sql, { kind: "outbox.cleanup", available: "1 day" })
    await outbox(sql, { available: "-1 minute" })
    await outbox(sql, { kind: "note.created", type: "note", ...failed })
    const newest = await outbox(sql, { processed: "-1 minute" })

    const all = await db.adminJobs.list(ADMIN_JOB_NO_FILTER, null)
    expect(all.jobs.map((job) => job.id)[0]).toBe(newest)
    expect(all.total).toBe(4)
    expect(all.counts).toEqual({
      all: 4,
      failed: 1,
      retrying: 0,
      scheduled: 2,
      running: 0,
      done: 1,
      cancelled: 0,
    })
    // Only these columns leave the store: never a payload or an error message.
    expect(Object.keys(all.jobs[0]).sort()).toEqual([
      "aggregateId",
      "attempts",
      "createdAt",
      "dueAt",
      "errorCode",
      "finishedAt",
      "id",
      "kind",
      "maxAttempts",
      "startedAt",
      "state",
    ])

    const failedOnly = await db.adminJobs.list({ ...ADMIN_JOB_NO_FILTER, state: "failed" }, null)
    expect(failedOnly.jobs.map((job) => job.errorCode)).toEqual(["MailSendError"])
    const searched = await db.adminJobs.list(
      { ...ADMIN_JOB_NO_FILTER, query: "clean" },
      { kinds: [], text: "clean" },
    )
    expect(searched.jobs.map((job) => job.kind)).toEqual(["outbox.cleanup"])
    expect(searched.counts.all).toBe(1)
    // A search's wildcards are text.
    const literal = await db.adminJobs.list(ADMIN_JOB_NO_FILTER, { kinds: [], text: "%" })
    expect(literal.total).toBe(0)
  })
})

Deno.test("jobs: cancels a waiting job once, with its audit row, and never a running one", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const cancel = (id: string) => db.begin((tx) => tx.adminJobs.cancel(id, op, "req-1"))
    const waiting = await outbox(sql, { available: "1 day" })
    const busy = await outbox(sql, running)
    const done = await outbox(sql, { processed: "-1 hour" })
    const change = await outbox(sql, { type: "note", available: "1 day" })

    expect(await cancel(waiting)).toBe(AdminJobActionOutcome.Done)
    expect(await state(sql, waiting)).toBe(AdminJobState.Cancelled)
    expect(await cancel(waiting)).toBe(AdminJobActionOutcome.NotFound)
    expect(await cancel(busy)).toBe(AdminJobActionOutcome.NotFound)
    expect(await cancel(done)).toBe(AdminJobActionOutcome.NotFound)
    expect(await cancel(change)).toBe(AdminJobActionOutcome.NotFound)
    expect(await state(sql, busy)).toBe(AdminJobState.Running)
    expect(await audits(sql)).toEqual([{
      eventKind: ADMIN_JOB_CANCELLED_KIND,
      actorUserId: op,
      requestId: "req-1",
      entityType: "job",
      entityId: waiting,
      details: { kind: "auth.password-reset-mail" },
    }])
  })
})

Deno.test("jobs: runs a waiting job now by moving its time, writing no second row", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const runNow = (id: string) => db.begin((tx) => tx.adminJobs.runNow(id, op, null))
    const waiting = await outbox(sql, { kind: "outbox.cleanup", available: "1 day" })
    const busy = await outbox(sql, running)

    expect(await runNow(waiting)).toBe(AdminJobActionOutcome.Done)
    expect(await state(sql, waiting)).toBe(AdminJobState.Due)
    expect(await runNow(busy)).toBe(AdminJobActionOutcome.NotFound)
    expect(await sql`SELECT 1 FROM outbox_events`).toHaveLength(2)
    expect((await audits(sql)).map((row) => row.eventKind)).toEqual([ADMIN_JOB_RUN_NOW_KIND])
  })
})

Deno.test("jobs: runs a repeating job now on its one chain, and starts a cancelled chain again", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const runNow = () => db.begin((tx) => tx.adminJobs.runRepeatingNow("outbox.cleanup", op, null))
    const chain = { kind: "outbox.cleanup", aggregateId: JOB_AGGREGATE_ID }
    const next = await outbox(sql, { ...chain, available: "1 day" })

    expect(await runNow()).toEqual({ outcome: AdminJobActionOutcome.Done, id: next })
    expect(await runNow()).toEqual({ outcome: AdminJobActionOutcome.Done, id: next })
    expect(await sql`SELECT 1 FROM outbox_events`).toHaveLength(1)

    await sql`UPDATE outbox_events SET processed_at = now(), cancelled_at = now()`
    const started = await runNow()
    expect(started.outcome).toBe(AdminJobActionOutcome.Done)
    expect(started.id).not.toBe(next)
    expect(await sql`SELECT 1 FROM outbox_events WHERE processed_at IS NULL`).toHaveLength(1)

    // While a worker holds the run, nothing moves and nothing is written.
    await sql`UPDATE outbox_events SET claimed_at = now(), available_at = now() + interval '60 seconds'
      WHERE processed_at IS NULL`
    expect((await runNow()).outcome).toBe(AdminJobActionOutcome.Superseded)
    expect(await sql`SELECT 1 FROM outbox_events`).toHaveLength(2)
    expect(await audits(sql)).toHaveLength(3)
  })
})

Deno.test("jobs: two presses of run now on a stopped repeating job start one chain", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const runNow = (tx: AppDbBase) => tx.adminJobs.runRepeatingNow("outbox.cleanup", op, null)
    let second: Promise<{ outcome: AdminJobActionOutcome; id: string | null }> | null = null
    let first: string | null = null
    await db.begin(async (tx) => {
      first = (await runNow(tx)).id
      // The second press looks for a waiting run while the first's is not committed yet.
      second = db.begin(runNow)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(await second).toEqual({ outcome: AdminJobActionOutcome.Done, id: first })
    expect(await sql`SELECT 1 FROM outbox_events WHERE processed_at IS NULL`).toHaveLength(1)
  })
})

Deno.test("jobs: the nightly cleanup run now, or cancelled and restarted, waits for the next 03:00 UTC", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const mail = { store: createPostgresAuthStore(sql), sender: null, brand: { webAppUrl: `` } }
    const processor = createOutboxProcessor(sql, { ...mail, log: () => {} })
    const waiting = () =>
      sql<{ id: string; at3: boolean; ahead: boolean }[]>`
        SELECT id, to_char(available_at AT TIME ZONE 'UTC', 'HH24:MI') = '03:00' AS at3,
          available_at > now() AS ahead
        FROM outbox_events WHERE event_kind = 'outbox.cleanup' AND processed_at IS NULL
      `
    await startRepeatingJobs(sql)
    expect(await waiting()).toEqual([{ id: expect.any(String), at3: true, ahead: true }])

    await db.begin((tx) => tx.adminJobs.runRepeatingNow("outbox.cleanup", op, null))
    expect(await processor.drainOnce()).toEqual({ claimed: 1, published: 1, failed: 0 })
    const [next] = await waiting()
    expect(next).toEqual({ id: expect.any(String), at3: true, ahead: true })

    // Cancelled before it ran, the chain starts again at the worker's next start.
    expect(await db.begin((tx) => tx.adminJobs.cancel(next.id, op, null)))
      .toBe(AdminJobActionOutcome.Done)
    await startRepeatingJobs(sql)
    const [restarted] = await waiting()
    expect(restarted).toEqual({ id: expect.any(String), at3: true, ahead: true })

    // Run now from the run's own page does the same.
    expect(await db.begin((tx) => tx.adminJobs.runNow(restarted.id, op, null)))
      .toBe(AdminJobActionOutcome.Done)
    expect(await processor.drainOnce()).toEqual({ claimed: 1, published: 1, failed: 0 })
    expect(await waiting()).toEqual([{ id: expect.any(String), at3: true, ahead: true }])
  })
})

Deno.test("jobs: running a failed job again resets it and writes the operator's audit row", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const id = await outbox(sql, { ...failed, claimed: "-1 hour" })
    const db = new AppDbBase({ sql })
    const outcome = await db.begin((tx) => tx.adminJobs.retry(id, op, "req-9"))

    expect(outcome).toBe(AdminJobActionOutcome.Done)
    const [row] = await sql`
      SELECT processed_at, claimed_at, last_error_code, attempt_count,
        available_at <= now() AS due
      FROM outbox_events WHERE id = ${id}
    `
    expect(row).toEqual({
      processedAt: null,
      claimedAt: null,
      lastErrorCode: null,
      attemptCount: 0,
      due: true,
    })
    expect(await audits(sql)).toEqual([{
      eventKind: ADMIN_JOB_RETRIED_KIND,
      actorUserId: op,
      requestId: "req-9",
      entityType: "job",
      entityId: id,
      details: { kind: "auth.password-reset-mail" },
    }])
    // Run again already: the second press finds no failed job and writes nothing.
    expect(await db.begin((tx) => tx.adminJobs.retry(id, op, null))).toBe(
      AdminJobActionOutcome.NotFound,
    )
    expect(await audits(sql)).toHaveLength(1)
  })
})

Deno.test("jobs: refuses to run again a group change, a live, done, cancelled or superseded job", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const retry = (id: string) => db.begin((tx) => tx.adminJobs.retry(id, op, null))
    const change = await outbox(sql, { ...failed, type: "note" })
    const live = await outbox(sql)
    const done = await outbox(sql, { processed: "-1 hour" })
    const cancelled = await outbox(sql, { ...failed, cancelled: "-1 hour" })
    const chain = uuidV7()
    const superseded = await outbox(sql, { ...failed, aggregateId: chain })
    await outbox(sql, { aggregateId: chain, version: 2, available: "1 day" })

    expect(await retry(change)).toBe(AdminJobActionOutcome.NotFound)
    expect(await retry(live)).toBe(AdminJobActionOutcome.NotFound)
    expect(await retry(done)).toBe(AdminJobActionOutcome.NotFound)
    expect(await retry(cancelled)).toBe(AdminJobActionOutcome.NotFound)
    expect(await retry(uuidV7())).toBe(AdminJobActionOutcome.NotFound)
    expect(await retry(superseded)).toBe(AdminJobActionOutcome.Superseded)
    expect(await audits(sql)).toEqual([])
    const [row] = await sql`SELECT processed_at FROM outbox_events WHERE id = ${superseded}`
    expect(row.processedAt).not.toBeNull()
  })
})

Deno.test("jobs: a second run again while the first is uncommitted waits, then finds nothing", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const id = await outbox(sql, failed)
    let second: Promise<AdminJobActionOutcome> | null = null
    await db.begin(async (tx) => {
      expect(await tx.adminJobs.retry(id, op, null)).toBe(AdminJobActionOutcome.Done)
      // The second press reads the row while the first has not committed yet.
      second = db.begin((other) => other.adminJobs.retry(id, op, null))
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(await second).toBe(AdminJobActionOutcome.NotFound)
    expect(await audits(sql)).toHaveLength(1)
  })
})

Deno.test("jobs: runs every failed job again once, one per chain, with an audit row each", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const chain = uuidV7()
    await outbox(sql, failed)
    await outbox(sql, { attempts: 20, error: "Boom", available: "-1 hour" })
    await outbox(sql, { ...failed, aggregateId: chain })
    await outbox(sql, { ...failed, aggregateId: chain, version: 2 })

    expect(await db.begin((tx) => tx.adminJobs.retryAll(op, null, 500))).toBe(3)
    expect(await audits(sql)).toHaveLength(3)
    expect(await db.begin((tx) => tx.adminJobs.retryAll(op, null, 500))).toBe(0)
  })
})

Deno.test("jobs: names the person a job is about through its request row", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    const person = await operator(sql)
    await sql`UPDATE users SET first_name = 'Ada', last_name = 'Lovelace' WHERE id = ${person}`
    const request = uuidV7()
    await sql`INSERT INTO starter_data_requests (id, user_id) VALUES (${request}, ${person})`

    expect(await db.adminJobs.user("starter_data_requests", request)).toEqual({
      id: person,
      name: "Ada Lovelace",
    })
    expect(await db.adminJobs.user("starter_data_requests", uuidV7())).toBeNull()
  })
})
