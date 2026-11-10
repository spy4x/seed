/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { GroupRole } from "@domain/groups"
import type { Actor } from "@domain/identity"
import {
  ImportCheckQuery,
  ImportCommitCommand,
  ImportCreateCommand,
  ImportError,
  ImportGetQuery,
  ImportListQuery,
  ImportStatus,
  type ImportSummary,
  ImportUndoCommand,
  importUpload,
} from "@domain/imports"
import { type ImportKind, importKind } from "@server/imports/import-kind.ts"
import {
  deleteStaleImports,
  IMPORT_STALE_MS,
  importCommitJob,
  type ImportJobSetup,
  importReadJob,
} from "@server/imports/import-jobs.ts"
import { PostgresImportRepository } from "@server/imports/postgres-import-repository.ts"
import { importKinds } from "@server/imports/registry.ts"
import { noteImportKind } from "@server/notes/note-import.ts"
import { NOTES_OFF } from "@server/notes/setup.ts"
import {
  createImportCheckHandler,
  createImportCommitHandler,
  createImportCreateHandler,
  createImportGetHandler,
  createImportListHandler,
  createImportUndoHandler,
  type ImportHandlerDependencies,
} from "../../apps/api/features/imports/handlers.ts"
import { TEST_PLANS } from "../../libs/domain/billing/test-plans.ts"
import { team, withSchema } from "./group-team.ts"

/**
 * The import flow against a real Postgres built from schema.sql: who sees and acts on an import,
 * the read and commit jobs, a save that is whole or nothing, an undo that removes only its own
 * batch, and the cleanup. Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in
 * docs/handoff.md); it fails when they are missing.
 */

const KINDS = [noteImportKind]
const NO_BILLING: ImportJobSetup = { kinds: KINDS, billingEnabled: false, graceDays: 0 }

/** The handlers the API registers, on this database. */
function handlers(sql: postgres.Sql, kinds: readonly ImportKind[] = KINDS) {
  const dependencies: ImportHandlerDependencies = {
    roleOf: async (groupId, userId) =>
      (await sql<{ role: GroupRole }[]>`
        SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
      `)[0]?.role ?? null,
    imports: new PostgresImportRepository(sql, kinds),
    kinds,
  }
  return {
    create: createImportCreateHandler(dependencies),
    get: createImportGetHandler(dependencies),
    list: createImportListHandler(dependencies),
    check: createImportCheckHandler(dependencies),
    commit: createImportCommitHandler(dependencies),
    undo: createImportUndoHandler(dependencies),
  }
}

const actor = (userId: number) => ({ userId }) as Actor

function job(id: string): OutboxEvent {
  return { id: uuidV7(), aggregateId: id } as OutboxEvent
}

/** A notes CSV with a header and one note per title. */
function csv(...titles: string[]): Uint8Array {
  return new TextEncoder().encode(
    `title,body\n${titles.map((t) => `${t},Body of ${t}`).join(`\n`)}\n`,
  )
}

/** Uploads `file` as `userId` and runs the read job: the import, read. */
async function uploaded(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
  file: Uint8Array,
): Promise<ImportSummary> {
  const api = handlers(sql)
  const created = await api.create(
    new ImportCreateCommand({
      actor: actor(userId),
      groupId,
      kind: `notes`,
      fileName: `notes.csv`,
      file: await importUpload(file),
    }),
  )
  await importReadJob(sql, KINDS)(job(created.id))
  return await api.get(new ImportGetQuery({ actor: actor(userId), groupId, importId: created.id }))
}

/** Uploads, reads and saves `titles` as `userId`: the saved import. */
async function saved(sql: postgres.Sql, groupId: string, userId: number, ...titles: string[]) {
  const read = await uploaded(sql, groupId, userId, csv(...titles))
  await handlers(sql).commit(
    new ImportCommitCommand({
      actor: actor(userId),
      groupId,
      importId: read.id,
      mapping: { title: 0, body: 1 },
    }),
  )
  await importCommitJob(sql, NO_BILLING)(job(read.id))
  return read.id
}

/** The code of the `ImportError` that `run` rejects with, or `null` when it resolves. */
async function codeOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (error) {
    if (error instanceof ImportError) return error.code
    throw error
  }
}

async function liveTitles(sql: postgres.Sql, groupId: string): Promise<string[]> {
  const rows = await sql<{ title: string }[]>`
    SELECT title FROM notes WHERE group_id = ${groupId} AND deleted_at IS NULL ORDER BY title
  `
  return rows.map((row) => row.title)
}

async function stored(sql: postgres.Sql, id: string) {
  const [row] = await sql<{ status: ImportStatus; hasFile: boolean; failure: string | null }[]>`
    SELECT status, file IS NOT NULL AS "hasFile", failure FROM imports WHERE id = ${id}
  `
  return row
}

Deno.test("imports: reading a file stores its preview and guessed mapping, and a rerun changes nothing", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(sql, groupId, editor, csv(`First`, `Second`))

    expect(read).toMatchObject({
      status: ImportStatus.READY,
      rowCount: 2,
      preview: {
        columns: [`title`, `body`],
        sample: [[`First`, `Body of First`], [`Second`, `Body of Second`]],
        mapping: { title: 0, body: 1 },
      },
    })
    const [{ count: before }] =
      await sql`SELECT count(*)::int FROM outbox_events WHERE event_kind = 'import.read'`
    await importReadJob(sql, KINDS)(job(read.id))
    const [{ count: after }] =
      await sql`SELECT count(*)::int FROM outbox_events WHERE event_kind = 'import.read'`
    expect([before, after]).toEqual([1, 1])
  })
})

Deno.test("imports: a file that cannot be read fails in words and its bytes are dropped", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(sql, groupId, editor, new TextEncoder().encode(`title\n"open\n`))

    expect(read.status).toBe(ImportStatus.FAILED)
    expect(read.failure).toContain(`never closed`)
    expect((await stored(sql, read.id)).hasFile).toBe(false)
  })
})

Deno.test("imports: a binary file fails in words instead of staying in reading, and its bytes are dropped", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(
      sql,
      groupId,
      editor,
      new TextEncoder().encode(`title,body\nA\0B,x\n`),
    )

    expect(read.status).toBe(ImportStatus.FAILED)
    expect(read.failure).toBe(`The file is not a text file.`)
    expect((await stored(sql, read.id)).hasFile).toBe(false)
  })
})

Deno.test("imports: with the notes off, notes are neither accepted for upload nor read by the job", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const off = importKinds(NOTES_OFF)
    const upload = async () =>
      new ImportCreateCommand({
        actor: actor(editor),
        groupId,
        kind: `notes`,
        fileName: `notes.csv`,
        file: await importUpload(csv(`Nope`)),
      })

    expect(await codeOf(async () => handlers(sql, off).create(await upload()))).toBe(
      `INVALID_REQUEST`,
    )
    const [{ count }] = await sql`SELECT count(*)::int FROM imports`
    expect(count).toBe(0)

    // One uploaded while the notes were on fails once its job runs with them off.
    const before = await handlers(sql).create(await upload())
    await importReadJob(sql, off)(job(before.id))
    expect(await stored(sql, before.id)).toMatchObject({
      status: ImportStatus.FAILED,
      hasFile: false,
    })
    expect(await liveTitles(sql, groupId)).toEqual([])
  })
})

Deno.test("imports: a member of another group can neither read, check, save nor undo an import", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor, stranger } = await team(sql)
    const read = await uploaded(sql, groupId, editor, csv(`Mine`))
    const api = handlers(sql)
    const ref = { actor: actor(stranger), groupId, importId: read.id }
    const mapping = { title: 0 }

    expect(await codeOf(() => api.get(new ImportGetQuery(ref)))).toBe(`GROUP_NOT_FOUND`)
    expect(await codeOf(() => api.check(new ImportCheckQuery({ ...ref, mapping })))).toBe(
      `GROUP_NOT_FOUND`,
    )
    expect(await codeOf(() => api.commit(new ImportCommitCommand({ ...ref, mapping })))).toBe(
      `GROUP_NOT_FOUND`,
    )
    expect(await codeOf(() => api.list(new ImportListQuery({ actor: actor(stranger), groupId }))))
      .toBe(`GROUP_NOT_FOUND`)
    // The repository's own check, on the locked group, without the handler's in front of it.
    const imports = new PostgresImportRepository(sql, KINDS)
    expect(await codeOf(() => imports.requestCommit(groupId, read.id, stranger, mapping))).toBe(
      `GROUP_NOT_FOUND`,
    )

    await saved(sql, groupId, editor, `Saved`).then(async (savedId) => {
      const undo = { actor: actor(stranger), groupId, importId: savedId }
      expect(await codeOf(() => api.undo(new ImportUndoCommand(undo)))).toBe(`GROUP_NOT_FOUND`)
      expect(await codeOf(() => imports.undo(groupId, savedId, stranger))).toBe(`GROUP_NOT_FOUND`)
    })
    // The stranger's own group does not hold it either.
    const [own] = await sql<{ groupId: string }[]>`
      SELECT group_id FROM group_members WHERE user_id = ${stranger}
    `
    expect(await codeOf(() => api.get(new ImportGetQuery({ ...ref, groupId: own.groupId }))))
      .toBe(`ITEM_NOT_FOUND`)
    expect(await stored(sql, read.id)).toMatchObject({ status: ImportStatus.READY })
  })
})

Deno.test("imports: a plain member cannot see another member's import; an admin can", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor, onlyHere, admin } = await team(sql)
    const read = await uploaded(sql, groupId, editor, csv(`Mine`))
    const api = handlers(sql)
    const other = { actor: actor(onlyHere), groupId, importId: read.id }

    expect(await codeOf(() => api.get(new ImportGetQuery(other)))).toBe(`ITEM_NOT_FOUND`)
    expect(await codeOf(() => api.check(new ImportCheckQuery({ ...other, mapping: { title: 0 } }))))
      .toBe(`ITEM_NOT_FOUND`)
    expect(
      await codeOf(() => api.commit(new ImportCommitCommand({ ...other, mapping: { title: 0 } }))),
    )
      .toBe(`ITEM_NOT_FOUND`)
    expect(
      await codeOf(() =>
        new PostgresImportRepository(sql, KINDS).requestCommit(groupId, read.id, onlyHere, {
          title: 0,
        })
      ),
    ).toBe(`ITEM_NOT_FOUND`)
    expect((await api.list(new ImportListQuery({ actor: actor(onlyHere), groupId }))).imports)
      .toEqual([])

    const seen = await api.get(new ImportGetQuery({ ...other, actor: actor(admin) }))
    expect(seen.id).toBe(read.id)
    expect(
      (await api.list(new ImportListQuery({ actor: actor(editor), groupId }))).imports.map((i) =>
        i.id
      ),
    )
      .toEqual([read.id])
  })
})

Deno.test("imports: a viewer cannot upload notes", async () => {
  await withSchema(async (sql) => {
    const { groupId, viewer } = await team(sql)
    expect(await codeOf(() => uploaded(sql, groupId, viewer, csv(`Nope`)))).toBe(
      `ROLE_INSUFFICIENT`,
    )
    const [{ count }] = await sql`SELECT count(*)::int FROM imports`
    expect(count).toBe(0)
  })
})

Deno.test("imports: an uploader demoted to viewer can no longer check the import", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(sql, groupId, editor, csv(`One`))
    await sql`
      UPDATE group_members SET role = ${GroupRole.VIEWER}
      WHERE group_id = ${groupId} AND user_id = ${editor}
    `
    const check = new ImportCheckQuery({
      actor: actor(editor),
      groupId,
      importId: read.id,
      mapping: { title: 0 },
    })

    expect(await codeOf(() => handlers(sql).check(check))).toBe(`ROLE_INSUFFICIENT`)
  })
})

Deno.test("imports: a check answers every refused row and saves nothing", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(
      sql,
      groupId,
      editor,
      new TextEncoder().encode(`title,body\nOne,a\n,b\nThree,c\n`),
    )
    const result = await handlers(sql).check(
      new ImportCheckQuery({
        actor: actor(editor),
        groupId,
        importId: read.id,
        mapping: { title: 0, body: 1 },
      }),
    )

    expect(result).toMatchObject({ rowCount: 3, valid: 2, withErrors: 1, rows: [{ row: 2 }] })
    expect(await liveTitles(sql, groupId)).toEqual([])
    expect(await stored(sql, read.id)).toMatchObject({ status: ImportStatus.READY, hasFile: true })
  })
})

Deno.test("imports: saving writes every valid row as one batch, drops the file, and a rerun writes nothing more", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const id = await saved(sql, groupId, editor, `Alpha`, ``, `Beta`)

    expect(await liveTitles(sql, groupId)).toEqual([`Alpha`, `Beta`])
    const summary = await handlers(sql).get(
      new ImportGetQuery({ actor: actor(editor), groupId, importId: id }),
    )
    expect(summary).toMatchObject({ status: ImportStatus.COMMITTED, savedCount: 2, errorCount: 1 })
    expect((await stored(sql, id)).hasFile).toBe(false)
    const [{ count: records }] =
      await sql`SELECT count(*)::int FROM import_records WHERE import_id = ${id}`
    expect(records).toBe(2)

    await importCommitJob(sql, NO_BILLING)(job(id))
    // Asking again once saved answers the import as it is and queues nothing.
    await handlers(sql).commit(
      new ImportCommitCommand({
        actor: actor(editor),
        groupId,
        importId: id,
        mapping: { title: 0 },
      }),
    )
    await importCommitJob(sql, NO_BILLING)(job(id))
    expect(await liveTitles(sql, groupId)).toEqual([`Alpha`, `Beta`])
    const kinds = await sql<{ eventKind: string }[]>`
      SELECT event_kind FROM outbox_events WHERE group_id = ${groupId} AND event_kind LIKE 'import.%'
      ORDER BY aggregate_version
    `
    expect(kinds.map((row) => row.eventKind)).toEqual([
      `import.created`,
      `import.read`,
      `import.committing`,
      `import.committed`,
    ])
  })
})

Deno.test("imports: a save past the plan's note cap writes none of the rows and fails in words", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const cap = TEST_PLANS[0].entitlements.limits.maxNotes!
    const titles = Array.from({ length: cap + 1 }, (_, index) => `Note ${index}`)
    const read = await uploaded(sql, groupId, editor, csv(...titles))
    await handlers(sql).commit(
      new ImportCommitCommand({
        actor: actor(editor),
        groupId,
        importId: read.id,
        mapping: { title: 0 },
      }),
    )
    await importCommitJob(sql, {
      kinds: KINDS,
      billingEnabled: true,
      graceDays: 0,
      plans: TEST_PLANS,
    })(
      job(read.id),
    )

    expect(await liveTitles(sql, groupId)).toEqual([])
    expect(await stored(sql, read.id)).toMatchObject({
      status: ImportStatus.FAILED,
      hasFile: false,
      failure: expect.stringContaining(`plan has no room`),
    })
    const [{ count }] = await sql`SELECT count(*)::int FROM import_records`
    expect(count).toBe(0)
  })
})

Deno.test("imports: a fault in the middle of a save rolls every row back and the retry saves them once", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    let failOnce = true
    const flaky = importKind({
      ...noteImportKind,
      async commit(tx, values, context) {
        const ids = await noteImportKind.commit(tx, values, context)
        if (failOnce) {
          failOnce = false
          throw new Error(`connection lost`)
        }
        return ids
      },
    })
    const read = await uploaded(sql, groupId, editor, csv(`One`, `Two`))
    await handlers(sql).commit(
      new ImportCommitCommand({
        actor: actor(editor),
        groupId,
        importId: read.id,
        mapping: { title: 0 },
      }),
    )
    const run = importCommitJob(sql, { ...NO_BILLING, kinds: [flaky] })

    await expect(run(job(read.id))).rejects.toThrow(`connection lost`)
    expect(await liveTitles(sql, groupId)).toEqual([])
    expect(await stored(sql, read.id)).toMatchObject({
      status: ImportStatus.COMMITTING,
      hasFile: true,
    })

    await run(job(read.id))
    expect(await liveTitles(sql, groupId)).toEqual([`One`, `Two`])
  })
})

Deno.test("imports: an uploader removed before the save saves nothing", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const read = await uploaded(sql, groupId, editor, csv(`One`))
    await handlers(sql).commit(
      new ImportCommitCommand({
        actor: actor(editor),
        groupId,
        importId: read.id,
        mapping: { title: 0 },
      }),
    )
    await sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${editor}`
    await importCommitJob(sql, NO_BILLING)(job(read.id))

    expect(await liveTitles(sql, groupId)).toEqual([])
    expect(await stored(sql, read.id)).toMatchObject({
      status: ImportStatus.FAILED,
      hasFile: false,
    })
  })
})

Deno.test("imports: undo moves only its own batch to the trash, and a second undo changes nothing", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const first = await saved(sql, groupId, editor, `First A`, `First B`)
    await saved(sql, groupId, editor, `Second A`)
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id)
      VALUES (${uuidV7()}, ${groupId}, 'Typed by hand', '', 1, ${editor}, ${editor})
    `
    const api = handlers(sql)
    const undo = new ImportUndoCommand({ actor: actor(editor), groupId, importId: first })

    expect((await api.undo(undo)).status).toBe(ImportStatus.UNDONE)
    expect(await liveTitles(sql, groupId)).toEqual([`Second A`, `Typed by hand`])
    const trashed = await sql<{ title: string }[]>`
      SELECT title FROM notes WHERE group_id = ${groupId} AND deleted_at IS NOT NULL ORDER BY title
    `
    expect(trashed.map((row) => row.title)).toEqual([`First A`, `First B`])
    const [{ count: tombstones }] = await sql`
      SELECT count(*)::int FROM group_change_tombstones WHERE group_id = ${groupId}
    `
    expect(tombstones).toBe(2)

    await api.undo(undo)
    expect(await liveTitles(sql, groupId)).toEqual([`Second A`, `Typed by hand`])
  })
})

Deno.test("imports: the cleanup deletes imports left unsaved for a day, with their files, and keeps saved ones", async () => {
  await withSchema(async (sql) => {
    const { groupId, editor } = await team(sql)
    const stale = await uploaded(sql, groupId, editor, csv(`Stale`))
    const fresh = await uploaded(sql, groupId, editor, csv(`Fresh`))
    const kept = await saved(sql, groupId, editor, `Kept`)
    const old = new Date(Date.now() - IMPORT_STALE_MS - 60_000)
    await sql`UPDATE imports SET created_at = ${old} WHERE id IN (${stale.id}, ${kept})`

    expect(await deleteStaleImports(sql)).toBe(1)
    const left = await sql<{ id: string }[]>`SELECT id FROM imports ORDER BY created_at`
    expect(left.map((row) => row.id).sort()).toEqual([fresh.id, kept].sort())
    expect(await liveTitles(sql, groupId)).toEqual([`Kept`])
  })
})
