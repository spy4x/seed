/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { type OutboxEvent, OutboxProcessor, PostgresOutboxRepository } from "@spy4x/server/outbox"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

interface CountRow extends postgres.Row {
  count: number
}

interface OutboxStateRow extends postgres.Row {
  id: string
  attemptCount: number
  lastErrorCode: string | null
  processedAt: Date | null
  claimedAt: Date | null
  availableAt: Date
}

Deno.test({
  name: "outbox drain Postgres integration",
  async fn(t) {
    const connection = buildPostgresOptions(requireDbConnection())
    const admin = postgres({ ...connection, max: 1 })
    const schema = `outbox_test_${uuidV7().replace(/-/g, "")}`
    const sql = postgres({
      ...connection,
      max: 5,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
    })

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      await applyMigrations(sql)

      const userId = await seedUser(sql)
      const groupId = await seedGroup(sql, userId)
      const repository = new PostgresOutboxRepository(sql)

      await t.step("claims pending rows, marks them processed and does not reclaim", async () => {
        const first = await seedOutboxEvent(sql, groupId, userId, 1)
        const second = await seedOutboxEvent(sql, groupId, userId, 2)

        const published: string[] = []
        const processor = new OutboxProcessor(repository, {
          publish: (event: OutboxEvent) => {
            published.push(event.aggregateVersion)
            return Promise.resolve()
          },
        })

        expect(await processor.drainOnce()).toEqual({ claimed: 2, published: 2, failed: 0 })
        expect(published.sort()).toEqual(["1", "2"])

        // A second drain finds nothing: processed rows are never reclaimed.
        expect(await processor.drainOnce()).toEqual({ claimed: 0, published: 0, failed: 0 })

        for (const id of [first, second]) {
          const row = await outboxState(sql, id)
          expect(row.processedAt).not.toBe(null)
          expect(row.claimedAt).not.toBe(null)
          expect(row.attemptCount).toBe(1)
          expect(row.lastErrorCode).toBe(null)
        }
      })

      await t.step("reschedules a failed row into the future and records the error", async () => {
        const id = await seedOutboxEvent(sql, groupId, userId, 3)
        const processor = new OutboxProcessor(repository, {
          publish: () => Promise.reject(new TypeError("publisher down")),
        }, { baseRetryDelayMs: 60_000, maxRetryDelayMs: 300_000 })

        expect(await processor.drainOnce()).toEqual({ claimed: 1, published: 0, failed: 1 })

        const row = await outboxState(sql, id)
        expect(row.processedAt).toBe(null)
        expect(row.attemptCount).toBe(1)
        expect(row.lastErrorCode).toBe("TypeError")
        expect(row.availableAt.getTime()).toBeGreaterThan(Date.now())

        // Still backing off, so a fresh drain must not pick it up again.
        expect((await processor.drainOnce()).claimed).toBe(0)
      })

      await t.step("stops claiming a row once it exhausts its attempts", async () => {
        const id = await seedOutboxEvent(sql, groupId, userId, 4)
        const processor = new OutboxProcessor(repository, {
          publish: () => Promise.reject(new Error("still down")),
        }, { maxAttempts: 3, baseRetryDelayMs: 0, maxRetryDelayMs: 0 })

        for (let attempt = 0; attempt < 3; attempt++) {
          expect((await processor.drainOnce()).failed).toBe(1)
        }

        expect((await processor.drainOnce()).claimed).toBe(0)
        const row = await outboxState(sql, id)
        expect(row.attemptCount).toBe(3)
        expect(row.processedAt).toBe(null)
      })

      await t.step("keeps a claimed row invisible until its lease expires", async () => {
        await sql`DELETE FROM outbox_events`
        await seedOutboxEvent(sql, groupId, userId, 5)

        // Claim without reporting an outcome, exactly as a worker that is still
        // publishing - or one that died mid-publish - leaves the row.
        const claimed = await repository.claimBatch(10, 10, 60)
        expect(claimed.length).toBe(1)

        // Before the lease expires the row must not be handed to anyone else.
        expect((await repository.claimBatch(10, 10, 60)).length).toBe(0)

        // Once it expires the row is released rather than stranded.
        const expired = await repository.claimBatch(10, 10, -1)
        expect(expired.length).toBe(0)
        await sql`UPDATE outbox_events SET available_at = now() - INTERVAL '1 second'`
        expect((await repository.claimBatch(10, 10, 60)).length).toBe(1)
      })

      await t.step("hands each row to exactly one of four concurrent drains", async () => {
        await sql`DELETE FROM outbox_events`
        const ids: string[] = []
        for (let version = 10; version < 30; version++) {
          ids.push(await seedOutboxEvent(sql, groupId, userId, version))
        }

        const seen: string[] = []
        const publisher = {
          publish: (event: OutboxEvent) => {
            seen.push(event.id)
            return Promise.resolve()
          },
        }
        const options = { batchSize: 5 }
        const drains = Array.from(
          { length: 4 },
          () => new OutboxProcessor(repository, publisher, options).drainOnce(),
        )
        const results = await Promise.all(drains)

        const claimed = results.reduce((total, result) => total + result.claimed, 0)
        expect(claimed).toBe(20)
        // SKIP LOCKED must prevent any row being delivered twice.
        expect(new Set(seen).size).toBe(seen.length)
        expect(await pendingCount(sql)).toBe(0)
        expect(ids.length).toBe(20)
      })
    } finally {
      await sql.end({ timeout: 5 })
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin.end({ timeout: 5 })
    }
  },
})

async function seedUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

async function seedGroup(sql: postgres.Sql, userId: number): Promise<string> {
  const id = uuidV7()
  await sql`
    INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
    VALUES (${id}, 'outbox fixture', ${userId}, ${userId})
  `
  await sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
    VALUES (${id}, ${userId}, 4, ${userId})
  `
  return id
}

async function seedOutboxEvent(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
  version: number,
): Promise<string> {
  const id = uuidV7()
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, group_id, actor_user_id
    ) VALUES (
      ${id}, 'group.created', 'group', ${groupId}, ${version}, ${groupId}, ${userId}
    )
  `
  return id
}

async function outboxState(sql: postgres.Sql, id: string): Promise<OutboxStateRow> {
  const rows = await sql<OutboxStateRow[]>`
    SELECT id, attempt_count, last_error_code, processed_at, claimed_at, available_at
    FROM outbox_events
    WHERE id = ${id}
  `
  return rows[0]
}

async function pendingCount(sql: postgres.Sql): Promise<number> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::int AS count FROM outbox_events WHERE processed_at IS NULL
  `
  return rows[0].count
}
