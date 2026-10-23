/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { NOTE_RESTORE_DAYS } from "@domain/notes"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { purgeDeletedNotes } from "@server/notes/purge-deleted-notes.ts"
import { team, withSchema } from "./group-team.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

const DAY = 24 * 60 * 60 * 1000

Deno.test("the purge of deleted notes against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const notes = new PostgresNoteRepository(sql)
    const ids = async (groupId: string) =>
      (await sql<{ title: string }[]>`
        SELECT title FROM notes WHERE group_id = ${groupId} ORDER BY title
      `).map((row) => row.title)

    /** A group with a live note, a note deleted at `deletedAt` and one deleted just now. */
    async function seed() {
      const { groupId, owner } = await team(sql)
      const make = async (title: string) =>
        (await notes.create({ groupId, id: uuidV7(), title, body: "" }, owner, null))
          .note
      const live = await make("live")
      const old = await make("old")
      const recent = await make("recent")
      for (const note of [old, recent]) {
        await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)
      }
      return { groupId, live, old, recent }
    }

    await t.step(
      "a note deleted more than the restore window ago is removed and the others stay",
      async () => {
        const { groupId, old } = await seed()
        const deletedAt = (await sql<{ at: Date }[]>`
          SELECT deleted_at AS at FROM notes WHERE id = ${old.id}
        `)[0].at

        const early = await purgeDeletedNotes(
          sql,
          new Date(deletedAt.getTime() + NOTE_RESTORE_DAYS * DAY - 1000),
        )
        expect(early).toEqual({ removed: 0 })
        expect(await ids(groupId)).toEqual(["live", "old", "recent"])

        // 30 days and a second after the delete: `old` is due. `recent` was deleted a few
        // milliseconds later, so it is due too, a whole window after its own delete.
        const late = await purgeDeletedNotes(
          sql,
          new Date(deletedAt.getTime() + NOTE_RESTORE_DAYS * DAY + 1000),
        )
        expect(late.removed).toBe(2)
        expect(await ids(groupId)).toEqual(["live"])
      },
    )

    await t.step("a restored note is never purged, however much time has passed", async () => {
      const { groupId, owner } = await team(sql)
      const { note } = await notes.create(
        { groupId, id: uuidV7(), title: "back", body: "" },
        owner,
        null,
      )
      await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)
      await notes.restore({ groupId, id: note.id }, owner, null)

      const result = await purgeDeletedNotes(sql, new Date(Date.now() + 400 * DAY))

      expect(result).toEqual({ removed: 0 })
      expect(await ids(groupId)).toEqual(["back"])
    })

    await t.step("the worker's nightly job purges notes deleted over 30 days ago", async () => {
      const { groupId, old, recent } = await seed()
      await sql`
        UPDATE notes SET deleted_at = now() - make_interval(days => ${NOTE_RESTORE_DAYS + 1})
        WHERE id = ${old.id}
      `
      const processor = createOutboxProcessor(sql, {
        store: createPostgresAuthStore(sql),
        sender: null,
        brand: { webAppUrl: "http://app.localhost" },
        log: () => {},
      })

      // Started two days ago: its first 03:00 UTC run is due, and the next one it writes differs.
      await startRepeatingJobs(sql, new Date(Date.now() - 2 * 86_400_000))
      await sql`
        UPDATE outbox_events SET available_at = now() - interval '1 second'
        WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
      `
      await processor.drainOnce()

      const left = await sql<{ id: string }[]>`SELECT id FROM notes WHERE group_id = ${groupId}`
      expect(left.map((row) => row.id)).not.toContain(old.id)
      expect(left.map((row) => row.id)).toContain(recent.id)
    })
  })
})
