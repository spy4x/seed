/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { PlanError } from "@domain/billing"
import { GROUP_EXPORT_VERSION, GroupError, GroupImportError, GroupRole } from "@domain/groups"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresGroupPorter } from "@server/groups/postgres-group-porter.ts"
import { readAdminGroup } from "@server/groups/admin-groups.ts"
import { portable } from "@server/groups/portable.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { PostgresTagRepository } from "@server/tags/postgres-tag-repository.ts"
import { tagPortable } from "@server/tags/tag-portable.ts"
import { notePortable } from "@server/notes/note-portable.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { GroupExportCommand } from "@domain/groups"
import { createGroupExportHandler } from "../../apps/api/features/groups/files.ts"
import { PORTABLE_AGGREGATES } from "../../apps/api/services/db-base.ts"
import { insertUser, withSchema } from "./group-team.ts"

/**
 * A group's export file and the import of one against a real Postgres: the round trip under new
 * ids into a group the importer owns, the owner-only export, and nothing written for a file the
 * import refuses or an import that fails halfway. Needs `DB_*` (recipe in docs/handoff.md); it
 * fails when they are missing.
 */

const NO_CAP = { maxNotes: null }

async function seed(sql: postgres.Sql) {
  const groups = new PostgresGroupRepository(sql)
  const notes = new PostgresNoteRepository(sql)
  const tags = new PostgresTagRepository(sql)
  const owner = await insertUser(sql)
  const groupId = uuidV7()
  await groups.create(
    { id: groupId, name: "Family", description: "Our home", color: "#15803d", emoji: "🏡" },
    owner,
  )
  const home = uuidV7()
  const work = uuidV7()
  await tags.create({ groupId, id: home, name: "Home", color: "#1d4ed8" }, owner)
  await tags.create({ groupId, id: work, name: "Work", color: "#b91c1c" }, owner)
  const noteIds = [uuidV7(), uuidV7(), uuidV7(), uuidV7()]
  await notes.create(
    { groupId, id: noteIds[0], title: "Groceries", body: "Milk", tagIds: [home] },
    owner,
    null,
  )
  await notes.create(
    { groupId, id: noteIds[1], title: "Plan", body: "Q4", tagIds: [home, work] },
    owner,
    null,
  )
  await notes.create({ groupId, id: noteIds[2], title: "Plain", body: "" }, owner, null)
  await notes.create({ groupId, id: noteIds[3], title: "Gone", body: "" }, owner, null)
  await notes.delete({ groupId, id: noteIds[3], expectedVersion: 1 }, owner)
  return { owner, groupId, tagIds: [home, work], noteIds }
}

/** The export file the owner downloads, through the handler, as the parsed JSON. */
async function exportAs(sql: postgres.Sql, groupId: string, userId: number): Promise<unknown> {
  const groups = new PostgresGroupRepository(sql)
  const handler = createGroupExportHandler({
    roleOf: async (id, user) => (await groups.getForMember(id, user))?.role ?? null,
    porter: new PostgresGroupPorter(sql, PORTABLE_AGGREGATES),
    newGroupAllowances: () => NO_CAP,
  })
  const file = await handler(
    new GroupExportCommand({
      actor: {
        userId,
        userMfa: UserMFAStatus.NOT_CONFIGURED,
        sessionSecondFactor: SecondFactorStatus.NotRequired,
      },
      groupId,
      requestId: "req-export",
    }),
  )
  let text = ""
  for await (const piece of file.chunks) text += piece
  return JSON.parse(text)
}

/** What a group holds, in a shape two groups can be compared by: notes with their tags' names. */
async function contents(sql: postgres.Sql, groupId: string) {
  const notes = await sql<{ title: string; body: string; tags: string[] }[]>`
    SELECT n.title, n.body,
      COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags
    FROM notes n
    LEFT JOIN note_tags nt ON nt.note_id = n.id
    LEFT JOIN tags t ON t.id = nt.tag_id
    WHERE n.group_id = ${groupId} AND n.deleted_at IS NULL
    GROUP BY n.id ORDER BY n.title
  `
  const tags = await sql<{ name: string; color: string }[]>`
    SELECT name, color FROM tags WHERE group_id = ${groupId} ORDER BY name
  `
  return { notes: [...notes], tags: [...tags] }
}

async function counts(sql: postgres.Sql) {
  const [row] = await sql<{ groups: number; notes: number; tags: number; links: number }[]>`
    SELECT
      (SELECT count(*)::int FROM groups) AS groups,
      (SELECT count(*)::int FROM notes) AS notes,
      (SELECT count(*)::int FROM tags) AS tags,
      (SELECT count(*)::int FROM note_tags) AS links
  `
  return row
}

Deno.test("an export imported by another person gives the same notes and tags under new ids", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const file = await exportAs(sql, source.groupId, source.owner) as {
      version: number
      aggregates: { notes: unknown[] }
    }
    expect(file.version).toBe(GROUP_EXPORT_VERSION)
    // The deleted note stays behind.
    expect(file.aggregates.notes).toHaveLength(3)

    const importer = await insertUser(sql)
    const result = await new PostgresGroupPorter(sql, PORTABLE_AGGREGATES).importGroup(
      { file, name: null, requestId: "req-import" },
      importer,
      NO_CAP,
    )
    const copy = result.group.id
    expect(copy).not.toBe(source.groupId)
    expect(result.group.role).toBe(GroupRole.OWNER)
    expect(result.parts.map((part) => [part.kind, part.count])).toEqual([["notes", 3], ["tags", 2]])
    expect(await contents(sql, copy)).toEqual(await contents(sql, source.groupId))

    const [group] = await sql<
      { name: string; description: string; color: string; emoji: string; ownerUserId: number }[]
    >`
      SELECT name, description, color, emoji, owner_user_id, created_by_user_id, imported_at
      FROM groups WHERE id = ${copy}
    `
    expect(group).toMatchObject({
      name: "Family",
      description: "Our home",
      color: "#15803d",
      emoji: "🏡",
      ownerUserId: importer,
      createdByUserId: importer,
    })
    expect((group as unknown as { importedAt: Date | null }).importedAt).toBeInstanceOf(Date)
    const members = await sql`SELECT user_id, role FROM group_members WHERE group_id = ${copy}`
    expect([...members]).toEqual([{ userId: importer, role: GroupRole.OWNER }])

    // Every entity has a new id: none of the source's ids is in the copy.
    const ids = await sql<{ id: string }[]>`
      SELECT id FROM notes WHERE group_id = ${copy} UNION ALL SELECT id FROM tags WHERE group_id = ${copy}
    `
    expect(ids).toHaveLength(5)
    for (const { id } of ids) {
      expect([...source.noteIds, ...source.tagIds]).not.toContain(id)
      expect(id[14]).toBe("7")
    }

    // The source is untouched and its log says who exported it; the copy's log says who imported.
    expect((await contents(sql, source.groupId)).notes).toHaveLength(3)
    const exported = await sql`
      SELECT actor_user_id, request_id FROM audit_events
      WHERE group_id = ${source.groupId} AND event_kind = 'group.exported'
    `
    expect([...exported]).toEqual([{ actorUserId: source.owner, requestId: "req-export" }])
    const imported = await sql`
      SELECT actor_user_id, details FROM audit_events
      WHERE group_id = ${copy} AND event_kind = 'group.imported'
    `
    expect([...imported]).toEqual([
      { actorUserId: importer, details: { notes: 3, tags: 2, count: 5 } },
    ])
    const outbox = await sql`SELECT 1 FROM outbox_events WHERE group_id = ${copy}`
    expect(outbox.length).toBe(1)

    // The admin panel says the copy was imported, and by whom; the source was created empty.
    expect((await readAdminGroup(sql, copy))?.imported?.by?.id).toBe(importer)
    expect((await readAdminGroup(sql, source.groupId))?.imported).toBe(null)
  })
})

Deno.test("an import takes the name the person gave instead of the file's", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const file = await exportAs(sql, source.groupId, source.owner)
    const result = await new PostgresGroupPorter(sql, PORTABLE_AGGREGATES).importGroup(
      { file, name: "  Family copy " },
      source.owner,
      NO_CAP,
    )
    expect(result.group.name).toBe("Family copy")
  })
})

Deno.test("only the owner exports, and another tenant's group cannot be exported", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const admin = await insertUser(sql)
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${source.groupId}, ${admin}, ${GroupRole.ADMIN}, ${source.owner})
    `
    const stranger = await insertUser(sql)
    await new PostgresGroupRepository(sql).create({ id: uuidV7(), name: "Theirs" }, stranger)

    const refused = async (userId: number) => {
      try {
        await exportAs(sql, source.groupId, userId)
      } catch (error) {
        return error instanceof GroupError ? error.code : String(error)
      }
      return "exported"
    }
    expect(await refused(admin)).toBe("ROLE_INSUFFICIENT")
    expect(await refused(stranger)).toBe("GROUP_NOT_FOUND")
    const audits = await sql`SELECT 1 FROM audit_events WHERE event_kind = 'group.exported'`
    expect(audits.length).toBe(0)
  })
})

Deno.test("a refused file, a file over the plan and a failure halfway write nothing", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const file = await exportAs(sql, source.groupId, source.owner) as Record<string, unknown>
    const before = await counts(sql)
    const porter = new PostgresGroupPorter(sql, PORTABLE_AGGREGATES)
    const attempt = async (
      run: () => Promise<unknown>,
      // deno-lint-ignore no-explicit-any
      kind: new (...args: any[]) => Error,
    ) => {
      await expect(run()).rejects.toThrow(kind)
      expect(await counts(sql)).toEqual(before)
    }

    await attempt(
      () =>
        porter.importGroup({ file: { ...file, version: 99 }, name: null }, source.owner, NO_CAP),
      GroupImportError,
    )
    await attempt(
      () =>
        porter.importGroup(
          { file: { ...file, aggregates: { notes: [{ title: "No id" }] } }, name: null },
          source.owner,
          NO_CAP,
        ),
      GroupImportError,
    )
    await attempt(
      () => porter.importGroup({ file, name: null }, source.owner, { maxNotes: 2 }),
      PlanError,
    )
    // An aggregate that fails after the group and the tags are written takes them back with it.
    let reached = false
    const failing = portable({
      ...tagPortable,
      kind: "notes",
      check: undefined,
      parse: (value) => value as { id: string },
      write: () => {
        reached = true
        return Promise.reject(new Error("disk full"))
      },
    })
    await attempt(
      () =>
        new PostgresGroupPorter(sql, [tagPortable, failing]).importGroup(
          { file, name: null },
          source.owner,
          NO_CAP,
        ),
      Error,
    )
    expect(reached).toBe(true)
  })
})

Deno.test("ten exports whose readers stopped leave the pool free, and a long group pages whole", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    // More notes than one page holds, so each export reads its notes in two queries.
    const extra = Array.from({ length: 600 }, (_, index) => ({
      id: uuidV7(),
      title: `Extra ${index}`,
      body: "",
      tagIds: [],
      createdAt: "2026-10-01T09:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
    }))
    await sql.begin((tx) =>
      notePortable.write(tx, extra, {
        groupId: source.groupId,
        actorId: source.owner,
        changeSequence: "1",
        newIdOf: () => undefined,
      })
    )
    const porter = new PostgresGroupPorter(sql, PORTABLE_AGGREGATES)
    // The pool holds ten connections. Each export is read until its first page of notes, then
    // left hanging, as a download the person stopped.
    for (let reader = 0; reader < 10; reader++) {
      const file = await porter.exportGroup(source.groupId, source.owner)
      const iterator = file.chunks[Symbol.asyncIterator]()
      while (!(await iterator.next()).value?.includes(`"title"`));
    }
    const free = await Promise.race([
      sql`SELECT 1 AS one`.then(() => "free"),
      new Promise((resolve) => setTimeout(() => resolve("exhausted"), 3_000)),
    ])
    expect(free).toBe("free")

    const whole = await exportAs(sql, source.groupId, source.owner) as {
      aggregates: { notes: { id: string }[] }
    }
    const ids = whole.aggregates.notes.map((note) => note.id)
    expect(ids).toHaveLength(603)
    expect(new Set(ids).size).toBe(603)
  })
})

Deno.test("a file carrying another group's real ids leaves that group untouched", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const file = await exportAs(sql, source.groupId, source.owner) as {
      group: { name: string }
      aggregates: { notes: { title: string }[]; tags: { name: string }[] }
    }
    const rows = async () => ({
      notes: [...await sql`SELECT * FROM notes WHERE group_id = ${source.groupId} ORDER BY id`],
      tags: [...await sql`SELECT * FROM tags WHERE group_id = ${source.groupId} ORDER BY id`],
      links: [
        ...await sql`
        SELECT nt.* FROM note_tags nt JOIN notes n ON n.id = nt.note_id
        WHERE n.group_id = ${source.groupId} ORDER BY nt.note_id, nt.tag_id
      `,
      ],
    })
    const before = await rows()
    // A stranger edits the file, keeping the source's ids, and imports it.
    for (const note of file.aggregates.notes) note.title = `Taken ${note.title}`
    for (const tag of file.aggregates.tags) tag.name = `Taken ${tag.name}`
    const stranger = await insertUser(sql)
    const result = await new PostgresGroupPorter(sql, PORTABLE_AGGREGATES).importGroup(
      { file, name: null },
      stranger,
      NO_CAP,
    )
    expect(await rows()).toEqual(before)
    const titles = await sql<{ title: string }[]>`
      SELECT title FROM notes WHERE group_id = ${result.group.id} ORDER BY title
    `
    expect(titles.map((row) => row.title)).toEqual(["Taken Groceries", "Taken Plain", "Taken Plan"])
  })
})

Deno.test("a former owner who handed the group over and was removed cannot export it", async () => {
  await withSchema(async (sql) => {
    const source = await seed(sql)
    const heir = await insertUser(sql)
    await sql`
      INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
      VALUES (${source.groupId}, ${heir}, ${GroupRole.ADMIN}, ${source.owner})
    `
    // The hand-over, then the removal: the person was the owner a moment ago.
    await sql`
      UPDATE group_members SET role = ${GroupRole.ADMIN}
      WHERE group_id = ${source.groupId} AND user_id = ${source.owner}
    `
    await sql`
      UPDATE group_members SET role = ${GroupRole.OWNER}
      WHERE group_id = ${source.groupId} AND user_id = ${heir}
    `
    await sql`UPDATE groups SET owner_user_id = ${heir} WHERE id = ${source.groupId}`
    await sql`
      DELETE FROM group_members WHERE group_id = ${source.groupId} AND user_id = ${source.owner}
    `
    const codeOf = (userId: number) =>
      exportAs(sql, source.groupId, userId).then(
        () => "exported",
        (error) => error instanceof GroupError ? error.code : String(error),
      )
    expect(await codeOf(source.owner)).toBe("GROUP_NOT_FOUND")
    expect(await codeOf(heir)).toBe("exported")
  })
})
