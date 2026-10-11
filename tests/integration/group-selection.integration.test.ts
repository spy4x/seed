/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The selected group against a real Postgres built from schema.sql. Needs `DB_HOST`, `DB_USER`,
 * `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing.
 */

interface IdRow extends postgres.Row {
  id: number
}

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const schema = `selection_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 10,
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

/** A user with their first group, and a second group they own, made later. */
async function personWithTwoGroups(sql: postgres.Sql) {
  const repository = new PostgresGroupRepository(sql)
  const userId = await insertUser(sql)
  const personal = uuidV7()
  await repository.ensureFirst({ id: personal, name: "Me" }, userId)
  // The two groups are made within one millisecond, so say which is older: the fallback is the
  // oldest group, and two equal creation times would leave the choice to the ids.
  await sql`UPDATE groups SET created_at = created_at - interval '1 hour' WHERE id = ${personal}`
  const shared = await repository.create({ id: uuidV7(), name: "Team" }, userId)
  return { repository, userId, personal, shared: shared.group.id }
}

Deno.test("the selected group is stored per user and checked against membership", async (t) => {
  await withSchema(async (sql) => {
    await t.step(
      "a person who never chose gets their oldest group, and nothing is stored",
      async () => {
        const { repository, userId, personal } = await personWithTwoGroups(sql)

        const first = await repository.getSelected(userId)
        const again = await repository.getSelected(userId)

        expect(first).toEqual({ groupId: personal, version: 0 })
        expect(again).toEqual(first)
        const rows = await sql`SELECT 1 FROM user_settings WHERE user_id = ${userId}`
        expect(rows.length).toBe(0)
      },
    )

    await t.step("a person without groups gets none, and nothing is stored", async () => {
      const repository = new PostgresGroupRepository(sql)
      const userId = await insertUser(sql)

      expect(await repository.getSelected(userId)).toEqual({ groupId: null, version: 0 })
      const rows = await sql`SELECT 1 FROM user_settings WHERE user_id = ${userId}`
      expect(rows.length).toBe(0)
    })

    await t.step("selecting a member group stores it and moves the version once", async () => {
      const { repository, userId, personal, shared } = await personWithTwoGroups(sql)
      await repository.getSelected(userId)

      const selected = await repository.select(userId, shared)
      const same = await repository.select(userId, shared)

      expect(selected).toEqual({ groupId: shared, version: 1 })
      expect(same).toEqual(selected)
      expect(await repository.getSelected(userId)).toEqual(selected)
      expect(await repository.select(userId, personal)).toEqual({ groupId: personal, version: 2 })
    })

    await t.step("a group of someone else, or a missing one, cannot be selected", async () => {
      const { repository, userId, personal } = await personWithTwoGroups(sql)
      const stranger = await personWithTwoGroups(sql)
      await repository.getSelected(userId)

      expect(await repository.select(userId, stranger.shared)).toBeNull()
      expect(await repository.select(userId, uuidV7())).toBeNull()
      expect(await repository.getSelected(userId)).toEqual({ groupId: personal, version: 0 })
    })

    await t.step("a deleted selected group is replaced by another of the person's", async () => {
      const { repository, userId, personal, shared } = await personWithTwoGroups(sql)
      await repository.select(userId, shared)

      await sql`UPDATE groups SET deleted_at = now() WHERE id = ${shared}`
      const afterDelete = await repository.getSelected(userId)

      expect(afterDelete.groupId).toBe(personal)
      expect(afterDelete.version).toBe(1)
      expect(await repository.select(userId, shared)).toBeNull()
    })

    await t.step(
      "a group the person left is replaced, and the group itself stays",
      async () => {
        const { repository, userId, personal } = await personWithTwoGroups(sql)
        const other = await insertUser(sql)
        const sharedByOther = await repository.create(
          { id: uuidV7(), name: "Theirs" },
          other,
        )
        await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${sharedByOther.group.id}, ${userId}, 2, ${other})
      `
        await repository.select(userId, sharedByOther.group.id)

        await sql`
        DELETE FROM group_members WHERE group_id = ${sharedByOther.group.id} AND user_id = ${userId}
      `

        expect((await repository.getSelected(userId)).groupId).toBe(personal)
        const stays = await sql`
          SELECT 1 FROM groups WHERE id = ${sharedByOther.group.id} AND deleted_at IS NULL
        `
        expect(stays.length).toBe(1)
      },
    )
  })
})

Deno.test("a read of the selection never overwrites a choice committed while it runs", async () => {
  await withSchema(async (sql) => {
    const { repository, userId, personal, shared } = await personWithTwoGroups(sql)
    let read: Promise<unknown> = Promise.resolve()

    await sql.begin(async (transaction) => {
      // The choice is written but not yet committed: the read below cannot see it.
      await transaction`
        INSERT INTO user_settings (user_id, selected_group_id) VALUES (${userId}, ${shared})
      `
      read = repository.getSelected(userId)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await read

    expect(await repository.getSelected(userId)).toEqual({ groupId: shared, version: 1 })
    expect(personal).not.toBe(shared)
  })
})
