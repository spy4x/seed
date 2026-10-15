/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupError, GroupListPageKey, GroupRole } from "@domain/groups"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations, migrationNames } from "./migrations.ts"

interface IdRow extends postgres.Row {
  id: number
}

interface CountRow extends postgres.Row {
  count: number
}

/** The migration that adds groups; the users inserted before it are what the backfill covers. */
const GROUP_CORE_MIGRATION = "2026_08_18_0001_group_core.sql"
/** Applied by the steps that check what they do to existing rows, after every other migration. */
const MIGRATIONS_APPLIED_BY_STEPS = [
  "2026_10_07_0001_group_kind_removed.sql",
  "2026_10_08_0001_audit_outlives_group.sql",
  "2026_10_09_0001_audit_request_id_128.sql",
]

Deno.test({
  name: "group core Postgres integration",
  async fn(t) {
    const connection = buildPostgresOptions(requireDbConnection())
    const admin = postgres({ ...connection, max: 1 })
    const schema = `groups_test_${uuidV7().replace(/-/g, "")}`
    const sql = postgres({
      ...connection,
      max: 20,
      transform: postgres.camel,
      connection: { options: `-c search_path=${schema}` },
    })

    try {
      await admin`CREATE SCHEMA ${admin(schema)}`
      // Users from before groups existed, so the backfill has someone to cover.
      await applyMigrations(sql, migrationNames().filter((name) => name < GROUP_CORE_MIGRATION))

      const activeUserOne =
        (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
      const activeUserTwo =
        (await sql<IdRow[]>`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id
      await sql`INSERT INTO users (deleted_at) VALUES (NOW())`

      await applyMigrations(
        sql,
        migrationNames().filter((name) =>
          name >= GROUP_CORE_MIGRATION && !MIGRATIONS_APPLIED_BY_STEPS.includes(name)
        ),
      )

      await t.step("backfill is rerunnable and covers only active users", async () => {
        await applyMigrations(sql, ["2026_08_18_0002_personal_group_backfill.sql"])
        const counts = await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM groups
          INNER JOIN group_members
            ON group_members.group_id = groups.id
           AND group_members.user_id = groups.owner_user_id
           AND group_members.role = ${GroupRole.OWNER}
          WHERE groups.kind = 1
        `
        expect(counts[0].count).toBe(2)

        const invalid = await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count
          FROM groups
          INNER JOIN users ON users.id = groups.owner_user_id
          WHERE groups.kind = 1
            AND users.deleted_at IS NOT NULL
        `
        expect(invalid[0].count).toBe(0)
      })

      await t.step(
        "dropping the personal kind keeps every group, membership and owner, and removes the column",
        async () => {
          // A shared group with a second member and a note, beside the two backfilled personal ones.
          const shared = uuidV7()
          await sql`
            INSERT INTO groups (id, kind, name, owner_user_id, created_by_user_id)
            VALUES (${shared}, 2, 'Kept team', ${activeUserOne}, ${activeUserOne})
          `
          await sql`
            INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
            VALUES (${shared}, ${activeUserOne}, 4, ${activeUserOne}),
                   (${shared}, ${activeUserTwo}, 1, ${activeUserOne})
          `
          await sql`
            INSERT INTO notes (id, group_id, title, change_sequence, created_by_user_id, updated_by_user_id)
            VALUES (${uuidV7()}, ${shared}, 'Kept note', 1, ${activeUserOne}, ${activeUserOne})
          `
          const before = await sql`
            SELECT groups.id, groups.name, groups.owner_user_id, group_members.user_id, group_members.role
            FROM groups INNER JOIN group_members ON group_members.group_id = groups.id
            ORDER BY groups.id, group_members.user_id
          `

          await applyMigrations(sql, ["2026_10_07_0001_group_kind_removed.sql"])

          const after = await sql`
            SELECT groups.id, groups.name, groups.owner_user_id, group_members.user_id, group_members.role
            FROM groups INNER JOIN group_members ON group_members.group_id = groups.id
            ORDER BY groups.id, group_members.user_id
          `
          expect((await sql<CountRow[]>`SELECT COUNT(*)::int AS count FROM notes`)[0].count).toBe(1)
          expect(after.length).toBe(before.length)
          expect(after.length).toBeGreaterThanOrEqual(4)
          expect(after.map((row) => ({ ...row }))).toEqual(before.map((row) => ({ ...row })))
          const columns = await sql`
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = ${schema} AND table_name = 'groups' AND column_name = 'kind'
          `
          expect(columns.length).toBe(0)
          // Every active user still has exactly the personal group the backfill gave them.
          const owned = await sql<CountRow[]>`
            SELECT COUNT(*)::int AS count FROM groups WHERE name = 'Personal' AND deleted_at IS NULL
          `
          expect(owned[0].count).toBe(2)
          // The later steps count each user's groups: leave only the backfilled ones.
          await sql`DELETE FROM groups WHERE id = ${shared}`
        },
      )

      await t.step("an audit row outlives its group, with the group id emptied", async () => {
        await applyMigrations(sql, ["2026_10_08_0001_audit_outlives_group.sql"])
        const userId = await insertUser(sql)
        const groupId = uuidV7()
        await sql`
          INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
          VALUES (${groupId}, 'audited', ${userId}, ${userId})
        `
        await sql`
          INSERT INTO audit_events (event_kind, actor_user_id, group_id)
          VALUES ('group.deleted', ${userId}, ${groupId})
        `

        await sql`DELETE FROM groups WHERE id = ${groupId}`

        const rows = await sql<{ groupId: string | null }[]>`
          SELECT group_id FROM audit_events WHERE actor_user_id = ${userId}
        `
        expect(rows).toEqual([{ groupId: null }])
      })

      await t.step(
        "widening the audit request id keeps every row and takes 128 characters",
        async () => {
          const userId = await insertUser(sql)
          await sql`
          INSERT INTO audit_events (event_kind, actor_user_id, request_id)
          VALUES ('group.renamed', ${userId}, 'short-id')
        `

          await applyMigrations(sql, ["2026_10_09_0001_audit_request_id_128.sql"])

          const long = "r".repeat(128)
          await sql`
          INSERT INTO audit_events (event_kind, actor_user_id, request_id)
          VALUES ('group.renamed', ${userId}, ${long})
        `
          const rows = await sql<{ requestId: string }[]>`
          SELECT request_id FROM audit_events WHERE actor_user_id = ${userId} ORDER BY id
        `
          expect(rows).toEqual([{ requestId: "short-id" }, { requestId: long }])
        },
      )

      await t.step("an existing user with no group gets one, once", async () => {
        const userId = await insertUser(sql)
        const repository = new PostgresGroupRepository(sql)
        await repository.ensureFirst({ id: uuidV7(), name: "Personal" }, userId)
        await repository.ensureFirst({ id: uuidV7(), name: "Personal" }, userId)
        // The second call finds the first group and makes no other.
        expect((await repository.listForUser(userId, { limit: 10 })).groups.length).toBe(1)
      })

      await t.step("concurrent exact shared create emits audit and outbox once", async () => {
        const repository = new PostgresGroupRepository(sql)
        const groupId = uuidV7()
        const gate = deferred<void>()
        const requests = Array.from({ length: 20 }, async () => {
          await gate.promise
          return await repository.create(
            { id: groupId, name: "Concurrent team", requestId: "request-exact" },
            activeUserOne,
          )
        })
        gate.resolve()
        const results = await Promise.all(requests)
        expect(results.filter((result) => result.created).length).toBe(1)
        expect(results.every((result) => result.group.id === groupId)).toBe(true)
        expect(await eventCounts(sql, groupId)).toEqual([1, 1])
      })

      await t.step(
        "concurrent changed intent yields one winner without duplicate effects",
        async () => {
          const repository = new PostgresGroupRepository(sql)
          const groupId = uuidV7()
          const gate = deferred<void>()
          const requests = Array.from({ length: 20 }, async (_, index) => {
            await gate.promise
            try {
              return await repository.create(
                { id: groupId, name: index % 2 ? "Intent A" : "Intent B" },
                activeUserOne,
              )
            } catch (error) {
              expect(error).toBeInstanceOf(GroupError)
              return null
            }
          })
          gate.resolve()
          const results = await Promise.all(requests)
          expect(results.filter((result) => result?.created).length).toBe(1)
          expect(results.filter(Boolean).length).toBe(10)
          expect(await eventCounts(sql, groupId)).toEqual([1, 1])
        },
      )

      await t.step("list is bounded, keyset-paged, and cross-user isolated", async () => {
        const repository = new PostgresGroupRepository(sql)
        await sql.begin(async (transaction: postgres.TransactionSql) => {
          for (let index = 0; index < 55; index += 1) {
            const groupId = uuidV7()
            await transaction`
              INSERT INTO groups (id, name, owner_user_id, created_by_user_id)
              VALUES (${groupId}, ${`Page ${index}`}, ${activeUserOne}, ${activeUserOne})
            `
            await transaction`
              INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
              VALUES (${groupId}, ${activeUserOne}, 4, ${activeUserOne})
            `
          }
        })

        const first = await repository.listForUser(activeUserOne, { limit: 50 })
        expect(first.groups.length).toBe(50)
        expect(first.nextPageKey).not.toBe(null)
        const second = await repository.listForUser(activeUserOne, {
          limit: 50,
          after: first.nextPageKey!,
        })
        const ids = [...first.groups, ...second.groups].map((group) => group.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect((await repository.listForUser(activeUserTwo, { limit: 100 })).groups.length).toBe(1)
      })

      await t.step(
        "the list pages through groups changed in one millisecond, each once",
        async () => {
          const repository = new PostgresGroupRepository(sql)
          const owner = await insertUser(sql)
          const ids: string[] = []
          for (const name of ["a", "b", "c"]) {
            const id = uuidV7()
            await repository.create({ id, name }, owner)
            ids.push(id)
          }
          // Three times ten microseconds apart, inside one millisecond. They are built in SQL because
          // postgres.js would send a timestamp parameter through a Date, which drops microseconds.
          for (const [index, id] of ids.entries()) {
            await sql`
            UPDATE groups
            SET updated_at = TIMESTAMPTZ '2026-10-02 12:00:00.12345+00'
              - make_interval(secs => ${index * 10} / 1000000.0)
            WHERE id = ${id}
          `
          }

          const seen: string[] = []
          let after: GroupListPageKey | undefined
          for (let page = 0; page < 5; page++) {
            const result = await repository.listForUser(
              owner,
              after ? { limit: 1, after } : { limit: 1 },
            )
            // The owner's personal group may be listed too; only the three groups under test count.
            seen.push(...result.groups.map((group) => group.id).filter((id) => ids.includes(id)))
            if (!result.nextPageKey) break
            after = result.nextPageKey
          }

          expect(seen.toSorted()).toEqual(ids.toSorted())
        },
      )

      await t.step(
        "one group is read for a member only, as a missing group otherwise",
        async () => {
          const repository = new PostgresGroupRepository(sql)
          const owner = await insertUser(sql)
          const stranger = await insertUser(sql)
          const groupId = uuidV7()
          await repository.create({ id: groupId, name: "Private" }, owner)

          const read = await repository.getSummaryForMember(groupId, owner)
          expect(read).toMatchObject({ id: groupId, name: "Private", role: GroupRole.OWNER })
          expect(await repository.getSummaryForMember(groupId, stranger)).toBe(null)
          expect(await repository.getSummaryForMember(uuidV7(), owner)).toBe(null)
        },
      )

      await t.step("a soft-deleted group is not read, even by its former owner", async () => {
        const repository = new PostgresGroupRepository(sql)
        const owner = await insertUser(sql)
        const groupId = uuidV7()
        await repository.create({ id: groupId, name: "Gone" }, owner)
        expect(await repository.getSummaryForMember(groupId, owner)).not.toBe(null)

        await sql`UPDATE groups SET deleted_at = NOW() WHERE id = ${groupId}`

        expect(await repository.getSummaryForMember(groupId, owner)).toBe(null)
      })

      await t.step("a committed create takes the group's first sequence", async () => {
        const repository = new PostgresGroupRepository(sql)
        const groupId = uuidV7()
        const created = await repository.create(
          { id: groupId, name: "Sequenced" },
          activeUserOne,
        )
        expect(created.group.changeSequence).toBe("1")
        expect(await groupSequences(sql, groupId)).toEqual({ next: "2", outbox: ["1"] })
        const listed = (await repository.listForUser(activeUserOne, { limit: 100 })).groups
          .find((group) => group.id === groupId)
        expect(listed?.changeSequence).toBe("1")
      })

      await t.step("a replayed create does not take another sequence", async () => {
        const repository = new PostgresGroupRepository(sql)
        const groupId = uuidV7()
        await repository.create({ id: groupId, name: "Replayed" }, activeUserOne)
        const replay = await repository.create(
          { id: groupId, name: "Replayed" },
          activeUserOne,
        )
        expect(replay.created).toBe(false)
        expect(replay.group.changeSequence).toBe("1")
        expect(await groupSequences(sql, groupId)).toEqual({ next: "2", outbox: ["1"] })
      })

      await t.step("a sign-up that rolls back leaves no outbox row to push", async () => {
        const userId = await insertUser(sql)
        const groupId = uuidV7()
        await expect(sql.begin(async (transaction: postgres.TransactionSql) => {
          await new PostgresGroupRepository(transaction).createFirst(
            { id: groupId, name: "Personal" },
            userId,
          )
          throw new Error("the surrounding transaction fails after the create")
        })).rejects.toThrow("surrounding transaction")
        expect(await groupSequences(sql, groupId)).toEqual({ next: null, outbox: [] })
      })

      await t.step("a first group is stamped when it is created", async () => {
        const userId = await insertUser(sql)
        const id = uuidV7()
        await new PostgresGroupRepository(sql).ensureFirst({ id, name: "Personal" }, userId)
        expect(await groupSequences(sql, id)).toEqual({ next: "2", outbox: ["1"] })
      })

      await t.step(
        "member ids name only active users, and a deleted group has none",
        async () => {
          const repository = new PostgresGroupRepository(sql)
          const groupId = uuidV7()
          await repository.create({ id: groupId, name: "Members" }, activeUserOne)
          const gone = await insertUser(sql, new Date())
          await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${groupId}, ${activeUserTwo}, 1, ${activeUserOne}),
                 (${groupId}, ${gone}, 1, ${activeUserOne})
        `
          expect(await repository.listMemberUserIds(groupId)).toEqual([
            activeUserOne,
            activeUserTwo,
          ])
          expect(await repository.listMemberUserIds(uuidV7())).toEqual([])
          await sql`UPDATE groups SET deleted_at = NOW() WHERE id = ${groupId}`
          expect(await repository.listMemberUserIds(groupId)).toEqual([])
        },
      )

      await t.step("shared creation rejects soft-deleted actors", async () => {
        const actor = await insertUser(sql, new Date())
        const groupId = uuidV7()
        await expect(new PostgresGroupRepository(sql).create(
          { id: groupId, name: "Denied" },
          actor,
        )).rejects.toThrow(GroupError)
        expect(
          (await sql<CountRow[]>`
          SELECT COUNT(*)::int AS count FROM groups WHERE id = ${groupId}
        `)[0].count,
        ).toBe(0)
      })
    } finally {
      await sql.end({ timeout: 1 })
      await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
      await admin.end({ timeout: 1 })
    }
  },
})

/** A user as sign-up creates one since the auth tables: an auth user, then its profile row. */
async function insertUser(sql: postgres.Sql, deletedAt: Date | null = null): Promise<number> {
  const rows = await sql<IdRow[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, deleted_at) SELECT id, ${deletedAt} FROM auth_user RETURNING id
  `
  return rows[0].id
}

async function eventCounts(sql: postgres.Sql, groupId: string): Promise<number[]> {
  const rows = await sql<CountRow[]>`
    SELECT COUNT(*)::int AS count FROM audit_events WHERE group_id = ${groupId}
    UNION ALL
    SELECT COUNT(*)::int FROM outbox_events WHERE group_id = ${groupId}
  `
  return rows.map((row: CountRow) => row.count)
}

interface SequenceRow extends postgres.Row {
  next: string | null
  outbox: string[]
}

/** A group's `next_change_sequence` (null when it does not exist) and its outbox versions. */
async function groupSequences(
  sql: postgres.Sql,
  groupId: string,
): Promise<{ next: string | null; outbox: string[] }> {
  const rows = await sql<SequenceRow[]>`
    SELECT
      (SELECT next_change_sequence::text FROM groups WHERE id = ${groupId}) AS next,
      COALESCE(
        (SELECT array_agg(aggregate_version::text ORDER BY aggregate_version)
         FROM outbox_events WHERE aggregate_id = ${groupId}),
        '{}'
      ) AS outbox
  `
  return { next: rows[0].next, outbox: rows[0].outbox }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve: () => resolve(undefined as T) }
}
