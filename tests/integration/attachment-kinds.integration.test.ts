/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  type AttachmentRules,
  attachmentRulesOf,
  type Entitlements,
  entitlementsOf,
  FREE_PLAN_ID,
} from "@domain/billing"
import {
  ATTACHMENT_UPLOAD_BUDGET,
  AttachmentConfirmCommand,
  AttachmentDownloadQuery,
  AttachmentListQuery,
  AttachmentRemoveCommand,
  AttachmentSignCommand,
} from "@domain/attachments"
import { assertCanReadNotes, assertCanWriteNotes } from "@domain/notes"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { attachmentKind, attachmentKindList } from "@server/attachments/kind.ts"
import { PostgresAttachmentRepository } from "@server/attachments/postgres-attachment-repository.ts"
import { reserveUpload } from "@server/files/upload-ledger.ts"
import { FileRefusal, type FileStore } from "@server/files/files.ts"
import { AdminGroupActOutcome, adminGroupRows } from "@server/groups/admin-groups.ts"
import { attachmentsSection } from "@server/jobs/data-export-sections.ts"
import { noteAttachmentKind } from "@server/notes/attachment-kind.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { purgeDeletedNotes } from "@server/notes/purge-deleted-notes.ts"
import { wipeDatabase } from "../../apps/worker/demo/wipe.ts"
import {
  type AttachmentHandlerDependencies,
  createAttachmentConfirmHandler,
  createAttachmentDownloadHandler,
  createAttachmentListHandler,
  createAttachmentRemoveHandler,
  createAttachmentSignHandler,
} from "../../apps/api/features/attachments/attachments.ts"
import { TEST_PLANS } from "../../libs/domain/billing/test-plans.ts"
import { team, withSchema } from "./group-team.ts"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * Attachments on two kinds of record against Postgres (#1180): the notes' kind and a second kind
 * this test adds the way a product would, with its own record table, attachment table and the
 * shared deletion trigger. One step per state of the issue's table. Needs `DB_HOST`, `DB_USER`,
 * `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than
 * skipping.
 */

const TASK_NOT_FOUND = `TASK_NOT_FOUND`
const TASK_KIND = attachmentKind({
  name: `task`,
  prefix: `taskFile`,
  recordField: `taskId`,
  table: `task_attachments`,
  records: { table: `tasks`, key: `task_id`, title: `label` },
  assertCanRead: assertCanReadNotes,
  assertCanWrite: assertCanWriteNotes,
  recordNotFound: () => new Error(TASK_NOT_FOUND),
})
const KINDS = attachmentKindList([noteAttachmentKind, TASK_KIND])
const MB = 1024 * 1024
const DAY = 24 * 60 * 60 * 1000

/** The second kind's tables, as a product's migration would add them. */
async function addTaskTables(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE tasks (
      id UUID PRIMARY KEY,
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      label VARCHAR(200) NOT NULL,
      deleted_at TIMESTAMPTZ(3)
    );
    CREATE TABLE task_attachments (
      id UUID PRIMARY KEY,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      object_key VARCHAR(200) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size_bytes INT4 NOT NULL,
      created_by_user_id INT4 REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE TRIGGER task_attachments_queue_deletion
      AFTER DELETE ON task_attachments
      FOR EACH ROW EXECUTE FUNCTION queue_attachment_deletion();
  `)
}

/** A file store that signs any file within its size rule, and records what it deletes. */
function fakeFiles() {
  const deleted: string[] = []
  const files = {
    bucket: `files`,
    signUpload: (rule: { maxBytes: number }, file: { contentType: string; size: number }) =>
      Promise.resolve(
        file.size > rule.maxBytes ? { success: false, error: FileRefusal.Size } : {
          success: true,
          output: {
            url: `https://files.example.test/put`,
            headers: { "content-type": file.contentType },
            stagingKey: `uploads/tmp/${uuidV7()}`,
          },
        },
      ),
    confirmUpload: (_staging: string, _key: string, signed: unknown) =>
      Promise.resolve({ success: true, output: signed }),
    signDownload: (key: string) => Promise.resolve(`https://files.example.test/get/${key}`),
    delete: (key: string) => {
      deleted.push(key)
      return Promise.resolve()
    },
  } as unknown as FileStore
  return { files, deleted }
}

/** Billing on with the test plans' free plan, unless `caps` or `rules` say otherwise. */
type Plan = { limits: Partial<Entitlements["limits"]>; rules?: Partial<AttachmentRules> }

/** A team with a live note and a live task in its group, and the handlers over both kinds. */
async function setUp(sql: postgres.Sql, plan: Plan = { limits: {} }) {
  const members = await team(sql)
  const { groupId, owner } = members
  const notes = new PostgresNoteRepository(sql)
  const note = (await notes.create({ groupId, id: uuidV7(), title: `Trip`, body: `` }, owner, null))
    .note
  const task = uuidV7()
  await sql`INSERT INTO tasks (id, group_id, label) VALUES (${task}, ${groupId}, 'Pay rent')`
  const store = fakeFiles()
  const free = TEST_PLANS[0]
  const dependencies: AttachmentHandlerDependencies = {
    kinds: KINDS,
    attachments: (name) =>
      new PostgresAttachmentRepository(sql, KINDS.find((kind) => kind.name === name)!, KINDS),
    files: store.files,
    groups: {
      roleOf: async (id, userId) =>
        (await members.repository.getForMember(id, userId))?.role ?? null,
    },
    plans: {
      of: () =>
        Promise.resolve({
          limits: { ...free.entitlements.limits, ...plan.limits },
          rules: { ...free.attachments, ...plan.rules },
        }),
    },
    budget: ATTACHMENT_UPLOAD_BUDGET,
  }
  const actor = (userId: number) => ({ userId }) as never
  const recordOf = (kind: string) => kind === `task` ? task : note.id
  const sign = (
    userId: number,
    kind = `task`,
    options: { recordId?: string; size?: number; groupId?: string } = {},
  ) =>
    createAttachmentSignHandler(dependencies)(
      new AttachmentSignCommand({
        kind,
        actor: actor(userId),
        groupId: options.groupId ?? groupId,
        recordId: options.recordId ?? recordOf(kind),
        name: `scan.pdf`,
        contentType: `application/pdf`,
        size: options.size ?? 100,
      }),
    )
  const confirm = (userId: number, id: string, kind = `task`) =>
    createAttachmentConfirmHandler(dependencies)(
      new AttachmentConfirmCommand({ kind, actor: actor(userId), groupId, id }),
    )
  const attach = async (userId: number, kind = `task`, size = 100) =>
    (await confirm(userId, (await sign(userId, kind, { size })).id, kind)).attachment
  const list = (userId: number, kind = `task`) =>
    createAttachmentListHandler(dependencies)(
      new AttachmentListQuery({ kind, actor: actor(userId), groupId, recordId: recordOf(kind) }),
    )
  const download = (userId: number, id: string, kind = `task`) =>
    createAttachmentDownloadHandler(dependencies)(
      new AttachmentDownloadQuery({ kind, actor: actor(userId), groupId, id }),
    )
  const remove = (userId: number, id: string, kind = `task`) =>
    createAttachmentRemoveHandler(dependencies)(
      new AttachmentRemoveCommand({ kind, actor: actor(userId), groupId, id }),
    )
  return {
    ...members,
    ...store,
    notes,
    note,
    task,
    sign,
    confirm,
    attach,
    list,
    download,
    remove,
  }
}

/** Whether the upload `id` is still waiting: neither confirmed nor cancelled. */
async function waiting(sql: postgres.Sql, id: string): Promise<boolean> {
  const [row] = await sql<{ settledAt: Date | null }[]>`
    SELECT settled_at FROM file_uploads WHERE id = ${id}
  `
  return row !== undefined && row.settledAt === null
}

async function queued(sql: postgres.Sql): Promise<string[]> {
  return (await sql<{ objectKey: string }[]>`SELECT object_key FROM file_deletions`)
    .map((row) => row.objectKey).sort()
}

Deno.test("attachments on two record kinds against Postgres", async (t) => {
  await withSchema(async (sql) => {
    await addTaskTables(sql)

    await t.step("a live record of either kind takes a file, kept under its own kind", async () => {
      const { attach, sign, editor } = await setUp(sql)
      const onTask = await attach(editor)
      const onNote = await attach(editor, `note`)

      const [task, note] = [
        await sql`SELECT 1 FROM task_attachments WHERE id = ${onTask.id}`,
        await sql`SELECT 1 FROM note_attachments WHERE id = ${onNote.id}`,
      ]
      expect([task.length, note.length]).toEqual([1, 1])
      const signed = await sign(editor)
      expect(
        await sql`SELECT record_kind, record_id FROM file_uploads WHERE id = ${signed.id}`,
      ).toEqual([{ recordKind: `task`, recordId: expect.any(String) }])
    })

    await t.step(
      "a deleted, missing or other group's record is refused at sign, and at confirm the moved file is deleted",
      async () => {
        const { sign, confirm, editor, task, deleted } = await setUp(sql)
        const other = await setUp(sql)
        await expect(sign(editor, `task`, { recordId: uuidV7() })).rejects.toThrow(TASK_NOT_FOUND)
        await expect(sign(editor, `task`, { recordId: other.task })).rejects.toThrow(
          TASK_NOT_FOUND,
        )

        const { id } = await sign(editor)
        await sql`UPDATE tasks SET deleted_at = now() WHERE id = ${task}`
        await expect(sign(editor)).rejects.toThrow(TASK_NOT_FOUND)
        await expect(confirm(editor, id)).rejects.toThrow(TASK_NOT_FOUND)
        expect(deleted).toEqual([`attachments/${id}`])
        expect(await sql`SELECT 1 FROM task_attachments WHERE task_id = ${task}`).toEqual([])
      },
    )

    await t.step(
      "a viewer lists and downloads, but signs, confirms and removes nothing",
      async () => {
        const { attach, sign, confirm, list, download, remove, editor, viewer } = await setUp(sql)
        const file = await attach(editor)
        const { id } = await sign(editor)

        expect((await list(viewer)).attachments.map((a) => a.id)).toEqual([file.id])
        expect((await download(viewer, file.id)).url).toContain(file.id)
        await expect(sign(viewer)).rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
        await expect(confirm(viewer, id)).rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
        await expect(remove(viewer, file.id)).rejects.toMatchObject({ code: `ROLE_INSUFFICIENT` })
        expect(await waiting(sql, id)).toBe(true)
      },
    )

    await t.step("a non-member is refused every operation", async () => {
      const { attach, sign, confirm, list, download, remove, editor, stranger } = await setUp(sql)
      const file = await attach(editor)
      const { id } = await sign(editor)
      for (
        const refused of [
          () => sign(stranger),
          () => confirm(stranger, id),
          () => list(stranger),
          () => download(stranger, file.id),
          () => remove(stranger, file.id),
        ]
      ) {
        await expect(refused()).rejects.toMatchObject({ code: `GROUP_NOT_FOUND` })
      }
      expect(await waiting(sql, id)).toBe(true)
    })

    await t.step(
      "a record at its per-record cap is refused at sign, and at confirm under the lock",
      async () => {
        const { attach, sign, confirm, editor } = await setUp(sql, {
          limits: {},
          rules: { maxPerRecord: 1 },
        })
        const late = await sign(editor)
        await attach(editor)
        // The note's file is another record's: it does not count against the task.
        await attach(editor, `note`)
        await expect(sign(editor)).rejects.toMatchObject({ code: `RECORD_FULL`, limit: 1 })
        await expect(confirm(editor, late.id)).rejects.toMatchObject({ code: `RECORD_FULL` })
      },
    )

    await t.step("the group's file cap counts the files of both kinds", async () => {
      const { attach, sign, confirm, editor } = await setUp(sql, { limits: { maxAttachments: 2 } })
      const late = await sign(editor, `note`)
      await attach(editor)
      await attach(editor, `note`)
      const refusal = { code: `PLAN_LIMIT_REACHED`, entitlement: `maxAttachments`, limit: 2 }
      await expect(sign(editor)).rejects.toMatchObject(refusal)
      await expect(confirm(editor, late.id, `note`)).rejects.toMatchObject(refusal)
    })

    await t.step("the group's byte cap counts the bytes of both kinds", async () => {
      const { attach, sign, confirm, editor } = await setUp(sql, {
        limits: { storageBytes: 1000 },
      })
      const late = await sign(editor, `task`, { size: 400 })
      await attach(editor, `note`, 600)
      await attach(editor, `task`, 400)
      const refusal = { code: `PLAN_LIMIT_REACHED`, entitlement: `storageBytes` }
      await expect(sign(editor, `note`, { size: 1 })).rejects.toMatchObject(refusal)
      await expect(confirm(editor, late.id)).rejects.toMatchObject(refusal)
    })

    await t.step("with billing off the group's caps go, and the file rules stay", async () => {
      const off = entitlementsOf(FREE_PLAN_ID, false, TEST_PLANS)
      const rules = attachmentRulesOf(FREE_PLAN_ID, false, TEST_PLANS)
      const { attach, sign, editor } = await setUp(sql, {
        limits: off.limits,
        rules: { ...rules, maxPerRecord: 2 },
      })
      expect([off.limits.maxAttachments, off.limits.storageBytes]).toEqual([null, null])
      await attach(editor)
      await attach(editor)
      await attach(editor, `note`)
      await expect(sign(editor)).rejects.toMatchObject({ code: `RECORD_FULL` })
      await expect(sign(editor, `note`, { size: rules.maxFileBytes + 1 })).rejects.toMatchObject({
        code: `FILE_TOO_LARGE`,
      })
      expect(rules.maxFileBytes).toBe(2 * MB)
    })

    await t.step(
      "an upload signed for one kind is not confirmed through another, and stays waiting",
      async () => {
        const { sign, confirm, editor } = await setUp(sql)
        const { id } = await sign(editor, `note`)
        await expect(confirm(editor, id, `task`)).rejects.toMatchObject({
          code: `UPLOAD_NOT_FOUND`,
        })
        expect(await waiting(sql, id)).toBe(true)
        expect((await confirm(editor, id, `note`)).attachment.recordId).toBeDefined()
      },
    )

    await t.step("an upload confirmed by another person is not found", async () => {
      const { sign, confirm, editor, admin } = await setUp(sql)
      const { id } = await sign(editor)
      await expect(confirm(admin, id)).rejects.toMatchObject({ code: `UPLOAD_NOT_FOUND` })
      expect(await waiting(sql, id)).toBe(true)
    })

    await t.step("a profile picture's upload is not confirmed as an attachment", async () => {
      const { confirm, editor } = await setUp(sql)
      const id = uuidV7()
      await reserveUpload(sql, {
        id,
        recordKind: null,
        recordId: null,
        userId: editor,
        stagingKey: `uploads/tmp/${id}`,
        name: `picture`,
        contentType: `image/webp`,
        size: 100,
      }, ATTACHMENT_UPLOAD_BUDGET)
      await expect(confirm(editor, id)).rejects.toMatchObject({ code: `UPLOAD_NOT_FOUND` })
      await expect(confirm(editor, id, `note`)).rejects.toMatchObject({
        code: `UPLOAD_NOT_FOUND`,
      })
      expect(await waiting(sql, id)).toBe(true)
    })

    await t.step("a purged record's files go, and both kinds' objects are queued", async () => {
      await sql`DELETE FROM file_deletions`
      const { attach, editor, owner, notes, note, task, groupId } = await setUp(sql)
      const onTask = await attach(editor)
      const onNote = await attach(editor, `note`)

      await sql`DELETE FROM tasks WHERE id = ${task}`
      await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)
      await purgeDeletedNotes(sql, new Date(Date.now() + 31 * DAY))

      expect(await queued(sql)).toEqual(
        [`attachments/${onTask.id}`, `attachments/${onNote.id}`].sort(),
      )
      expect(await sql`SELECT 1 FROM task_attachments WHERE id = ${onTask.id}`).toEqual([])
      expect(await sql`SELECT 1 FROM note_attachments WHERE id = ${onNote.id}`).toEqual([])
    })

    await t.step("the operator sees, opens and removes the files of both kinds", async () => {
      const { attach, editor, groupId, task } = await setUp(sql)
      const onTask = await attach(editor)
      const onNote = await attach(editor, `note`)
      const rows = adminGroupRows(sql, KINDS)

      const files = await rows.files(groupId, { query: ``, page: 1 }, 25)
      expect(files?.files.map((file) => [file.id, file.kind, file.recordTitle]).sort()).toEqual(
        [[onTask.id, `task`, `Pay rent`], [onNote.id, `note`, `Trip`]].sort(),
      )
      expect((await rows.find(groupId))?.counts).toMatchObject({ files: 2, fileBytes: 200 })
      expect(await rows.file(groupId, onTask.id)).toMatchObject({ kind: `task`, recordId: task })

      const operator = { id: editor, role: 1 } as never
      expect(await rows.removeFile(operator, groupId, onTask.id)).toBe(AdminGroupActOutcome.Done)
      expect(await rows.removeFile(operator, groupId, onNote.id)).toBe(AdminGroupActOutcome.Done)
      expect(await rows.removeFile(operator, groupId, onNote.id)).toBe(
        AdminGroupActOutcome.NotFound,
      )
      expect((await rows.files(groupId, { query: ``, page: 1 }, 25))?.all).toBe(0)
    })

    await t.step("the data export lists the person's files of both kinds", async () => {
      const { attach, editor, admin } = await setUp(sql)
      const onTask = await attach(editor)
      const onNote = await attach(editor, `note`)
      await attach(admin)

      const rows = await attachmentsSection(KINDS).rows(sql, editor)
      expect(rows.map((row) => [row.id, row.kind]).sort()).toEqual(
        [[onTask.id, `task`], [onNote.id, `note`]].sort(),
      )
    })

    await t.step("the demo's wipe queues the objects of both kinds' tables", async () => {
      const { attach, editor } = await setUp(sql)
      const onTask = await attach(editor)
      const onNote = await attach(editor, `note`)
      await wipeDatabase(sql)
      const keys = await queued(sql)
      expect(keys).toContain(`attachments/${onTask.id}`)
      expect(keys).toContain(`attachments/${onNote.id}`)
    })
  })
})

Deno.test("the migration names each waiting note upload's kind and leaves pictures without one", async () => {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `attachment_kinds_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 1,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = migrationNames()
    const at = names.indexOf(`2026_12_17_0002_attachments_any_record.sql`)
    expect(at).toBeGreaterThan(0)
    await applyMigrations(sql, names.slice(0, at))

    const { groupId, owner } = await team(sql)
    const note = uuidV7()
    await sql`
      INSERT INTO notes (id, group_id, title, body, change_sequence, created_by_user_id)
      VALUES (${note}, ${groupId}, 'Trip', '', 1, ${owner})
    `
    const [noteUpload, pictureUpload] = [uuidV7(), uuidV7()]
    await sql`
      INSERT INTO file_uploads (id, note_id, user_id, staging_key, name, content_type, size_bytes)
      VALUES
        (${noteUpload}, ${note}, ${owner}, 'uploads/tmp/a', 'scan.pdf', 'application/pdf', 10),
        (${pictureUpload}, NULL, ${owner}, 'uploads/tmp/b', 'picture', 'image/webp', 10)
    `

    await applyMigrations(sql, names.slice(at))

    expect(
      await sql`SELECT id, record_kind, record_id FROM file_uploads ORDER BY id`,
    ).toEqual([
      { id: noteUpload, recordKind: `note`, recordId: note },
      { id: pictureUpload, recordKind: null, recordId: null },
    ])
    expect(
      await sql`
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ${schema} AND p.proname = 'queue_note_attachment_deletion'
      `,
    ).toEqual([])
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
