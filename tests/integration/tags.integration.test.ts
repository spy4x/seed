/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { GroupRole } from "@domain/groups"
import { NoteCreateCommand, NoteGetQuery, NoteMoveCommand, NoteUpdateCommand } from "@domain/notes"
import {
  TagCreateCommand,
  TagDeleteCommand,
  TagListQuery,
  TagUpdateCommand,
  TagVersionConflictError,
} from "@domain/tags"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
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
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
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
  return { commands, queries, groups }
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
    const { commands, queries, groups } = buses(sql)

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
        new TagCreateCommand({ actor: actor(userId), groupId, id, name, color: "blue" }),
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
            color: "red",
            version: 1,
          }),
        )
        await commands.execute(
          new TagDeleteCommand({ actor: actor(owner), groupId, id: tag.id, version: 2 }),
        )

        expect(renamed.tag).toMatchObject({ name: "Job", color: "red", version: 2 })
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
          color: "red",
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
            color: "red",
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
          { groupId, id: uuidV7(), name: "New", color: "blue" },
          viewer,
        ))
        const update = await refusal(repository.update(
          { groupId, id: tag.id, name: "Job", color: "red", expectedVersion: 1 },
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
        expect(home2.color).toBe("blue")
        expect([...notes[0].tagIds].sort()).toEqual([existing.id, home2.id].sort())
        const sourceTags = await queries.execute(new TagListQuery({ actor: actor(owner), groupId }))
        expect(sourceTags.tags.map((tag) => tag.name)).toEqual(["Home", "Work"])
      },
    )
  })
})
