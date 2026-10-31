/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { Hono } from "hono"
import { QueryBus } from "@spy4x/platform/cqrs"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type ChangesAnswer, changesAnswerSchema } from "@spy4x/realtime/changes"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { GroupChangesQuery, GroupError, type GroupRepository } from "@domain/groups"
import type { Note } from "@domain/notes"
import { purgeChangeTombstones, readGroupChanges } from "@server/groups/group-changes.ts"
import { PostgresGroupDataMover } from "@server/groups/postgres-group-data-mover.ts"
import { noteMovable } from "@server/notes/note-movable.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresTagRepository } from "@server/tags/postgres-tag-repository.ts"
import { tagMovable } from "@server/tags/tag-movable.ts"
import { CHANGES_AGGREGATES } from "../../apps/api/services/db-base.ts"
import { createSessionGate } from "../../apps/api/cqrs/session-gate.ts"
import { createGroupChangesHandler } from "../../apps/api/features/groups/handlers.ts"
import {
  createGroupOperations,
  type GroupOperationDependencies,
} from "../../apps/api/features/groups/operations.ts"
import { createGroupsRoute, type GroupsRouteDependencies } from "../../apps/api/routes/groups.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildAuthData } from "../../apps/api/_testing/fake-auth.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * The changes pull of a group (`GET /api/groups/:groupId/changes`, socket `group.changes`) against
 * a real Postgres: what a page holds, where it ends, when a cursor is too old, and that only a
 * member is answered. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in
 * docs/handoff.md); it fails when they are missing rather than skipping.
 */

function actor(userId: number): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionSecondFactor: SecondFactorStatus.NotRequired,
  }
}

function changesOf(sql: postgres.Sql, groups: GroupRepository) {
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(
    GroupChangesQuery,
    createGroupChangesHandler(groups, {
      read: (groupId, after) => readGroupChanges(sql, CHANGES_AGGREGATES, groupId, after),
    }),
  )
  const changes = (query: GroupChangesQuery) => queries.execute(query)
  const operations = createGroupOperations({ changes } as unknown as GroupOperationDependencies)
  const call = async (userId: number, payload: unknown): Promise<unknown> =>
    await operations["group.changes"].handle(
      { actor: actor(userId), payload, requestId: "req" } as never,
    )
  const rest = (userId: number, path: string) => {
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-changes")
      c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
      await next()
    })
    app.route(
      "/groups",
      createGroupsRoute(
        { changes, passwordLimit: (_c, next) => next() } as GroupsRouteDependencies,
      ),
    )
    return app.request(`/groups${path}`)
  }
  return { call, rest }
}

/** The answer as a page, checked against the wire shape the device checks it with. */
function page(answer: unknown) {
  const checked = changesAnswerSchema.assert(answer)
  if (checked.status !== "changes") throw new Error(`Expected a page, got ${checked.status}`)
  return checked
}

function ids(rows: unknown[] | undefined): string[] {
  return (rows ?? []).map((row) => (row as { id: string }).id).sort()
}

async function current(sql: postgres.Sql, groupId: string): Promise<number> {
  return Number(
    (await sql<{ current: string }[]>`
      SELECT (next_change_sequence - 1)::text AS current FROM groups WHERE id = ${groupId}
    `)[0].current,
  )
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(() => null, (error) => error)
}

Deno.test("group changes against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const { repository: groups, groupId, owner, viewer, stranger } = await team(sql)
    const notes = new PostgresNoteRepository(sql)
    const tags = new PostgresTagRepository(sql)
    const { call, rest } = changesOf(sql, groups)
    const other = (await groups.create({ id: uuidV7(), name: "Other" }, owner)).group.id
    const create = async (group: string, title: string, tagIds: string[] = []): Promise<Note> =>
      (await notes.create(
        { groupId: group, id: uuidV7(), title, body: `${title} body`, tagIds },
        owner,
        null,
      )).note
    const red = (await tags.create({ groupId, id: uuidV7(), name: "Red", color: "#dc2626" }, owner))
      .tag
    const kept = await create(groupId, "Kept", [red.id])
    const edited = await create(groupId, "Edited")
    const deleted = await create(groupId, "Secret plans")
    const moved = await create(groupId, "Moved")
    const elsewhere = await create(other, "In another group")
    const cursor = await current(sql, groupId)

    await t.step("from 0 a member gets every live row of the group and no tombstones", async () => {
      const answer = page(await call(viewer, { groupId, after: 0 }))
      expect(ids(answer.upserts.notes)).toEqual(ids([kept, edited, deleted, moved]))
      expect(ids(answer.upserts.tags)).toEqual([red.id])
      expect(answer.tombstones).toEqual([])
      expect(answer).toMatchObject({ after: 0, through: cursor, current: cursor, more: false })
      expect(JSON.stringify(answer)).not.toContain(elsewhere.id)
    })

    const blue =
      (await tags.create({ groupId, id: uuidV7(), name: "Blue", color: "#2563eb" }, owner))
        .tag
    await notes.update(
      { groupId, id: edited.id, title: "Edited again", body: "", expectedVersion: edited.version },
      owner,
    )
    await notes.delete({ groupId, id: deleted.id, expectedVersion: deleted.version }, owner)
    await notes.move({ fromGroupId: groupId, toGroupId: other, noteIds: [moved.id] }, owner, null)
    await tags.delete({ groupId, id: red.id, expectedVersion: red.version }, owner)

    await t.step(
      "after a cursor the page holds the rows written since and a tombstone for each row gone",
      async () => {
        const answer = page(await call(viewer, { groupId, after: cursor }))
        expect(ids(answer.upserts.notes)).toEqual([edited.id])
        expect(ids(answer.upserts.tags)).toEqual([blue.id])
        expect(answer.tombstones).toEqual([
          { kind: "notes", id: deleted.id },
          { kind: "notes", id: moved.id },
          { kind: "tags", id: red.id },
        ])
        expect(answer).toMatchObject({ after: cursor, more: false })
        expect(answer.through).toBe(await current(sql, groupId))
      },
    )

    await t.step("a deleted note's title and body never reach the page", async () => {
      const answer = await call(viewer, { groupId, after: cursor })
      expect(JSON.stringify(answer)).not.toContain("Secret plans")
    })

    await t.step("the group a note moved into gets it as a row, not a tombstone", async () => {
      const answer = page(await call(owner, { groupId: other, after: 0 }))
      expect(ids(answer.upserts.notes)).toEqual(ids([elsewhere, moved]))
    })

    await t.step(
      "a note restored after its delete comes as a row, without its tombstone",
      async () => {
        await notes.restore({ groupId, id: deleted.id }, owner, null)
        const answer = page(await call(viewer, { groupId, after: cursor }))
        expect(ids(answer.upserts.notes)).toEqual(ids([edited, deleted]))
        expect(answer.tombstones).not.toContainEqual({ kind: "notes", id: deleted.id })
      },
    )

    await t.step("a page ends at the limit and never splits one sequence", async () => {
      const first = page(await readGroupChanges(sql, CHANGES_AGGREGATES, groupId, cursor, 2))
      expect(first.more).toBe(true)
      // The two changes after the cursor are the new tag and the edit, one sequence each.
      expect(first.through).toBe(cursor + 2)
      expect(first.through).toBeLessThan(first.current)
      const rows = first.tombstones.length + ids(first.upserts.notes).length +
        ids(first.upserts.tags).length
      expect(rows).toBeLessThanOrEqual(2)
      let after = first.through
      const seen = [...first.tombstones.map((gone) => gone.id), ...ids(first.upserts.notes)]
      for (let pages = 0; pages < 10 && after < first.current; pages++) {
        const next = page(await readGroupChanges(sql, CHANGES_AGGREGATES, groupId, after, 2))
        expect(next.through).toBeGreaterThan(after)
        seen.push(...next.tombstones.map((gone) => gone.id), ...ids(next.upserts.notes))
        after = next.through
      }
      expect(after).toBe(first.current)
      expect(seen).toContain(edited.id)
      expect(seen).toContain(moved.id)
    })

    await t.step("a cursor ahead of the group's sequence is too old", async () => {
      const now = await current(sql, groupId)
      expect(await call(viewer, { groupId, after: now + 1 })).toEqual({
        status: "too-old",
        current: now,
      })
    })

    await t.step("moving all data out makes every older cursor of the source too old", async () => {
      const target = (await groups.create({ id: uuidV7(), name: "Target" }, owner)).group.id
      await new PostgresGroupDataMover(sql, [tagMovable, noteMovable]).moveAll(
        { fromGroupId: groupId, toGroupId: target },
        owner,
        {},
      )
      const now = await current(sql, groupId)
      expect(await call(viewer, { groupId, after: cursor })).toEqual({
        status: "too-old",
        current: now,
      })
      expect(page(await call(viewer, { groupId, after: now })).upserts.notes).toEqual([])
      expect(page(await call(viewer, { groupId, after: 0 })).upserts.notes).toEqual([])
    })

    await t.step("forgetting old tombstones makes the cursors before them too old", async () => {
      const before = await current(sql, other)
      const gone = await create(other, "Gone")
      await notes.delete({ groupId: other, id: gone.id, expectedVersion: gone.version }, owner)
      expect(page(await call(owner, { groupId: other, after: before })).tombstones).toEqual([
        { kind: "notes", id: gone.id },
      ])
      expect(await purgeChangeTombstones(sql, new Date())).toBe(0)
      const later = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000)
      expect(await purgeChangeTombstones(sql, later)).toBeGreaterThanOrEqual(1)
      expect(await call(owner, { groupId: other, after: before })).toMatchObject({
        status: "too-old",
      })
      const now = await current(sql, other)
      expect(page(await call(owner, { groupId: other, after: now })).tombstones).toEqual([])
    })

    await t.step("a person who is not a member is told the group does not exist", async () => {
      const error = await refusal(call(stranger, { groupId, after: 0 }))
      expect(error).toBeInstanceOf(GroupError)
      expect((error as GroupError).code).toBe("GROUP_NOT_FOUND")
      const response = await rest(stranger, `/${groupId}/changes?after=0`)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain("Kept")
    })

    await t.step("over REST a member gets the same page", async () => {
      const response = await rest(owner, `/${other}/changes?after=0`)
      expect(response.status).toBe(200)
      const answer: ChangesAnswer = page(await response.json())
      expect(ids(answer.status === "changes" ? answer.upserts.notes : [])).toContain(elsewhere.id)
    })

    await t.step("an after that is not a non-negative integer is a bad request", async () => {
      for (const after of ["-1", "1.5", "01", "1e3", "abc", ""]) {
        const response = await rest(owner, `/${other}/changes?after=${after}`)
        expect(response.status).toBe(400)
      }
      expect((await rest(owner, `/${other}/changes`)).status).toBe(400)
      for (const after of [-1, 1.5, "3", null, Number.MAX_SAFE_INTEGER + 1]) {
        const error = await refusal(call(owner, { groupId: other, after }))
        expect((error as GroupError).code).toBe("INVALID_REQUEST")
      }
      const extra = await refusal(call(owner, { groupId: other, after: 0, more: true }))
      expect((extra as GroupError).code).toBe("INVALID_REQUEST")
    })
  })
})
