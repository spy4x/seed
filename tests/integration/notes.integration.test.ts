/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteError,
  NoteGetQuery,
  type NoteListPageKey,
  NoteListQuery,
  NoteLocateQuery,
  NoteMoveCommand,
  NoteRestoreCommand,
  NoteUpdateCommand,
  NoteVersionConflictError,
} from "@domain/notes"
import { runBlockedOnLock } from "./group-team.ts"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { createIdempotencyMiddleware, PostgresIdempotencyStore } from "@spy4x/server/idempotency"
import { buildAuthData } from "../../apps/api/_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  WEB_APP_URL,
} from "../../apps/api/_testing/mutation-requests.ts"
import { createCallRoute } from "../../apps/api/routes/call.ts"
import { toRequestError } from "../../apps/api/services/realtime.ts"
import { createNoteOperations } from "../../apps/api/features/notes/operations.ts"
import { createSessionGate } from "../../apps/api/cqrs/session-gate.ts"
import { createEntitlementGate } from "../../apps/api/cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../apps/api/cqrs/entitlement-needs.ts"
import {
  createNoteCreateHandler,
  createNoteDeleteHandler,
  createNoteGetHandler,
  createNoteListHandler,
  createNoteLocateHandler,
  createNoteMoveHandler,
  createNoteRestoreHandler,
  createNoteUpdateHandler,
  type NoteHandlerDependencies,
} from "../../apps/api/features/notes/handlers.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Notes against a real Postgres built from the migrations, through the same handlers, session gate
 * and idempotency middleware the API puts on its buses. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and
 * `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

interface IdRow extends postgres.Row {
  id: number
}

interface OutboxRow extends postgres.Row {
  eventKind: string
  aggregateType: string
  aggregateId: string
  aggregateVersion: string
}

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `notes_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
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

function actor(userId: number): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionSecondFactor: SecondFactorStatus.NotRequired,
  }
}

/** The API's buses, with the note handlers on real repositories. */
function buses(sql: postgres.Sql) {
  const groups = new PostgresGroupRepository(sql)
  const dependencies: NoteHandlerDependencies = {
    notes: new PostgresNoteRepository(sql),
    groups: {
      roleOf: async (groupId, userId) => (await groups.getForMember(groupId, userId))?.role ?? null,
    },
  }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createIdempotencyMiddleware({ store: new PostgresIdempotencyStore(sql) }))
  // As the API wires it, with billing off: these steps are about notes, not caps
  // (plan-limits.integration.test.ts covers those).
  commands.use(createEntitlementGate({
    billingEnabled: false,
    planOf: () => Promise.reject(new Error("billing is off")),
    roleOf: dependencies.groups.roleOf,
    usage: {
      maxNotes: () => Promise.reject(new Error("billing is off")),
      maxMembers: () => Promise.reject(new Error("billing is off")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(dependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(dependencies))
  commands.register(NoteMoveCommand, createNoteMoveHandler(dependencies))
  commands.register(NoteRestoreCommand, createNoteRestoreHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  queries.register(NoteLocateQuery, createNoteLocateHandler(dependencies))
  return { commands, queries, groups }
}

/** A shared group owned by a new user, with a viewer, an editor and a stranger beside it. */
async function seedGroup(sql: postgres.Sql) {
  const { groups } = buses(sql)
  const owner = await insertUser(sql)
  const editor = await insertUser(sql)
  const viewer = await insertUser(sql)
  const stranger = await insertUser(sql)
  const groupId = uuidV7()
  await groups.create({ id: groupId, name: "Team" }, owner)
  await sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
      (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner}),
      (${groupId}, ${viewer}, ${GroupRole.VIEWER}, ${owner})
  `
  return { groupId, owner, editor, viewer, stranger }
}

async function nextSequence(sql: postgres.Sql, groupId: string): Promise<string> {
  return (await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `)[0].next
}

async function outbox(sql: postgres.Sql, groupId: string): Promise<OutboxRow[]> {
  return await sql<OutboxRow[]>`
    SELECT event_kind, aggregate_type, aggregate_id::text, aggregate_version::text
    FROM outbox_events WHERE group_id = ${groupId} AND event_kind LIKE 'note.%'
    ORDER BY aggregate_version
  `
}

/** Waits, for at most five seconds, until `count` statements wait on a row lock. */
async function waitForLockWaiters(sql: postgres.Sql, count: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const [{ waiting }] = await sql<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `
    if (waiting >= count) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Fewer than ${count} statements waited on the row lock within five seconds`)
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(() => null, (error) => error)
}

Deno.test("notes against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const { commands, queries } = buses(sql)

    await t.step(
      "every write moves the group's sequence once and writes its outbox row",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const before = BigInt(await nextSequence(sql, groupId))
        const id = uuidV7()

        const created = await commands.execute(
          new NoteCreateCommand({ actor: actor(editor), groupId, id, title: "Plan", body: "a" }),
        )
        const updated = await commands.execute(
          new NoteUpdateCommand({
            actor: actor(editor),
            groupId,
            id,
            title: "Plan v2",
            body: "b",
            version: 1,
          }),
        )
        const deleted = await commands.execute(
          new NoteDeleteCommand({ actor: actor(editor), groupId, id, version: 2 }),
        )

        expect([created.note.version, updated.note.version, deleted.note.version]).toEqual([
          1,
          2,
          3,
        ])
        expect([
          created.note.changeSequence,
          updated.note.changeSequence,
          deleted.note.changeSequence,
        ])
          .toEqual([String(before), String(before + 1n), String(before + 2n)])
        expect(await nextSequence(sql, groupId)).toBe(String(before + 3n))
        expectVersion7Ids(
          await sql<{ id: string }[]>`
            SELECT id FROM outbox_events WHERE group_id = ${groupId} AND event_kind LIKE 'note.%'
          `,
        )
        expect(await outbox(sql, groupId)).toEqual([
          ["note.created", before],
          ["note.updated", before + 1n],
          ["note.deleted", before + 2n],
        ].map(([eventKind, version]) => ({
          eventKind,
          aggregateType: "group",
          aggregateId: groupId,
          aggregateVersion: String(version),
        })))
        expect(updated.note.updatedByUserId).toBe(editor)
      },
    )

    await t.step(
      "an update or delete with a stale version is refused with the current version",
      async () => {
        const { groupId, owner, editor } = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Draft", body: "" }),
        )
        await commands.execute(
          new NoteUpdateCommand({
            actor: actor(owner),
            groupId,
            id,
            title: "Owner's edit",
            body: "",
            version: 1,
          }),
        )
        const sequence = await nextSequence(sql, groupId)

        const staleUpdate = await refusal(commands.execute(
          new NoteUpdateCommand({
            actor: actor(editor),
            groupId,
            id,
            title: "Editor's edit of version 1",
            body: "",
            version: 1,
          }),
        ))
        const staleDelete = await refusal(commands.execute(
          new NoteDeleteCommand({ actor: actor(editor), groupId, id, version: 1 }),
        ))

        for (const error of [staleUpdate, staleDelete]) {
          expect(error).toBeInstanceOf(NoteVersionConflictError)
          expect((error as NoteVersionConflictError).currentVersion).toBe(2)
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(editor), groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["Owner's edit", 2])
        expect(await nextSequence(sql, groupId)).toBe(sequence)
      },
    )

    await t.step(
      "a member of one group cannot read, update or delete another group's note",
      async () => {
        const x = await seedGroup(sql)
        const y = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({
            actor: actor(x.owner),
            groupId: x.groupId,
            id,
            title: "X's",
            body: "",
          }),
        )
        const sequenceX = await nextSequence(sql, x.groupId)
        const sequenceY = await nextSequence(sql, y.groupId)

        // Y's owner passes the role check for Y, then names X's note.
        const asY = { actor: actor(y.owner), groupId: y.groupId, id }
        const refused = [
          await refusal(commands.execute(
            new NoteUpdateCommand({ ...asY, title: "Taken over", body: "", version: 1 }),
          )),
          await refusal(commands.execute(new NoteDeleteCommand({ ...asY, version: 1 }))),
          await refusal(queries.execute(new NoteGetQuery(asY))),
        ]

        for (const error of refused) {
          expect(error).toBeInstanceOf(NoteError)
          expect((error as NoteError).code).toBe("NOTE_NOT_FOUND")
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(x.owner), groupId: x.groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["X's", 1])
        expect(await nextSequence(sql, x.groupId)).toBe(sequenceX)
        expect(await nextSequence(sql, y.groupId)).toBe(sequenceY)
      },
    )

    await t.step(
      "of four concurrent updates at the same version, one wins and the others conflict",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Start", body: "" }),
        )

        // A second connection holds the note's row lock, so all four updates are waiting on it
        // at once before any of them may write: the race is forced, not left to timing.
        const holder = await sql.reserve()
        let outcomes: PromiseSettledResult<unknown>[]
        try {
          await holder`BEGIN`
          await holder`SELECT id FROM notes WHERE id = ${id} FOR UPDATE`
          const racing = Promise.allSettled([1, 2, 3, 4].map((writer) =>
            commands.execute(
              new NoteUpdateCommand({
                actor: actor(owner),
                groupId,
                id,
                title: `Writer ${writer}`,
                body: "",
                version: 1,
              }),
            )
          ))
          await waitForLockWaiters(sql, 4)
          await holder`COMMIT`
          outcomes = await racing
        } finally {
          holder.release()
        }

        const won = outcomes.filter((outcome) => outcome.status === "fulfilled")
        const lost = outcomes.flatMap((outcome) =>
          outcome.status === "rejected" ? [outcome.reason] : []
        )
        expect(won.length).toBe(1)
        expect(lost.length).toBe(3)
        for (const error of lost) {
          expect(error).toBeInstanceOf(NoteVersionConflictError)
          expect((error as NoteVersionConflictError).currentVersion).toBe(2)
        }
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id }),
        )
        expect(note.version).toBe(2)
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual([
          "note.created",
          "note.updated",
        ])
      },
    )

    await t.step(
      "a failed outbox insert rolls back the note write and the sequence change",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Kept", body: "" }),
        )
        const sequence = await nextSequence(sql, groupId)

        // Only this test's schema gets the constraint, and only for this step. NOT VALID leaves the
        // rows earlier steps wrote alone and checks only new ones.
        await sql`
          ALTER TABLE outbox_events
          ADD CONSTRAINT test_refuse_note_updates CHECK (event_kind <> 'note.updated') NOT VALID
        `
        let failure: unknown
        try {
          failure = await refusal(commands.execute(
            new NoteUpdateCommand({
              actor: actor(owner),
              groupId,
              id,
              title: "Lost",
              body: "",
              version: 1,
            }),
          ))
        } finally {
          await sql`ALTER TABLE outbox_events DROP CONSTRAINT test_refuse_note_updates`
        }

        expect(String(failure)).toContain("test_refuse_note_updates")
        expect(await nextSequence(sql, groupId)).toBe(sequence)
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual(["note.created"])
        const { note } = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id }),
        )
        expect([note.title, note.version]).toEqual(["Kept", 1])
      },
    )

    await t.step("a viewer reads the notes but cannot create, update or delete one", async () => {
      const { groupId, owner, viewer } = await seedGroup(sql)
      const id = uuidV7()
      await commands.execute(
        new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Read me", body: "" }),
      )
      const sequence = await nextSequence(sql, groupId)

      const listed = await queries.execute(
        new NoteListQuery({ actor: actor(viewer), groupId, page: { limit: 10 } }),
      )
      expect(listed.notes.map((note) => note.title)).toEqual(["Read me"])
      const refusals = [
        await refusal(commands.execute(
          new NoteCreateCommand({
            actor: actor(viewer),
            groupId,
            id: uuidV7(),
            title: "Mine",
            body: "",
          }),
        )),
        await refusal(commands.execute(
          new NoteUpdateCommand({
            actor: actor(viewer),
            groupId,
            id,
            title: "Changed",
            body: "",
            version: 1,
          }),
        )),
        await refusal(commands.execute(
          new NoteDeleteCommand({ actor: actor(viewer), groupId, id, version: 1 }),
        )),
      ]

      expect(refusals.map((error) => (error as NoteError).code)).toEqual([
        "ROLE_INSUFFICIENT",
        "ROLE_INSUFFICIENT",
        "ROLE_INSUFFICIENT",
      ])
      expect(await nextSequence(sql, groupId)).toBe(sequence)
      const { note } = await queries.execute(
        new NoteGetQuery({ actor: actor(viewer), groupId, id }),
      )
      expect([note.title, note.version]).toEqual(["Read me", 1])
    })

    await t.step("someone outside the group is told it does not exist", async () => {
      const { groupId, stranger } = await seedGroup(sql)

      const read = await refusal(queries.execute(
        new NoteListQuery({ actor: actor(stranger), groupId, page: { limit: 10 } }),
      ))
      const write = await refusal(commands.execute(
        new NoteCreateCommand({
          actor: actor(stranger),
          groupId,
          id: uuidV7(),
          title: "x",
          body: "",
        }),
      ))

      expect([(read as NoteError).code, (write as NoteError).code]).toEqual([
        "GROUP_NOT_FOUND",
        "GROUP_NOT_FOUND",
      ])
    })

    await t.step(
      "a note is located for a member of its group, and for no one else or once deleted",
      async () => {
        const { groupId, owner, viewer, stranger } = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Plan", body: "" }),
        )
        const locate = (userId: number, noteId: string) =>
          queries.execute(new NoteLocateQuery({ actor: actor(userId), id: noteId }))

        expect(await locate(viewer, id)).toEqual({ groupId })
        const foreign = await refusal(locate(stranger, id))
        const unknown = await refusal(locate(owner, uuidV7()))
        expect([(foreign as NoteError).code, (foreign as NoteError).message]).toEqual([
          "NOTE_NOT_FOUND",
          "Note not found",
        ])
        expect(foreign).toEqual(unknown)

        await commands.execute(
          new NoteDeleteCommand({ actor: actor(owner), groupId, id, version: 1 }),
        )
        expect(((await refusal(locate(owner, id))) as NoteError).code).toBe("NOTE_NOT_FOUND")
      },
    )

    await t.step(
      "a create retried with the same idempotency key answers the first result without writing",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const command = new NoteCreateCommand({
          actor: actor(editor),
          groupId,
          id: uuidV7(),
          title: "Once",
          body: "",
          idempotencyKey: "note-create-1",
        })

        const first = await commands.execute(command)
        const replay = await commands.execute(new NoteCreateCommand({ ...command.data }))

        // The stored result is JSON, so a replay reads `created: true` like the first answer.
        expect(replay).toEqual(JSON.parse(JSON.stringify(first)))
        expect((await outbox(sql, groupId)).length).toBe(1)
      },
    )

    await t.step(
      "a create retried without a key returns the note it made and records nothing more",
      async () => {
        const { groupId, editor } = await seedGroup(sql)
        const command = () =>
          new NoteCreateCommand({
            actor: actor(editor),
            groupId,
            id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d11a001",
            title: "Once",
            body: "",
          })

        const first = await commands.execute(command())
        const retry = await commands.execute(command())

        expect([first.created, retry.created]).toEqual([true, false])
        expect(retry.note.id).toBe(first.note.id)
        expect((await outbox(sql, groupId)).length).toBe(1)
      },
    )

    await t.step("the list pages newest first by cursor and leaves deleted notes out", async () => {
      const { groupId, owner } = await seedGroup(sql)
      const notes = new PostgresNoteRepository(sql)
      const ids: string[] = []
      for (const title of ["one", "two", "three"]) {
        const { note } = await notes.create(
          { groupId, id: uuidV7(), title, body: "" },
          owner,
          null,
        )
        ids.push(note.id)
        // updated_at is the transaction's start; keep the three apart.
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await notes.delete({ groupId, id: ids[1], expectedVersion: 1 }, owner)

      const first = await notes.list(groupId, { limit: 1 })
      const second = await notes.list(groupId, { limit: 1, after: first.nextPageKey! })

      expect(first.notes.map((note) => note.title)).toEqual(["three"])
      expect(second.notes.map((note) => note.title)).toEqual(["one"])
      expect(second.nextPageKey).toBe(null)
    })

    await t.step(
      "the list pages through notes written in the same millisecond, each once",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const notes = new PostgresNoteRepository(sql)
        const ids: string[] = []
        for (const title of ["a", "b", "c"]) {
          const { note } = await notes.create(
            { groupId, id: uuidV7(), title, body: "" },
            owner,
            null,
          )
          ids.push(note.id)
        }
        // Three writes ten microseconds apart, inside one millisecond. The times are built in SQL:
        // postgres.js would send a timestamp parameter through a Date, which drops the microseconds.
        for (const [index, id] of ids.entries()) {
          await sql`
            UPDATE notes
            SET updated_at = TIMESTAMPTZ '2026-10-02 12:00:00.12345+00'
              - make_interval(secs => ${index * 10} / 1000000.0)
            WHERE id = ${id}
          `
        }

        const seen: string[] = []
        let after: NoteListPageKey | undefined
        for (let page = 0; page < 5; page++) {
          const result = await notes.list(groupId, after ? { limit: 1, after } : { limit: 1 })
          seen.push(...result.notes.map((note) => note.id))
          if (!result.nextPageKey) break
          after = result.nextPageKey
        }

        expect(seen.toSorted()).toEqual(ids.toSorted())
      },
    )

    /** Two groups the editor writes in, and the notes made in the first. */
    async function twoGroups(titles: string[]) {
      const first = await seedGroup(sql)
      const second = uuidV7()
      await new PostgresGroupRepository(sql).create({ id: second, name: "Elsewhere" }, first.owner)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${second}, ${first.editor}, ${GroupRole.EDITOR}, ${first.owner})
      `
      const ids: string[] = []
      for (const title of titles) {
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({
            actor: actor(first.editor),
            groupId: first.groupId,
            id,
            title,
            body: "",
          }),
        )
        ids.push(id)
      }
      return { ...first, toGroupId: second, ids }
    }

    function move(
      userId: number,
      groupId: string,
      toGroupId: string,
      noteIds: string[],
    ) {
      return commands.execute(
        new NoteMoveCommand({ actor: actor(userId), groupId, toGroupId, noteIds }),
      )
    }

    async function auditKinds(groupId: string): Promise<string[]> {
      return (await sql<{ eventKind: string }[]>`
        SELECT event_kind FROM audit_events
        WHERE group_id = ${groupId} AND event_kind LIKE 'note.moved%'
      `).map((row) => row.eventKind)
    }

    await t.step(
      "a move keeps the note's id and history, and writes one change and one audit event per group",
      async () => {
        const { groupId, toGroupId, editor, ids } = await twoGroups(["a", "b"])
        const [fromBefore, toBefore] = [
          BigInt(await nextSequence(sql, groupId)),
          BigInt(await nextSequence(sql, toGroupId)),
        ]

        const { notes } = await move(editor, groupId, toGroupId, ids)

        expect(notes.map((note) => [note.id, note.groupId, note.version])).toEqual([
          [ids[0], toGroupId, 2],
          [ids[1], toGroupId, 2],
        ])
        expect(BigInt(await nextSequence(sql, groupId))).toBe(fromBefore + 1n)
        expect(BigInt(await nextSequence(sql, toGroupId))).toBe(toBefore + 1n)
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual([
          "note.created",
          "note.created",
          "note.moved_out",
        ])
        expect((await outbox(sql, toGroupId)).map((row) => row.eventKind)).toEqual([
          "note.moved_in",
        ])
        expect(await auditKinds(groupId)).toEqual(["note.moved_out"])
        expect(await auditKinds(toGroupId)).toEqual(["note.moved_in"])
        const read = await queries.execute(
          new NoteGetQuery({ actor: actor(editor), groupId: toGroupId, id: ids[0] }),
        )
        expect(read.note.changeSequence).toBe(String(toBefore))
        expect(
          await refusal(
            queries.execute(new NoteGetQuery({ actor: actor(editor), groupId, id: ids[0] })),
          ),
        ).toMatchObject({ code: "NOTE_NOT_FOUND" })
      },
    )

    await t.step("a move with one missing note moves none and records nothing", async () => {
      const { groupId, toGroupId, editor, ids } = await twoGroups(["a", "b"])
      const [from, to] = [await nextSequence(sql, groupId), await nextSequence(sql, toGroupId)]

      const error = await refusal(move(editor, groupId, toGroupId, [ids[0], uuidV7()]))

      expect(error).toMatchObject({ code: "NOTE_NOT_FOUND" })
      expect(await nextSequence(sql, groupId)).toBe(from)
      expect(await nextSequence(sql, toGroupId)).toBe(to)
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM notes WHERE id = ${ids[0]} AND group_id = ${groupId}
      `
      expect(count).toBe(1)
      expect(await auditKinds(groupId)).toEqual([])
    })

    await t.step("a move cannot take a note from a group other than the source", async () => {
      const { groupId, toGroupId, editor, ids } = await twoGroups(["a"])
      const third = await twoGroups(["secret"])
      const [from, to] = [await nextSequence(sql, groupId), await nextSequence(sql, toGroupId)]

      const error = await refusal(move(editor, groupId, toGroupId, [ids[0], third.ids[0]]))

      expect(error).toMatchObject({ code: "NOTE_NOT_FOUND" })
      const homes = await sql<{ id: string; groupId: string }[]>`
        SELECT id, group_id FROM notes WHERE id IN ${sql([ids[0], third.ids[0]])}
      `
      expect(new Map(homes.map((row) => [row.id, row.groupId]))).toEqual(
        new Map([[ids[0], groupId], [third.ids[0], third.groupId]]),
      )
      expect(await nextSequence(sql, groupId)).toBe(from)
      expect(await nextSequence(sql, toGroupId)).toBe(to)
    })

    await t.step(
      "a move needs edit rights in both groups, and a stranger is told the group is missing",
      async () => {
        const { groupId, toGroupId, owner, viewer, stranger, editor, ids } = await twoGroups(["a"])
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${toGroupId}, ${viewer}, ${GroupRole.EDITOR}, ${owner})
        `
        const readsThere = await insertUser(sql)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id) VALUES
            (${groupId}, ${readsThere}, ${GroupRole.EDITOR}, ${owner}),
            (${toGroupId}, ${readsThere}, ${GroupRole.VIEWER}, ${owner})
        `
        const sequence = await nextSequence(sql, toGroupId)

        const errors = [
          // A viewer in the source group, an editor in the target.
          await refusal(move(viewer, groupId, toGroupId, ids)),
          // An editor in the source group, a viewer in the target.
          await refusal(move(readsThere, groupId, toGroupId, ids)),
          // No member of the source, or of the target.
          await refusal(move(stranger, groupId, toGroupId, ids)),
          await refusal(move(owner, groupId, uuidV7(), ids)),
        ]

        expect(errors.map((error) => (error as NoteError).code)).toEqual([
          "ROLE_INSUFFICIENT",
          "ROLE_INSUFFICIENT",
          "GROUP_NOT_FOUND",
          "GROUP_NOT_FOUND",
        ])
        expect(await nextSequence(sql, toGroupId)).toBe(sequence)
        const moved = await move(editor, groupId, toGroupId, ids)
        expect(moved.notes).toHaveLength(1)
      },
    )

    await t.step(
      "a demoted editor is refused by the transaction even when the handler's check had passed",
      async () => {
        const { groupId, toGroupId, editor, ids } = await twoGroups(["a"])
        await sql`
          UPDATE group_members SET role = ${GroupRole.VIEWER}
          WHERE group_id = ${toGroupId} AND user_id = ${editor}
        `

        const error = await refusal(
          new PostgresNoteRepository(sql).move(
            { fromGroupId: groupId, toGroupId, noteIds: ids },
            editor,
            null,
          ),
        )

        expect(error).toMatchObject({ code: "ROLE_INSUFFICIENT" })
      },
    )

    await t.step("a move that would take the target over its cap moves none", async () => {
      const { groupId, toGroupId, owner, editor, ids } = await twoGroups(["a", "b"])
      const notes = new PostgresNoteRepository(sql)
      await notes.create(
        { groupId: toGroupId, id: uuidV7(), title: "x", body: "" },
        owner,
        null,
      )
      const input = { fromGroupId: groupId, toGroupId, noteIds: ids }

      const over = await refusal(notes.move(input, editor, 2))
      expect(over).toMatchObject({ code: "PLAN_LIMIT_REACHED", limit: 2 })
      expect(await notes.count(groupId)).toBe(2)

      const fits = await notes.move(input, editor, 3)

      expect(fits).toHaveLength(2)
      expect(await notes.count(toGroupId)).toBe(3)
    })

    await t.step("two moves in opposite directions both finish, none deadlocks", async () => {
      const { groupId, toGroupId, editor, ids } = await twoGroups(["a"])
      const back = uuidV7()
      await commands.execute(
        new NoteCreateCommand({
          actor: actor(editor),
          groupId: toGroupId,
          id: back,
          title: "b",
          body: "",
        }),
      )

      const results = await runBlockedOnLock(sql, groupId, [
        () => move(editor, groupId, toGroupId, ids),
        () => move(editor, toGroupId, groupId, [back]),
      ])

      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"])
    })

    await t.step(
      "a deleted note is restored by an editor, with a new version, sequence and audit row",
      async () => {
        const { groupId, owner, editor } = await seedGroup(sql)
        const id = uuidV7()
        await commands.execute(
          new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Plan", body: "x" }),
        )
        await commands.execute(
          new NoteDeleteCommand({ actor: actor(owner), groupId, id, version: 1 }),
        )
        const before = BigInt(await nextSequence(sql, groupId))

        const restored = await commands.execute(
          new NoteRestoreCommand({ actor: actor(editor), groupId, id }),
        )

        expect([restored.note.version, restored.note.updatedByUserId]).toEqual([3, editor])
        expect(restored.note.changeSequence).toBe(String(before))
        expect(await nextSequence(sql, groupId)).toBe(String(before + 1n))
        expect((await outbox(sql, groupId)).map((row) => row.eventKind)).toEqual([
          "note.created",
          "note.deleted",
          "note.restored",
        ])
        const audit = await sql<{ eventKind: string; actorUserId: number }[]>`
          SELECT event_kind, actor_user_id FROM audit_events
          WHERE group_id = ${groupId} AND event_kind = 'note.restored'
        `
        expect(audit).toEqual([{ eventKind: "note.restored", actorUserId: editor }])
        const live = await queries.execute(
          new NoteListQuery({ actor: actor(owner), groupId, page: { limit: 10 } }),
        )
        expect(live.notes.map((note) => note.title)).toEqual(["Plan"])
      },
    )

    await t.step("a viewer or a stranger cannot restore a note and nothing changes", async () => {
      const { groupId, owner, viewer, stranger } = await seedGroup(sql)
      const id = uuidV7()
      await commands.execute(
        new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Gone", body: "" }),
      )
      await commands.execute(
        new NoteDeleteCommand({ actor: actor(owner), groupId, id, version: 1 }),
      )
      const sequence = await nextSequence(sql, groupId)

      const viewerRefusal = await refusal(
        commands.execute(new NoteRestoreCommand({ actor: actor(viewer), groupId, id })),
      )
      const strangerRefusal = await refusal(
        commands.execute(new NoteRestoreCommand({ actor: actor(stranger), groupId, id })),
      )

      expect((viewerRefusal as NoteError).code).toBe("ROLE_INSUFFICIENT")
      expect((strangerRefusal as NoteError).code).toBe("GROUP_NOT_FOUND")
      expect(await nextSequence(sql, groupId)).toBe(sequence)
      const deleted = await queries.execute(
        new NoteListQuery({ actor: actor(owner), groupId, page: { limit: 10 }, deleted: true }),
      )
      expect(deleted.notes.map((note) => note.title)).toEqual(["Gone"])
    })

    await t.step("restoring a note that is not deleted is refused as not found", async () => {
      const { groupId, owner } = await seedGroup(sql)
      const id = uuidV7()
      await commands.execute(
        new NoteCreateCommand({ actor: actor(owner), groupId, id, title: "Live", body: "" }),
      )

      const error = await refusal(
        commands.execute(new NoteRestoreCommand({ actor: actor(owner), groupId, id })),
      )

      expect((error as NoteError).code).toBe("NOTE_NOT_FOUND")
    })

    await t.step("the deleted list shows only deleted notes, newest first, by cursor", async () => {
      const { groupId, owner } = await seedGroup(sql)
      const notes = new PostgresNoteRepository(sql)
      const ids: string[] = []
      for (const title of ["one", "two", "three"]) {
        const { note } = await notes.create(
          { groupId, id: uuidV7(), title, body: "" },
          owner,
          null,
        )
        ids.push(note.id)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      for (const id of [ids[0], ids[2]]) {
        await notes.delete({ groupId, id, expectedVersion: 1 }, owner)
        await new Promise((resolve) => setTimeout(resolve, 5))
      }

      const first = await notes.list(groupId, { limit: 1 }, true)
      const second = await notes.list(groupId, { limit: 1, after: first.nextPageKey! }, true)

      expect(first.notes.map((note) => note.title)).toEqual(["three"])
      expect(second.notes.map((note) => note.title)).toEqual(["one"])
      expect(second.nextPageKey).toBe(null)
    })

    await t.step(
      "a create with a NUL in the title or the body answers 400 and logs no error",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        // What the call route logs is an error nobody expected, with its stack.
        const logged: unknown[][] = []
        const app = mountRoute(
          "/call",
          createCallRoute({
            operations: createNoteOperations({
              create: (command) => commands.execute(command),
              update: (command) => commands.execute(command),
              delete: (command) => commands.execute(command),
              restore: (command) => commands.execute(command),
              move: (command) => commands.execute(command),
              get: (query) => queries.execute(query),
              locate: (query) => queries.execute(query),
              search: () => Promise.reject(new Error("not part of this test")),
              list: (query) => queries.execute(query),
              cursor: {
                encode: () => Promise.reject(new Error("no list in this step")),
                decode: () => Promise.reject(new Error("no list in this step")),
              },
            }),
            mapError: toRequestError,
            log: (...data) => void logged.push(data),
            expectedOrigin: WEB_APP_URL,
          }),
          buildAuthData({ user: { id: owner }, session: { id: owner * 10, userId: owner } }),
        )
        const create = (title: string, body: string) =>
          app.request(`${API_URL}/call/note.create`, {
            method: "POST",
            headers: {
              ...sameOriginHeaders,
              "x-realtime-user": String(owner),
              "idempotency-key": uuidV7(),
            },
            body: JSON.stringify({ groupId, id: uuidV7(), title, body }),
          })

        const refused = [await create("Pl\u0000an", "a"), await create("Plan", "a\u0000b")]
        // The same route stores ordinary prose, so the 400s are about the NUL alone.
        const stored = await create("Plan", "one\ttwo\nthree 😀")

        // One comparison, so a 500 shows together with the line it logged.
        expect({
          statuses: [...refused, stored].map((response) => response.status),
          logged: logged.map(([message]) => message),
        }).toEqual({ statuses: [400, 400, 200], logged: [] })
        for (const response of refused) {
          expect((await response.json()).error).toMatchObject({
            code: "bad_request",
            details: { code: "INVALID_REQUEST" },
          })
        }
        const rows = await sql<{ body: string }[]>`
          SELECT body FROM notes WHERE group_id = ${groupId}
        `
        expect(rows.map((row) => row.body)).toEqual(["one\ttwo\nthree 😀"])
      },
    )
  })
})
