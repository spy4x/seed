/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { PlanError } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  ATTACHMENT_EVENTS,
  ATTACHMENT_UPLOAD_BUDGET,
  AttachmentCancelCommand,
  type AttachmentCaps,
  AttachmentError,
  AttachmentSignCommand,
  type AttachmentUploadBudget,
  NoteError,
  type PendingAttachmentUpload,
} from "@domain/notes"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { PostgresAttachmentRepository } from "@server/notes/postgres-attachment-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { cleanUpAttachments } from "@server/notes/attachment-cleanup.ts"
import type { FileStore } from "@server/files/files.ts"
import {
  createAttachmentCancelHandler,
  createAttachmentSignHandler,
} from "../../apps/api/features/notes/attachments.ts"
import { purgeDeletedNotes } from "@server/notes/purge-deleted-notes.ts"
import { team, withSchema } from "./group-team.ts"

const NO_CAPS: AttachmentCaps = { maxFiles: null, maxBytes: null, maxPerNote: 10 }
const HOUR = 60 * 60 * 1000

/** A team with a live note, and a function that makes uploads of it. */
async function setUp(sql: postgres.Sql) {
  const members = await team(sql)
  const notes = new PostgresNoteRepository(sql)
  const attachments = new PostgresAttachmentRepository(sql)
  const note = (await notes.create(
    { groupId: members.groupId, id: uuidV7(), title: "Trip", body: "" },
    members.owner,
    null,
  )).note
  const upload = (userId: number, size = 100, noteId = note.id): PendingAttachmentUpload => {
    const id = uuidV7()
    return {
      id,
      noteId,
      userId,
      stagingKey: `uploads/tmp/${id}`,
      name: `scan.pdf`,
      contentType: `application/pdf`,
      size,
    }
  }
  const add = (pending: PendingAttachmentUpload, caps = NO_CAPS, actor = pending.userId) =>
    attachments.add(members.groupId, pending, `attachments/${pending.id}`, caps, actor)
  return { ...members, notes, attachments, note, upload, add }
}

/**
 * The sign and cancel handlers over Postgres, with billing off: the group's plan sets no file or
 * byte cap. The file store signs anything.
 */
function signing(
  sql: postgres.Sql,
  context: { groupId: string; note: { id: string } },
  budget: AttachmentUploadBudget = ATTACHMENT_UPLOAD_BUDGET,
) {
  const attachments = new PostgresAttachmentRepository(sql)
  let staged = 0
  const files = {
    signUpload: (_rule: unknown, file: { contentType: string }) =>
      Promise.resolve({
        success: true,
        output: {
          url: `https://files.example.test/${++staged}`,
          headers: { "content-type": file.contentType },
          stagingKey: `uploads/tmp/${uuidV7()}`,
        },
      }),
  } as unknown as FileStore
  const dependencies = {
    attachments,
    files,
    groups: { roleOf: () => Promise.resolve(GroupRole.EDITOR) },
    plans: {
      of: () =>
        Promise.resolve({
          limits: { maxAttachments: null, storageBytes: null } as never,
          rules: { maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 },
        }),
    },
    budget,
  }
  const sign = createAttachmentSignHandler(dependencies)
  const cancel = createAttachmentCancelHandler(dependencies)
  const actor = (userId: number) => ({ userId }) as never
  return {
    sign: (userId: number, size = 100) =>
      sign(
        new AttachmentSignCommand({
          actor: actor(userId),
          groupId: context.groupId,
          noteId: context.note.id,
          name: `scan.pdf`,
          contentType: `application/pdf`,
          size,
        }),
      ),
    cancel: (userId: number, id: string) =>
      cancel(new AttachmentCancelCommand({ actor: actor(userId), groupId: context.groupId, id })),
    /** Moves every upload of `userId` `minutes` into the past. */
    age: (userId: number, minutes: number) =>
      sql`
        UPDATE file_uploads
        SET created_at = created_at - make_interval(mins => ${minutes})
        WHERE user_id = ${userId}
      `,
  }
}

async function queued(sql: postgres.Sql): Promise<string[]> {
  return (await sql<{ objectKey: string }[]>`SELECT object_key FROM file_deletions`)
    .map((row) => row.objectKey).sort()
}

Deno.test("note attachments against Postgres", async (t) => {
  await withSchema(async (sql) => {
    await t.step("a waiting upload is claimed once, by the person who signed it", async () => {
      const { attachments, upload, editor, admin } = await setUp(sql)
      const pending = upload(editor)
      await attachments.createUpload(pending, ATTACHMENT_UPLOAD_BUDGET)

      expect(await attachments.claimUpload(pending.id, admin)).toBeNull()
      const claims = await Promise.all([
        attachments.claimUpload(pending.id, editor),
        attachments.claimUpload(pending.id, editor),
      ])
      expect(claims.filter((claim) => claim !== null)).toEqual([pending])
      expect(await attachments.countPending(editor)).toBe(0)
    })

    await t.step(
      "a file is added with one change on the group and one audit row, and read by the group only",
      async () => {
        const { attachments, upload, add, editor, groupId, note, stranger } = await setUp(sql)
        const [{ sequence: before }] = await sql<{ sequence: string }[]>`
          SELECT next_change_sequence::text AS sequence FROM groups WHERE id = ${groupId}
        `
        const added = await add(upload(editor))

        const [{ sequence: after }] = await sql<{ sequence: string }[]>`
          SELECT next_change_sequence::text AS sequence FROM groups WHERE id = ${groupId}
        `
        expect(BigInt(after) - BigInt(before)).toBe(1n)
        const audit = await sql`
          SELECT 1 FROM audit_events
          WHERE event_kind = ${ATTACHMENT_EVENTS.added} AND group_id = ${groupId}
        `
        expect(audit).toHaveLength(1)
        expect(await attachments.list(groupId, note.id)).toEqual([added])
        expect((await attachments.get(groupId, added.id))?.objectKey).toBe(
          `attachments/${added.id}`,
        )
        // Another group's id finds nothing, whoever asks.
        const own = (await sql<{ id: string }[]>`
          SELECT group_id AS id FROM group_members WHERE user_id = ${stranger}
        `)[0].id
        expect(await attachments.get(own, added.id)).toBeNull()
        expect(await attachments.list(own, note.id)).toEqual([])
        expect(await attachments.usage(groupId)).toEqual({ files: 1, bytes: 100 })
      },
    )

    await t.step("a viewer and a stranger add nothing", async () => {
      const { add, upload, viewer, stranger, attachments, groupId } = await setUp(sql)
      await expect(add(upload(viewer))).rejects.toMatchObject({ code: "ROLE_INSUFFICIENT" })
      await expect(add(upload(stranger))).rejects.toMatchObject({ code: "GROUP_NOT_FOUND" })
      expect(await attachments.usage(groupId)).toEqual({ files: 0, bytes: 0 })
    })

    await t.step("a file for a deleted note is refused", async () => {
      const { add, upload, editor, notes, note, groupId, owner } = await setUp(sql)
      await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)
      await expect(add(upload(editor))).rejects.toBeInstanceOf(NoteError)
    })

    await t.step("each cap refuses the file that would pass it, and adds nothing", async () => {
      const { add, upload, editor, attachments, groupId } = await setUp(sql)
      await add(upload(editor, 100))

      const noteFull = add(upload(editor), { ...NO_CAPS, maxPerNote: 1 })
      await expect(noteFull).rejects.toBeInstanceOf(AttachmentError)
      await expect(add(upload(editor), { ...NO_CAPS, maxFiles: 1 })).rejects.toMatchObject({
        entitlement: "maxAttachments",
      })
      await expect(add(upload(editor, 101), { ...NO_CAPS, maxBytes: 200 })).rejects
        .toBeInstanceOf(PlanError)
      // Exactly at the byte cap still fits.
      await add(upload(editor, 100), { ...NO_CAPS, maxBytes: 200 })
      expect(await attachments.usage(groupId)).toEqual({ files: 2, bytes: 200 })
    })

    await t.step(
      "two files confirmed at once into the group's last place: one is added",
      async () => {
        const { add, upload, editor, admin, attachments, groupId, notes, owner } = await setUp(sql)
        // On two notes, so only the group's lock stands between the two counts.
        const other = (await notes.create(
          { groupId, id: uuidV7(), title: "Other", body: "" },
          owner,
          null,
        )).note
        const caps = { ...NO_CAPS, maxFiles: 1 }
        const results = await Promise.allSettled([
          add(upload(editor), caps),
          add(upload(admin, 100, other.id), caps),
        ])
        expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
        expect((await attachments.usage(groupId)).files).toBe(1)
      },
    )

    await t.step(
      "with billing off, one person cannot sign more than the hourly upload budget",
      async () => {
        const context = await setUp(sql)
        const { editor, admin, attachments } = context
        const files = signing(sql, context, { files: 3, bytes: 10 * 1024 * 1024 })
        const first = await files.sign(editor)
        // A confirmed upload still counts: the budget is what was signed, not what waits.
        await attachments.claimUpload(first.id, editor)
        await files.sign(editor)
        await files.sign(editor)
        await expect(files.sign(editor)).rejects.toMatchObject({ code: `UPLOAD_BUDGET` })
        // Another person has a budget of their own.
        await files.sign(admin)
        // An hour later the budget is whole again.
        await files.age(editor, 61)
        await files.sign(editor)

        const bytes = signing(sql, context, { files: 50, bytes: 250 })
        await bytes.sign(admin, 100)
        await expect(bytes.sign(admin, 100)).rejects.toMatchObject({ code: `UPLOAD_BUDGET` })
        await bytes.sign(context.onlyHere, 250)
      },
    )

    await t.step(
      "25 cancelled or abandoned uploads still let the person sign a new file",
      async () => {
        const context = await setUp(sql)
        const { editor, admin } = context
        const files = signing(sql, context)
        // Cancelled, as the page does for a cancel and before each retry.
        for (let i = 0; i < 25; i++) {
          const signed = await files.sign(editor)
          await files.cancel(editor, signed.id)
        }
        await files.sign(editor)
        // Abandoned with no cancel: twenty wait, then nothing more is signed until their URLs have
        // expired, and then it is again.
        for (let i = 0; i < 19; i++) await files.sign(admin)
        await files.sign(admin)
        await expect(files.sign(admin)).rejects.toMatchObject({ code: `UPLOADS_PENDING` })
        await files.age(admin, 11)
        await files.sign(admin)
        // A person cancels only their own upload.
        const theirs = await files.sign(editor)
        await files.cancel(admin, theirs.id)
        expect(await context.attachments.claimUpload(theirs.id, editor)).not.toBeNull()
      },
    )

    await t.step(
      "200 signs sent at once by one person pass neither the waiting cap nor the hourly budget",
      async () => {
        const context = await setUp(sql)
        const { attachments } = context
        const MiB = 1024 * 1024
        /** Sends 200 signs at once; how many were signed, and the codes of the refused ones. */
        const burst = async (userId: number, size: number, budget?: AttachmentUploadBudget) => {
          const files = signing(sql, context, budget)
          const results = await Promise.allSettled(
            Array.from({ length: 200 }, () => files.sign(userId, size)),
          )
          const refused = results.flatMap((result) =>
            result.status === `rejected` ? [result.reason.code] : []
          )
          return { signed: 200 - refused.length, refused: [...new Set(refused)] }
        }

        // Twenty 2 MiB uploads wait, well inside the default budget.
        expect(await burst(context.editor, 2 * MiB)).toEqual({
          signed: 20,
          refused: [`UPLOADS_PENDING`],
        })
        expect(await attachments.countPending(context.editor)).toBe(20)
        // Ten files an hour, fewer than the waiting cap.
        expect(await burst(context.admin, 100, { files: 10, bytes: 50 * MiB })).toEqual({
          signed: 10,
          refused: [`UPLOAD_BUDGET`],
        })
        expect(await attachments.signedInLastHour(context.admin)).toEqual({
          files: 10,
          bytes: 1000,
        })
        // 15 MiB an hour holds seven 2 MiB uploads.
        expect(await burst(context.onlyHere, 2 * MiB, { files: 50, bytes: 15 * MiB })).toEqual({
          signed: 7,
          refused: [`UPLOAD_BUDGET`],
        })
        expect(await attachments.signedInLastHour(context.onlyHere)).toEqual({
          files: 7,
          bytes: 14 * MiB,
        })
      },
    )

    await t.step("removing a file queues its object for deletion", async () => {
      const { add, upload, editor, viewer, attachments, groupId } = await setUp(sql)
      const added = await add(upload(editor))
      await expect(attachments.remove(groupId, added.id, viewer)).rejects.toMatchObject({
        code: "ROLE_INSUFFICIENT",
      })
      expect(await attachments.remove(groupId, added.id, editor)).toBe(`attachments/${added.id}`)
      expect(await queued(sql)).toContain(`attachments/${added.id}`)
      await expect(attachments.remove(groupId, added.id, editor)).rejects.toMatchObject({
        code: "ATTACHMENT_NOT_FOUND",
      })
      await attachments.forgetDeletion(`attachments/${added.id}`)
    })

    await t.step("purging a note and deleting a group queue their files' objects", async () => {
      const { add, upload, editor, notes, note, groupId, owner } = await setUp(sql)
      const onNote = await add(upload(editor))
      await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)
      await purgeDeletedNotes(sql, new Date(Date.now() + 31 * 24 * HOUR))
      expect(await queued(sql)).toContain(`attachments/${onNote.id}`)

      const other = await setUp(sql)
      const inGroup = await other.add(other.upload(other.editor))
      await sql`DELETE FROM groups WHERE id = ${other.groupId}`
      expect(await queued(sql)).toContain(`attachments/${inGroup.id}`)
    })

    await t.step(
      "the clean-up forgets day-old uploads, sweeps staging and deletes queued objects once",
      async () => {
        await sql`DELETE FROM file_deletions`
        const { attachments, upload, editor, add, groupId } = await setUp(sql)
        const old = upload(editor)
        const fresh = upload(editor)
        await attachments.createUpload(old, ATTACHMENT_UPLOAD_BUDGET)
        await attachments.createUpload(fresh, ATTACHMENT_UPLOAD_BUDGET)
        await sql`
          UPDATE file_uploads SET created_at = now() - interval '25 hours'
          WHERE id = ${old.id}
        `
        const added = await add(upload(editor))
        await attachments.remove(groupId, added.id, editor)

        const deleted: string[] = []
        const sweeps: Date[] = []
        const files = {
          delete: (key: string) => {
            deleted.push(key)
            return Promise.resolve()
          },
          deleteOlderThan: (prefix: string, before: Date) => {
            sweeps.push(before)
            expect(prefix).toBe(`uploads/tmp/`)
            return Promise.resolve(0)
          },
        }
        const now = new Date()
        const done = await cleanUpAttachments(sql, files, now)

        expect(done).toEqual({ uploads: 1, staging: 0, deleted: 1 })
        expect(deleted).toEqual([`attachments/${added.id}`])
        expect(sweeps).toEqual([new Date(now.getTime() - 24 * HOUR)])
        expect(await attachments.claimUpload(old.id, editor)).toBeNull()
        expect(await attachments.claimUpload(fresh.id, editor)).toEqual(fresh)
        expect(await queued(sql)).toEqual([])
        expect(await cleanUpAttachments(sql, files, now)).toEqual({
          uploads: 0,
          staging: 0,
          deleted: 0,
        })
      },
    )
  })
})
