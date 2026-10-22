/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { GroupCreateCommand, GroupRenameCommand, GroupRole } from "@domain/groups"
import { NoteCreateCommand, NoteGetQuery, NoteMoveCommand, NoteUpdateCommand } from "@domain/notes"
import {
  TAG_MAX_PER_GROUP,
  TagCreateCommand,
  TagDeleteCommand,
  TagListQuery,
  TagUpdateCommand,
  TagVersionConflictError,
} from "@domain/tags"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresGroupDataMover } from "@server/groups/postgres-group-data-mover.ts"
import { noteMovable } from "@server/notes/note-movable.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresTagRepository } from "@server/tags/postgres-tag-repository.ts"
import { createSessionGate } from "../../apps/api/cqrs/session-gate.ts"
import { createEntitlementGate } from "../../apps/api/cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../apps/api/cqrs/entitlement-needs.ts"
import {
  createNoteCreateHandler,
  createNoteGetHandler,
  createNoteMoveHandler,
  createNoteUpdateHandler,
} from "../../apps/api/features/notes/handlers.ts"
import {
  createTagCreateHandler,
  createTagDeleteHandler,
  createTagListHandler,
  createTagUpdateHandler,
} from "../../apps/api/features/tags/handlers.ts"
import {
  createGroupOperations,
  type GroupOperationDependencies,
} from "../../apps/api/features/groups/operations.ts"
import {
  createNoteOperations,
  type NoteOperationDependencies,
} from "../../apps/api/features/notes/operations.ts"
import { createTagOperations } from "../../apps/api/features/tags/operations.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { runBlockedOnLock } from "./group-team.ts"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Tags and the notes that carry them against a real Postgres built from the migrations, through
 * the same handlers and gates the API puts on its buses. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and
 * `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `tags_test_${uuidV7().replaceAll("-", "")}`
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
  const rows = await sql<{ id: number }[]>`
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

function buses(sql: postgres.Sql) {
  const groups = new PostgresGroupRepository(sql)
  const roleOf = async (groupId: string, userId: number) =>
    (await groups.getForMember(groupId, userId))?.role ?? null
  const noteDependencies = { notes: new PostgresNoteRepository(sql), groups: { roleOf } }
  const tagDependencies = { tags: new PostgresTagRepository(sql), groups: { roleOf } }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: false,
    planOf: () => Promise.reject(new Error("billing is off")),
    roleOf,
    usage: {
      maxNotes: () => Promise.reject(new Error("billing is off")),
      maxMembers: () => Promise.reject(new Error("billing is off")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(noteDependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(noteDependencies))
  commands.register(NoteMoveCommand, createNoteMoveHandler(noteDependencies))
  commands.register(TagCreateCommand, createTagCreateHandler(tagDependencies))
  commands.register(TagUpdateCommand, createTagUpdateHandler(tagDependencies))
  commands.register(TagDeleteCommand, createTagDeleteHandler(tagDependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteGetQuery, createNoteGetHandler(noteDependencies))
  queries.register(TagListQuery, createTagListHandler(tagDependencies))
  // The operations table of the socket and `POST /api/call`, which is where a payload is parsed.
  // A group create or rename goes straight to the repository: its handler adds nothing a name
  // needs, and anything else a test does not call is left out.
  const execute = <R>(command: object) => commands.execute(command as never) as Promise<R>
  const operations = {
    ...createTagOperations({
      create: execute,
      update: execute,
      delete: execute,
      list: (query) => queries.execute(query),
      get: () => Promise.reject(new Error("not part of this test")),
    }),
    ...createNoteOperations(
      { create: execute, update: execute, move: execute } as unknown as NoteOperationDependencies,
    ),
    ...createGroupOperations(
      {
        create: ({ data }: GroupCreateCommand) =>
          groups.create({ id: data.id, name: data.name }, data.actor.userId),
        rename: ({ data }: GroupRenameCommand) =>
          groups.rename(data.groupId, data.name, data.actor.userId),
      } as unknown as GroupOperationDependencies,
    ),
  }
  return { commands, queries, groups, operations }
}

interface AuditRow {
  eventKind: string
  actorUserId: number
  requestId: string | null
  entityType: string | null
  entityId: string | null
  details: Record<string, string | number>
}

/** The group's tag audit events, oldest first. */
async function tagAudit(sql: postgres.Sql, groupId: string): Promise<AuditRow[]> {
  return await sql<AuditRow[]>`
    SELECT event_kind, actor_user_id, request_id, entity_type, entity_id::text AS entity_id, details
    FROM audit_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'tag.%' ORDER BY id
  `
}

async function auditCount(sql: postgres.Sql, groupIds: string[]): Promise<number> {
  return (await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM audit_events WHERE group_id IN ${sql(groupIds)}
  `)[0].count
}

async function tagCount(sql: postgres.Sql, groupId: string): Promise<number> {
  return (await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM tags WHERE group_id = ${groupId}
  `)[0].count
}

/** Gives the group `count` more tags, named `Filler 1` and up, without going through the cap. */
async function fillTags(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
  count: number,
): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: uuidV7(),
    group_id: groupId,
    name: `Filler ${index + 1}`,
    color: "#4b5563",
    change_sequence: 1,
    created_by_user_id: userId,
    updated_by_user_id: userId,
  }))
  await sql`INSERT INTO tags ${sql(rows)}`
}

async function nextSequence(sql: postgres.Sql, groupId: string): Promise<bigint> {
  return BigInt(
    (await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `)[0].next,
  )
}

async function tagOutbox(sql: postgres.Sql, groupId: string): Promise<string[]> {
  return (await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM outbox_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'tag.%' ORDER BY aggregate_version
  `).map((row) => row.eventKind)
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(() => null, (error) => error)
}

Deno.test("tags against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const { commands, queries, groups, operations } = buses(sql)
    const notes = new PostgresNoteRepository(sql)
    const mover = new PostgresGroupDataMover(sql, [noteMovable])

    /** A group with an owner and a viewer, and a second group of the owner's. */
    async function seed() {
      const owner = await insertUser(sql)
      const viewer = await insertUser(sql)
      const groupId = uuidV7()
      const otherGroupId = uuidV7()
      await groups.create({ id: groupId, name: "Team" }, owner)
      await groups.create({ id: otherGroupId, name: "Elsewhere" }, owner)
      await sql`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${groupId}, ${viewer}, ${GroupRole.VIEWER}, ${owner})
      `
      return { owner, viewer, groupId, otherGroupId }
    }

    const createTag = (userId: number, groupId: string, name: string, id = uuidV7()) =>
      commands.execute(
        new TagCreateCommand({ actor: actor(userId), groupId, id, name, color: "#1d4ed8" }),
      )

    const createNote = (
      userId: number,
      groupId: string,
      tagIds: string[] | undefined,
      id = uuidV7(),
    ) =>
      commands.execute(
        new NoteCreateCommand({
          actor: actor(userId),
          groupId,
          id,
          title: "Plan",
          body: "",
          tagIds,
        }),
      )

    await t.step(
      "every tag write moves the group's sequence once and writes its outbox row",
      async () => {
        const { owner, groupId } = await seed()
        const before = await nextSequence(sql, groupId)

        const { tag } = await createTag(owner, groupId, "Work")
        const renamed = await commands.execute(
          new TagUpdateCommand({
            actor: actor(owner),
            groupId,
            id: tag.id,
            name: "Job",
            color: "#b91c1c",
            version: 1,
          }),
        )
        await commands.execute(
          new TagDeleteCommand({ actor: actor(owner), groupId, id: tag.id, version: 2 }),
        )

        expect(renamed.tag).toMatchObject({ name: "Job", color: "#b91c1c", version: 2 })
        expect(await nextSequence(sql, groupId)).toBe(before + 3n)
        expect(await tagOutbox(sql, groupId)).toEqual(["tag.created", "tag.updated", "tag.deleted"])
      },
    )

    await t.step("a viewer lists the tags and cannot write one", async () => {
      const { owner, viewer, groupId } = await seed()
      await createTag(owner, groupId, "Work")

      const listed = await queries.execute(new TagListQuery({ actor: actor(viewer), groupId }))
      const refused = await refusal(createTag(viewer, groupId, "Mine"))

      expect(listed.tags.map((tag) => tag.name)).toEqual(["Work"])
      expect(refused).toMatchObject({ code: "ROLE_INSUFFICIENT" })
    })

    await t.step(
      "the list counts each tag's live notes and leaves a deleted note out",
      async () => {
        const { owner, viewer, groupId } = await seed()
        const { tag: work } = await createTag(owner, groupId, "Work")
        const { tag: home } = await createTag(owner, groupId, "Home")
        await createNote(owner, groupId, [work.id, home.id])
        await createNote(owner, groupId, [work.id])
        const { note: gone } = await createNote(owner, groupId, [work.id])
        await notes.delete({ groupId, id: gone.id, expectedVersion: gone.version }, owner)

        const listed = await queries.execute(new TagListQuery({ actor: actor(viewer), groupId }))

        expect(listed.tags.map(({ name, noteCount }) => [name, noteCount])).toEqual([
          ["Home", 1],
          ["Work", 2],
        ])
      },
    )

    await t.step("the database refuses a colour that is no lower-case #rrggbb", async () => {
      const { owner, groupId } = await seed()
      const { tag } = await createTag(owner, groupId, "Loud")
      for (const color of ["blue", "#FACC15", "#facc1"]) {
        await expect(sql`UPDATE tags SET color = ${color} WHERE id = ${tag.id}`).rejects.toThrow(
          "tags_color_check",
        )
        await expect(sql`UPDATE groups SET color = ${color} WHERE id = ${groupId}`).rejects
          .toThrow("groups_color_check")
      }
    })

    await t.step("a name another tag of the group has is refused whatever its case", async () => {
      const { owner, groupId, otherGroupId } = await seed()
      await createTag(owner, groupId, "Work")
      const before = await nextSequence(sql, groupId)

      const clash = await refusal(createTag(owner, groupId, "WORK"))
      const elsewhere = await createTag(owner, otherGroupId, "work")

      expect(clash).toMatchObject({ code: "TAG_NAME_TAKEN" })
      expect(elsewhere.created).toBe(true)
      expect(await nextSequence(sql, groupId)).toBe(before)
    })

    await t.step("a stale rename or delete conflicts and names the current version", async () => {
      const { owner, groupId } = await seed()
      const { tag } = await createTag(owner, groupId, "Work")

      const rename = await refusal(commands.execute(
        new TagUpdateCommand({
          actor: actor(owner),
          groupId,
          id: tag.id,
          name: "Job",
          color: "#b91c1c",
          version: 7,
        }),
      ))
      const remove = await refusal(commands.execute(
        new TagDeleteCommand({ actor: actor(owner), groupId, id: tag.id, version: 7 }),
      ))

      expect(rename).toBeInstanceOf(TagVersionConflictError)
      expect((remove as TagVersionConflictError).currentVersion).toBe(1)
    })

    await t.step(
      "a member of another group cannot rename or delete a tag by naming their own group",
      async () => {
        const { owner, groupId } = await seed()
        const stranger = await insertUser(sql)
        const strangerGroupId = uuidV7()
        await groups.create({ id: strangerGroupId, name: "Theirs" }, stranger)
        const { tag } = await createTag(owner, groupId, "Work")

        const rename = await refusal(commands.execute(
          new TagUpdateCommand({
            actor: actor(stranger),
            groupId: strangerGroupId,
            id: tag.id,
            name: "Mine",
            color: "#b91c1c",
            version: 1,
          }),
        ))
        const remove = await refusal(commands.execute(
          new TagDeleteCommand({
            actor: actor(stranger),
            groupId: strangerGroupId,
            id: tag.id,
            version: 1,
          }),
        ))

        expect(rename).toMatchObject({ code: "TAG_NOT_FOUND" })
        expect(remove).toMatchObject({ code: "TAG_NOT_FOUND" })
        const [row] = await sql<{ name: string; version: number }[]>`
          SELECT name, version FROM tags WHERE id = ${tag.id}
        `
        expect(row).toEqual({ name: "Work", version: 1 })
      },
    )

    await t.step(
      "the repository refuses a viewer on every tag write, whatever the handler checked",
      async () => {
        const { owner, viewer, groupId } = await seed()
        const { tag } = await createTag(owner, groupId, "Work")
        const repository = new PostgresTagRepository(sql)

        const create = await refusal(repository.create(
          { groupId, id: uuidV7(), name: "New", color: "#1d4ed8" },
          viewer,
        ))
        const update = await refusal(repository.update(
          { groupId, id: tag.id, name: "Job", color: "#b91c1c", expectedVersion: 1 },
          viewer,
        ))
        const remove = await refusal(
          repository.delete({ groupId, id: tag.id, expectedVersion: 1 }, viewer),
        )

        expect(create).toMatchObject({ code: "ROLE_INSUFFICIENT" })
        expect(update).toMatchObject({ code: "ROLE_INSUFFICIENT" })
        expect(remove).toMatchObject({ code: "ROLE_INSUFFICIENT" })
        const [row] = await sql<{ name: string }[]>`SELECT name FROM tags WHERE id = ${tag.id}`
        expect(row.name).toBe("Work")
      },
    )

    await t.step(
      "a note write naming an unknown tag id succeeds and keeps only real tags",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        const { tag } = await createTag(owner, groupId, "Work")
        const { tag: foreign } = await createTag(owner, otherGroupId, "Elsewhere")
        const unknown = uuidV7()

        const created = await createNote(owner, groupId, [unknown, tag.id, foreign.id])
        const updated = await commands.execute(
          new NoteUpdateCommand({
            actor: actor(owner),
            groupId,
            id: created.note.id,
            title: "Plan",
            body: "",
            tagIds: [unknown],
            version: 1,
          }),
        )

        expect(created.note.tagIds).toEqual([tag.id])
        expect(updated.note.tagIds).toEqual([])
      },
    )

    await t.step("an update that names no tags keeps the note's tags", async () => {
      const { owner, groupId } = await seed()
      const { tag } = await createTag(owner, groupId, "Work")
      const { note } = await createNote(owner, groupId, [tag.id])

      const updated = await commands.execute(
        new NoteUpdateCommand({
          actor: actor(owner),
          groupId,
          id: note.id,
          title: "Plan 2",
          body: "",
          version: 1,
        }),
      )

      expect(updated.note.tagIds).toEqual([tag.id])
    })

    await t.step("deleting a tag removes its links and changes no note's version", async () => {
      const { owner, groupId } = await seed()
      const { tag } = await createTag(owner, groupId, "Work")
      const { note } = await createNote(owner, groupId, [tag.id])
      const before = (await sql<{ version: number; changeSequence: string; updatedAt: Date }[]>`
        SELECT version, change_sequence::text AS change_sequence, updated_at
        FROM notes WHERE id = ${note.id}
      `)[0]

      await commands.execute(
        new TagDeleteCommand({ actor: actor(owner), groupId, id: tag.id, version: 1 }),
      )

      const after = (await sql<{ version: number; changeSequence: string; updatedAt: Date }[]>`
        SELECT version, change_sequence::text AS change_sequence, updated_at
        FROM notes WHERE id = ${note.id}
      `)[0]
      const read = await queries.execute(
        new NoteGetQuery({ actor: actor(owner), groupId, id: note.id }),
      )
      expect(after).toEqual(before)
      expect(read.note.tagIds).toEqual([])
      expect(await sql`SELECT 1 FROM note_tags WHERE tag_id = ${tag.id}`).toHaveLength(0)
    })

    await t.step(
      "moving a tagged note keeps its tags by name, creating the missing ones",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        const { tag: work } = await createTag(owner, groupId, "Work")
        const { tag: home } = await createTag(owner, groupId, "Home")
        const { tag: existing } = await createTag(owner, otherGroupId, "work")
        const { note } = await createNote(owner, groupId, [work.id, home.id])

        const { notes } = await commands.execute(
          new NoteMoveCommand({
            actor: actor(owner),
            groupId,
            toGroupId: otherGroupId,
            noteIds: [note.id],
          }),
        )

        const targetTags = await queries.execute(
          new TagListQuery({ actor: actor(owner), groupId: otherGroupId }),
        )
        const home2 = targetTags.tags.find((tag) => tag.name === "Home")!
        expect(targetTags.tags.map((tag) => tag.name)).toEqual(["Home", "work"])
        expect(home2.id).not.toBe(home.id)
        expectVersion7Ids([home2])
        expect(home2.color).toBe("#1d4ed8")
        expect([...notes[0].tagIds].sort()).toEqual([existing.id, home2.id].sort())
        const sourceTags = await queries.execute(new TagListQuery({ actor: actor(owner), groupId }))
        expect(sourceTags.tags.map((tag) => tag.name)).toEqual(["Home", "Work"])
      },
    )

    const call = (userId: number, name: string, payload: unknown) =>
      Promise.resolve(operations[name].handle({
        actor: actor(userId),
        requestId: "req-tags",
        signal: new AbortController().signal,
        idempotencyKey: uuidV7(),
        payload,
      }))

    await t.step(
      "a NUL in a tag name or a group name is refused as invalid, and nothing is written",
      async () => {
        const { owner, groupId } = await seed()
        const { tag } = await createTag(owner, groupId, "Work")
        const nul = "a\u0000b"
        const newGroupId = uuidV7()
        const before = await nextSequence(sql, groupId)

        const refusals = [
          await refusal(call(owner, "tag.create", {
            groupId,
            id: uuidV7(),
            name: nul,
            color: "#b91c1c",
          })),
          await refusal(call(owner, "tag.update", {
            groupId,
            id: tag.id,
            name: nul,
            color: "#b91c1c",
            version: 1,
          })),
          await refusal(call(owner, "group.create", { id: newGroupId, name: nul })),
          await refusal(call(owner, "group.rename", { groupId, name: nul })),
        ]

        // `INVALID_REQUEST` is the code every route and the socket answer with 400 or
        // `bad_request`; a Postgres error would have no code of the domain's.
        expect(refusals.map((error) => (error as { code?: string } | null)?.code)).toEqual(
          Array(4).fill("INVALID_REQUEST"),
        )
        expect(await nextSequence(sql, groupId)).toBe(before)
        expect(await sql`SELECT 1 FROM groups WHERE id = ${newGroupId}`).toHaveLength(0)
        // The same calls with a clean name are stored, so the refusals above are the name's.
        await call(owner, "tag.create", { groupId, id: uuidV7(), name: "a b", color: "#b91c1c" })
        await call(owner, "group.create", { id: newGroupId, name: "a b" })
        expect(await sql`SELECT 1 FROM groups WHERE id = ${newGroupId}`).toHaveLength(1)
      },
    )

    await t.step(
      "refuses the tag that would pass the cap, and answers a retry of the last one that fit",
      async () => {
        const { owner, groupId } = await seed()
        await fillTags(sql, groupId, owner, TAG_MAX_PER_GROUP - 1)
        const lastId = uuidV7()
        const last = await createTag(owner, groupId, "Last", lastId)
        const before = await nextSequence(sql, groupId)
        const auditBefore = (await tagAudit(sql, groupId)).length

        const over = await refusal(createTag(owner, groupId, "One too many"))
        const retried = await createTag(owner, groupId, "Last", lastId)

        expect(last.created).toBe(true)
        expect(over).toMatchObject({ code: "TAG_LIMIT_REACHED" })
        expect(retried).toMatchObject({ created: false, tag: { id: lastId } })
        expect(await tagCount(sql, groupId)).toBe(TAG_MAX_PER_GROUP)
        expect(await nextSequence(sql, groupId)).toBe(before)
        expect(await tagAudit(sql, groupId)).toHaveLength(auditBefore)
      },
    )

    await t.step("two creates at once cannot both take the last place under the cap", async () => {
      const { owner, groupId } = await seed()
      await fillTags(sql, groupId, owner, TAG_MAX_PER_GROUP - 1)

      // Both creates are held at the group's lock before either inserts, so a count taken before
      // the lock would let both through.
      const results = await runBlockedOnLock(sql, groupId, [
        () => createTag(owner, groupId, "First"),
        () => createTag(owner, groupId, "Second"),
      ])

      const refused = results.filter((result) => result.status === "rejected")
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(refused).toHaveLength(1)
      expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "TAG_LIMIT_REACHED",
      })
      expect(await tagCount(sql, groupId)).toBe(TAG_MAX_PER_GROUP)
    })

    await t.step(
      "refuses a move whose tags do not fit the other group, and leaves the note and its tags",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        await fillTags(sql, otherGroupId, owner, TAG_MAX_PER_GROUP)
        const { tag } = await createTag(owner, groupId, "Work")
        const { note } = await createNote(owner, groupId, [tag.id])
        const before = await nextSequence(sql, otherGroupId)

        const refused = await refusal(commands.execute(
          new NoteMoveCommand({
            actor: actor(owner),
            groupId,
            toGroupId: otherGroupId,
            noteIds: [note.id],
          }),
        ))

        expect(refused).toMatchObject({ code: "TAG_LIMIT_REACHED" })
        const read = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id: note.id }),
        )
        expect(read.note).toMatchObject({ groupId, tagIds: [tag.id], version: 1 })
        expect(await tagCount(sql, otherGroupId)).toBe(TAG_MAX_PER_GROUP)
        expect(await nextSequence(sql, otherGroupId)).toBe(before)
        expect(await tagAudit(sql, otherGroupId)).toEqual([])
      },
    )

    await t.step(
      "a move may bring the other group to exactly the cap, and the next new tag is refused",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        await fillTags(sql, otherGroupId, owner, TAG_MAX_PER_GROUP - 1)
        const { tag: last } = await createTag(owner, groupId, "Last place")
        const { tag: over } = await createTag(owner, groupId, "One too many")
        const { note: fits } = await createNote(owner, groupId, [last.id])
        const { note: late } = await createNote(owner, groupId, [over.id])
        const move = (noteId: string) =>
          commands.execute(
            new NoteMoveCommand({
              actor: actor(owner),
              groupId,
              toGroupId: otherGroupId,
              noteIds: [noteId],
            }),
          )

        const { notes: moved } = await move(fits.id)
        const refused = await refusal(move(late.id))

        expect(moved[0].groupId).toBe(otherGroupId)
        expect(await tagCount(sql, otherGroupId)).toBe(TAG_MAX_PER_GROUP)
        expect(refused).toMatchObject({ code: "TAG_LIMIT_REACHED" })
      },
    )

    await t.step(
      "moving all of a group's data into a group with no room for its tags changes nothing",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        await fillTags(sql, otherGroupId, owner, TAG_MAX_PER_GROUP)
        const { tag } = await createTag(owner, groupId, "Work")
        const { note } = await createNote(owner, groupId, [tag.id])
        const before = [await nextSequence(sql, groupId), await nextSequence(sql, otherGroupId)]
        const audited = await auditCount(sql, [groupId, otherGroupId])

        const refused = await refusal(mover.moveAll(
          { fromGroupId: groupId, toGroupId: otherGroupId, requestId: "req-all" },
          owner,
          { maxNotes: null },
        ))

        expect(refused).toMatchObject({ code: "TAG_LIMIT_REACHED" })
        const read = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId, id: note.id }),
        )
        expect(read.note).toMatchObject({ groupId, tagIds: [tag.id], version: 1 })
        expect(await tagCount(sql, otherGroupId)).toBe(TAG_MAX_PER_GROUP)
        expect([await nextSequence(sql, groupId), await nextSequence(sql, otherGroupId)])
          .toEqual(before)
        expect(await auditCount(sql, [groupId, otherGroupId])).toBe(audited)
      },
    )

    await t.step(
      "moving all of a group's data writes an audit event with the request for each tag it creates",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        const { tag } = await createTag(owner, groupId, "Work")
        const { note } = await createNote(owner, groupId, [tag.id])

        await mover.moveAll(
          { fromGroupId: groupId, toGroupId: otherGroupId, requestId: "req-all" },
          owner,
          { maxNotes: null },
        )

        const [created] = await sql<{ id: string }[]>`
          SELECT id FROM tags WHERE group_id = ${otherGroupId} AND name = 'Work'
        `
        expect(await tagAudit(sql, otherGroupId)).toEqual([{
          eventKind: "tag.created",
          actorUserId: owner,
          requestId: "req-all",
          entityType: "tag",
          entityId: created.id,
          details: { name: "Work" },
        }])
        const read = await queries.execute(
          new NoteGetQuery({ actor: actor(owner), groupId: otherGroupId, id: note.id }),
        )
        expect(read.note.tagIds).toEqual([created.id])
      },
    )

    await t.step(
      "moves a note into a group that is full of tags when the group has its tags already",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        await fillTags(sql, otherGroupId, owner, TAG_MAX_PER_GROUP - 1)
        const { tag: existing } = await createTag(owner, otherGroupId, "work")
        const { tag } = await createTag(owner, groupId, "Work")
        const { note } = await createNote(owner, groupId, [tag.id])

        const { notes } = await commands.execute(
          new NoteMoveCommand({
            actor: actor(owner),
            groupId,
            toGroupId: otherGroupId,
            noteIds: [note.id],
          }),
        )

        expect(notes[0]).toMatchObject({ groupId: otherGroupId, tagIds: [existing.id] })
        expect(await tagCount(sql, otherGroupId)).toBe(TAG_MAX_PER_GROUP)
      },
    )

    await t.step(
      "a tag's create, rename, recolour and delete each write an audit event with the request",
      async () => {
        const { owner, groupId } = await seed()
        const id = uuidV7()
        const tag = { groupId, id }
        await call(owner, "tag.create", { ...tag, name: "Work", color: "#1d4ed8" })
        await createNote(owner, groupId, [id])
        await createNote(owner, groupId, [id])
        // A note in the trash keeps its link, and is not one of the notes that "carried" the tag.
        const { note: trashed } = await createNote(owner, groupId, [id])
        await notes.delete({ groupId, id: trashed.id, expectedVersion: 1 }, owner)

        await call(owner, "tag.update", { ...tag, name: "Job", color: "#1d4ed8", version: 1 })
        await call(owner, "tag.update", { ...tag, name: "Job", color: "#b91c1c", version: 2 })
        await call(owner, "tag.delete", { ...tag, version: 3 })

        const event = { actorUserId: owner, requestId: "req-tags", entityType: "tag", entityId: id }
        expect(await tagAudit(sql, groupId)).toEqual([
          { ...event, eventKind: "tag.created", details: { name: "Work" } },
          { ...event, eventKind: "tag.updated", details: { name: "Job", from: "Work" } },
          { ...event, eventKind: "tag.updated", details: { name: "Job", color: "#b91c1c" } },
          { ...event, eventKind: "tag.deleted", details: { name: "Job", notes: 2 } },
        ])
      },
    )

    await t.step(
      "a note whose stored title holds a direction mark, a tab or a soft hyphen still saves a new body",
      async () => {
        const { owner, groupId } = await seed()
        for (const title of ["שלום\u200f!", "Q3\tbudget", "Co\u00adop plan"]) {
          const id = uuidV7()
          await call(owner, "note.create", { groupId, id, title, body: "" })

          await call(owner, "note.update", { groupId, id, title, body: "New body", version: 1 })

          const { note } = await queries.execute(
            new NoteGetQuery({ actor: actor(owner), groupId, id }),
          )
          expect(note).toMatchObject({ title, body: "New body", version: 2 })
        }
      },
    )

    await t.step("a refused tag write leaves no audit event", async () => {
      const { owner, viewer, groupId } = await seed()
      const { tag } = await createTag(owner, groupId, "Work")
      await createTag(owner, groupId, "Home")
      const written = (await tagAudit(sql, groupId)).length

      await refusal(createTag(viewer, groupId, "Mine"))
      await refusal(createTag(owner, groupId, "work"))
      await refusal(commands.execute(
        new TagUpdateCommand({
          actor: actor(owner),
          groupId,
          id: tag.id,
          name: "home",
          color: "#b91c1c",
          version: 1,
        }),
      ))
      await refusal(commands.execute(
        new TagDeleteCommand({ actor: actor(owner), groupId, id: tag.id, version: 7 }),
      ))

      expect(await tagAudit(sql, groupId)).toHaveLength(written)
    })

    await t.step(
      "a move writes an audit event for each tag it creates in the other group, and none for one it finds",
      async () => {
        const { owner, groupId, otherGroupId } = await seed()
        const { tag: work } = await createTag(owner, groupId, "Work")
        const { tag: home } = await createTag(owner, groupId, "Home")
        await createTag(owner, otherGroupId, "work")
        const { note } = await createNote(owner, groupId, [work.id, home.id])
        const written = (await tagAudit(sql, otherGroupId)).length

        await call(owner, "note.move", { groupId, toGroupId: otherGroupId, noteIds: [note.id] })

        const created = (await tagAudit(sql, otherGroupId)).slice(written)
        const home2 = (await sql<{ id: string }[]>`
          SELECT id FROM tags WHERE group_id = ${otherGroupId} AND name = 'Home'
        `)[0]
        expect(created).toEqual([{
          eventKind: "tag.created",
          actorUserId: owner,
          requestId: "req-tags",
          entityType: "tag",
          entityId: home2.id,
          details: { name: "Home" },
        }])
      },
    )
  })
})
