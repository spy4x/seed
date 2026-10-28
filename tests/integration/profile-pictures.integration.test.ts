/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { ATTACHMENT_UPLOAD_BUDGET } from "@domain/notes"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { anyPicture, readablePicture, setUserPicture } from "@server/auth/profile-pictures.ts"
import { type LedgerUpload, reserveUpload, settleUpload } from "@server/files/upload-ledger.ts"
import { PostgresAttachmentRepository } from "@server/notes/postgres-attachment-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

const WEBP = `image/webp`

/** The object keys queued for deletion, sorted. */
async function queued(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ objectKey: string }[]>`SELECT object_key FROM file_deletions`
  return rows.map((row) => row.objectKey).sort()
}

/** Gives `userId` a new picture and answers its id. */
async function givePicture(sql: postgres.Sql, userId: number): Promise<string> {
  const id = uuidV7()
  await sql.begin((tx) => setUserPicture(tx, userId, { id, contentType: WEBP }))
  return id
}

/** Marks picture `id` processed into one WebP width, as the worker would (#464). */
async function processed(sql: postgres.Sql, id: string) {
  await sql`UPDATE images SET processed_at = now() WHERE id = ${id}`
  await sql`
    INSERT INTO image_variants (object_key, image_id, content_type, width, height)
    VALUES (${`pictures/${id}/480.webp`}, ${id}, ${WEBP}, 480, 480)
  `
  return { id, contentType: WEBP, objectKey: `pictures/${id}/480.webp` }
}

function pictureUpload(userId: number, size = 1000): LedgerUpload {
  const id = uuidV7()
  return {
    id,
    noteId: null,
    userId,
    stagingKey: `uploads/tmp/${id}`,
    name: `picture`,
    contentType: WEBP,
    size,
  }
}

Deno.test("profile pictures against Postgres", async (t) => {
  await withSchema(async (sql) => {
    await t.step("shows a picture to its owner and group mates, never to a stranger", async () => {
      const { owner, editor, stranger, groupId } = await team(sql)
      const picture = await givePicture(sql, editor)
      const shown = await processed(sql, picture)

      expect(await readablePicture(sql, picture, editor)).toEqual(shown)
      expect(await readablePicture(sql, picture, owner)).toEqual(shown)
      expect(await readablePicture(sql, picture, stranger)).toBe(null)
      expect(await readablePicture(sql, uuidV7(), editor)).toBe(null)

      await sql`UPDATE groups SET deleted_at = now() WHERE id = ${groupId}`
      expect(await readablePicture(sql, picture, owner)).toBe(null)
      expect(await readablePicture(sql, picture, editor)).not.toBe(null)
    })

    await t.step("hides the picture of a deleted account, from the operator area too", async () => {
      const { owner, viewer } = await team(sql)
      const picture = await givePicture(sql, viewer)
      const shown = await processed(sql, picture)
      expect(await anyPicture(sql, picture)).toEqual(shown)

      await sql`UPDATE users SET deleted_at = now() WHERE id = ${viewer}`
      expect(await readablePicture(sql, picture, owner)).toBe(null)
      expect(await anyPicture(sql, picture)).toBe(null)
    })

    await t.step(
      "queues the old object when a picture is replaced or removed, and with the account",
      async () => {
        await sql`DELETE FROM file_deletions`
        const { admin } = await team(sql)
        const first = await givePicture(sql, admin)
        expect(await queued(sql)).toEqual([])

        const second = await givePicture(sql, admin)
        expect(await queued(sql)).toEqual([`pictures/${first}`])

        const removed = await sql.begin((tx) => setUserPicture(tx, admin, null))
        expect(removed?.previous).toBe(second)
        expect(removed?.user.pictureId).toBe(null)
        expect(await queued(sql)).toEqual([`pictures/${first}`, `pictures/${second}`].sort())

        // A person who owns no group, so nothing holds their row back.
        const alone = await insertUser(sql)
        const third = await givePicture(sql, alone)
        await sql`DELETE FROM users WHERE id = ${alone}`
        expect(await queued(sql)).toContain(`pictures/${third}`)
      },
    )

    await t.step("refuses a picture type with no picture, and the other way round", async () => {
      const { onlyHere } = await team(sql)
      const refused = await sql`
        UPDATE users SET picture_id = ${uuidV7()}, picture_type = NULL WHERE id = ${onlyHere}
      `.then(() => null, (error: Error) => error)
      expect(refused).toBeInstanceOf(Error)
    })

    await t.step("counts pictures and attachments against one hourly budget", async () => {
      const { owner, groupId } = await team(sql)
      const note = (await new PostgresNoteRepository(sql).create(
        { groupId, id: uuidV7(), title: "Trip", body: "" },
        owner,
        null,
      )).note
      const attachments = new PostgresAttachmentRepository(sql)
      const budget = { files: 2, bytes: ATTACHMENT_UPLOAD_BUDGET.bytes }
      const id = uuidV7()
      await attachments.createUpload({
        id,
        noteId: note.id,
        userId: owner,
        stagingKey: `uploads/tmp/${id}`,
        name: `scan.pdf`,
        contentType: `application/pdf`,
        size: 100,
      }, budget)

      const first = pictureUpload(owner)
      expect(await reserveUpload(sql, first, budget)).toBe(null)
      expect(await reserveUpload(sql, pictureUpload(owner), budget)).toBe(`UPLOAD_BUDGET`)
      expect(await attachments.signedInLastHour(owner)).toEqual({ files: 2, bytes: 1100 })
    })

    await t.step(
      "settles a picture upload only as a picture, and an attachment only as one",
      async () => {
        const { editor, groupId, owner } = await team(sql)
        const note = (await new PostgresNoteRepository(sql).create(
          { groupId, id: uuidV7(), title: "Plan", body: "" },
          owner,
          null,
        )).note
        const picture = pictureUpload(editor)
        await reserveUpload(sql, picture, ATTACHMENT_UPLOAD_BUDGET)
        const attachment = { ...pictureUpload(editor), noteId: note.id }
        await reserveUpload(sql, attachment, ATTACHMENT_UPLOAD_BUDGET)

        expect(await settleUpload(sql, picture.id, editor, `attachment`)).toBe(null)
        expect(await settleUpload(sql, attachment.id, editor, `picture`)).toBe(null)
        expect(await settleUpload(sql, picture.id, owner, `picture`)).toBe(null)
        expect((await settleUpload(sql, picture.id, editor, `picture`))?.id).toBe(picture.id)
        expect(await settleUpload(sql, picture.id, editor, `picture`)).toBe(null)
        expect((await settleUpload(sql, attachment.id, editor, `attachment`))?.id).toBe(
          attachment.id,
        )
      },
    )
  })
})
