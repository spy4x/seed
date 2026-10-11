/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus } from "@spy4x/platform/cqrs"
import { GroupCreateCommand } from "@domain/groups"
import { createGroupCreateHandler } from "../../apps/api/features/groups/handlers.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { createIdempotencyMiddleware, PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

interface IdRow extends postgres.Row {
  id: number
}

interface SequenceRow extends postgres.Row {
  next: string
  outbox: number
}

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `idem_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 25,
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

async function insertUser(sql: postgres.Sql): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return rows[0].id
}

Deno.test("idempotency keys in Postgres", async (t) => {
  await withSchema(async (sql) => {
    const store = new PostgresIdempotencyStore(sql)
    const userId = await insertUser(sql)

    await t.step(
      "replaying a group create returns the first result and changes nothing",
      async () => {
        const repository = new PostgresGroupRepository(sql)
        const bus = new CommandBus()
        bus.use(createIdempotencyMiddleware({ store }))
        bus.register(GroupCreateCommand, createGroupCreateHandler(repository))
        const actor = {
          userId,
          userMfa: UserMFAStatus.NOT_CONFIGURED,
          sessionSecondFactor: SecondFactorStatus.NotRequired,
        }
        const send = (requestId: string) =>
          bus.execute(
            new GroupCreateCommand({
              actor,
              id: "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01",
              name: "Replayed team",
              requestId,
              idempotencyKey: "create-team-1",
            }),
          )

        const first = await send("request-1")
        const replay = await send("request-2")

        // The repository alone would answer the second send `created: false`.
        expect(first.created).toBe(true)
        expect(replay.created).toBe(true)
        expect(replay.group.id).toBe(first.group.id)
        const stamped = await sql<SequenceRow[]>`
          SELECT
            (SELECT next_change_sequence::text FROM groups WHERE id = ${first.group.id}) AS next,
            (SELECT COUNT(*)::int FROM outbox_events WHERE aggregate_id = ${first.group.id}) AS outbox
        `
        expect(stamped[0]).toEqual({ next: "2", outbox: 1 })
      },
    )
  })
})
