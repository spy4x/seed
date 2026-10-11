/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresGroupDataMover } from "@server/groups/postgres-group-data-mover.ts"
import type { MovableAggregate } from "@server/groups/movable.ts"
import { noteMovable } from "@server/notes/note-movable.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { insertUser, runBlockedOnLock, withSchema } from "./group-team.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * Moving all of a group's data against a real Postgres: one transaction, rights in both groups on
 * locked rows, one change and one audit event per group, the target's cap, and nothing moved when
 * anything fails halfway. Needs `DB_*` (recipe in docs/handoff.md); it fails when they are missing.
 */

const NO_CAP = { maxNotes: null }

async function seed(sql: postgres.Sql, titles: string[]) {
  const groups = new PostgresGroupRepository(sql)
  const notes = new PostgresNoteRepository(sql)
  const owner = await insertUser(sql)
  const editor = await insertUser(sql)
  const from = uuidV7()
  const to = uuidV7()
  await groups.create({ id: from, name: "Source" }, owner)
  await groups.create({ id: to, name: "Target" }, owner)
  for (const groupId of [from, to]) {
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner})
    `
  }
  const ids: string[] = []
  for (const title of titles) {
    const id = uuidV7()
    await notes.create({ groupId: from, id, title, body: "" }, editor, null)
    ids.push(id)
  }
  return { owner, editor, from, to, ids, notes }
}

async function sequenceOf(sql: postgres.Sql, groupId: string): Promise<bigint> {
  const [row] = await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `
  return BigInt(row.next)
}

async function eventKinds(sql: postgres.Sql, table: "audit_events" | "outbox_events", id: string) {
  return (await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM ${sql(table)} WHERE group_id = ${id} AND event_kind LIKE 'group.data%'
  `).map((row) => row.eventKind)
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the move to be refused")
}

Deno.test("moving all of a group's data", async (t) => {
  await withSchema(async (sql) => {
    const mover = new PostgresGroupDataMover(sql, [noteMovable])

    await t.step(
      "moves every live note, keeps ids and history, and writes one change and one audit event per group",
      async () => {
        const { editor, from, to, ids, notes } = await seed(sql, ["a", "b", "c"])
        await notes.delete({ groupId: from, id: ids[2], expectedVersion: 1 }, editor)
        // The target has changes of its own, so its sequence differs from the source's and a note
        // stamped with the wrong group's number shows.
        for (const title of ["x", "y"]) {
          await notes.create(
            { groupId: to, id: uuidV7(), title, body: "" },
            editor,
            null,
          )
        }
        expect(await sequenceOf(sql, to)).not.toBe(await sequenceOf(sql, from))
        const [fromBefore, toBefore] = [await sequenceOf(sql, from), await sequenceOf(sql, to)]

        const result = await mover.moveAll(
          { fromGroupId: from, toGroupId: to, requestId: "req-1" },
          editor,
          NO_CAP,
        )

        expect(result).toEqual({ moved: 2, counts: { notes: 2 } })
        const moved = await notes.list(to, { limit: 10 })
        expect(
          moved.notes.filter((note) => ids.includes(note.id)).map((note) => [note.id, note.version])
            .sort(),
        ).toEqual([[ids[0], 2], [ids[1], 2]].sort())
        expect(moved.notes).toHaveLength(4)
        expect(await notes.count(from)).toBe(0)
        // The deleted note was not moved: it stays behind with the group.
        const [{ count }] = await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM notes WHERE group_id = ${from}
        `
        expect(count).toBe(1)
        expect(await sequenceOf(sql, from)).toBe(fromBefore + 1n)
        expect(await sequenceOf(sql, to)).toBe(toBefore + 1n)
        expect(await eventKinds(sql, "outbox_events", from)).toEqual(["group.data_moved_out"])
        expect(await eventKinds(sql, "outbox_events", to)).toEqual(["group.data_moved_in"])
        expect(await eventKinds(sql, "audit_events", from)).toEqual(["group.data_moved_out"])
        expect(await eventKinds(sql, "audit_events", to)).toEqual(["group.data_moved_in"])
        const [audit] = await sql<{ details: Record<string, unknown>; requestId: string }[]>`
          SELECT details, request_id FROM audit_events
          WHERE group_id = ${from} AND event_kind = 'group.data_moved_out'
        `
        expect(audit.details).toEqual({ notes: 2, count: 2, groupName: "Target" })
        expect(audit.requestId).toBe("req-1")
        const [stamp] = await sql<{ changeSequence: string }[]>`
          SELECT change_sequence::text AS change_sequence FROM notes WHERE id = ${ids[0]}
        `
        expect(BigInt(stamp.changeSequence)).toBe(toBefore)
      },
    )

    await t.step(
      "is all or nothing: a failure after the notes moved leaves them, the sequences and the logs as they were",
      async () => {
        const { editor, from, to, ids, notes } = await seed(sql, ["a", "b"])
        const failing: MovableAggregate = {
          kind: "failing",
          moveAll: () => Promise.reject(new Error("the second aggregate failed halfway")),
        }
        const halfway = new PostgresGroupDataMover(sql, [noteMovable, failing])
        const [fromBefore, toBefore] = [await sequenceOf(sql, from), await sequenceOf(sql, to)]

        const error = await refusal(
          halfway.moveAll({ fromGroupId: from, toGroupId: to }, editor, NO_CAP),
        )

        expect((error as Error).message).toBe("the second aggregate failed halfway")
        expect(await notes.count(from)).toBe(2)
        expect(await notes.count(to)).toBe(0)
        const versions = await sql<{ version: number }[]>`
          SELECT version FROM notes WHERE id IN ${sql(ids)}
        `
        expect(versions.map((row) => row.version)).toEqual([1, 1])
        expect(await sequenceOf(sql, from)).toBe(fromBefore)
        expect(await sequenceOf(sql, to)).toBe(toBefore)
        for (const groupId of [from, to]) {
          expect(await eventKinds(sql, "audit_events", groupId)).toEqual([])
          expect(await eventKinds(sql, "outbox_events", groupId)).toEqual([])
        }
      },
    )

    await t.step("needs an editor's rights in both groups, on locked rows", async () => {
      const { owner, editor, from, to } = await seed(sql, ["a"])
      const viewer = await insertUser(sql)
      const readsTarget = await insertUser(sql)
      const stranger = await insertUser(sql)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${from}, ${viewer}, ${GroupRole.VIEWER}, ${owner}),
               (${to}, ${viewer}, ${GroupRole.EDITOR}, ${owner}),
               (${from}, ${readsTarget}, ${GroupRole.EDITOR}, ${owner}),
               (${to}, ${readsTarget}, ${GroupRole.VIEWER}, ${owner})
      `
      const attempt = (userId: number, source = from, target = to) =>
        refusal(mover.moveAll({ fromGroupId: source, toGroupId: target }, userId, NO_CAP))

      expect(await attempt(viewer)).toMatchObject({ code: "ROLE_INSUFFICIENT" })
      expect(await attempt(readsTarget)).toMatchObject({ code: "ROLE_INSUFFICIENT" })
      expect(await attempt(stranger)).toMatchObject({ code: "GROUP_NOT_FOUND" })
      expect(await attempt(editor, from, uuidV7())).toMatchObject({
        code: "GROUP_NOT_FOUND",
      })
      const notes = new PostgresNoteRepository(sql)
      expect(await notes.count(from)).toBe(1)
      expect(await eventKinds(sql, "audit_events", from)).toEqual([])
    })

    await t.step("refuses a group with nothing to move and records nothing", async () => {
      const { editor, from, to } = await seed(sql, [])
      const before = await sequenceOf(sql, to)

      const error = await refusal(
        mover.moveAll({ fromGroupId: from, toGroupId: to }, editor, NO_CAP),
      )

      expect(error).toMatchObject({ code: "NOTHING_TO_MOVE" })
      expect(await sequenceOf(sql, to)).toBe(before)
      expect(await eventKinds(sql, "audit_events", to)).toEqual([])
    })

    await t.step(
      "refuses a move that would take the target over its cap, and moves none",
      async () => {
        const { owner, editor, from, to, notes } = await seed(sql, ["a", "b"])
        await notes.create(
          { groupId: to, id: uuidV7(), title: "x", body: "" },
          owner,
          null,
        )
        const input = { fromGroupId: from, toGroupId: to }

        const over = await refusal(mover.moveAll(input, editor, { maxNotes: 2 }))
        expect(over).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: 2 })
        expect(await notes.count(from)).toBe(2)
        expect(await notes.count(to)).toBe(1)
        expect(await eventKinds(sql, "audit_events", from)).toEqual([])

        const fits = await mover.moveAll(input, editor, { maxNotes: 3 })

        expect(fits.moved).toBe(2)
        expect(await notes.count(to)).toBe(3)
      },
    )

    await t.step("two moves in opposite directions both finish, none deadlocks", async () => {
      const { editor, from, to, notes } = await seed(sql, ["a"])
      await notes.create(
        { groupId: to, id: uuidV7(), title: "b", body: "" },
        editor,
        null,
      )

      const results = await runBlockedOnLock(sql, from, [
        () => mover.moveAll({ fromGroupId: from, toGroupId: to }, editor, NO_CAP),
        () => mover.moveAll({ fromGroupId: to, toGroupId: from }, editor, NO_CAP),
      ])

      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
      const moved = results.map((result) =>
        (result as PromiseFulfilledResult<{ moved: number }>).value.moved
      )
      expect(moved.sort()).toEqual([1, 2])
      expect((await notes.count(from)) + (await notes.count(to))).toBe(2)
    })
  })
})
