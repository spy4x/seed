/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { PostgresNoteOverview } from "@server/notes/note-overview.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { team, withSchema } from "./group-team.ts"

/**
 * The note widgets' numbers against Postgres, built from `schema.sql`. Notes are written through
 * the repository, then their creation and deletion times are set, so each day's total is known.
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when
 * they are missing.
 */

Deno.test("the note widgets' numbers against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const notes = new PostgresNoteRepository(sql)
    const overview = new PostgresNoteOverview(sql)
    /** A note of `groupId` created at `createdAt`, and deleted at `deletedAt` when given. */
    const note = async (groupId: string, by: number, createdAt: string, deletedAt?: string) => {
      const { note } = await notes.create({ groupId, id: uuidV7(), title: "N", body: "" }, by, null)
      await sql`
        UPDATE notes SET created_at = ${createdAt}, deleted_at = ${deletedAt ?? null}
        WHERE id = ${note.id}
      `
    }
    const range = { from: "2026-10-10", to: "2026-10-13" }

    await t.step(
      "a day's total counts the notes created by its end and not yet deleted",
      async () => {
        const { groupId, owner } = await team(sql)
        await note(groupId, owner, "2026-10-01T09:00:00Z")
        await note(groupId, owner, "2026-10-11T09:00:00Z")
        await note(groupId, owner, "2026-10-11T10:00:00Z", "2026-10-13T08:00:00Z")
        await note(groupId, owner, "2026-10-20T10:00:00Z")

        expect(await overview.dailyTotals(groupId, range, "UTC")).toEqual([1, 3, 3, 2])
      },
    )

    await t.step("never counts a note of another group", async () => {
      const { groupId, owner } = await team(sql)
      const other = await team(sql)
      await note(groupId, owner, "2026-10-11T09:00:00Z")
      await note(other.groupId, other.owner, "2026-10-01T09:00:00Z")
      await note(other.groupId, other.owner, "2026-10-11T09:00:00Z")

      expect(await overview.dailyTotals(groupId, range, "UTC")).toEqual([0, 1, 1, 1])
      expect(await overview.added(groupId, range, "UTC")).toBe(1)
      expect(await overview.added(other.groupId, range, "UTC")).toBe(1)
    })

    await t.step("cuts the days at midnight in the zone asked for", async () => {
      const { groupId, owner } = await team(sql)
      // 23:30 UTC on the 10th is 01:30 on the 11th in Berlin.
      await note(groupId, owner, "2026-10-10T23:30:00Z")

      expect(await overview.dailyTotals(groupId, range, "UTC")).toEqual([1, 1, 1, 1])
      expect(await overview.dailyTotals(groupId, range, "Europe/Berlin")).toEqual([0, 1, 1, 1])
      expect(await overview.added(groupId, { from: "2026-10-11", to: "2026-10-11" }, "UTC"))
        .toBe(0)
      expect(
        await overview.added(groupId, { from: "2026-10-11", to: "2026-10-11" }, "Europe/Berlin"),
      ).toBe(1)
    })

    await t.step("counts a deleted note among the notes added in its range", async () => {
      const { groupId, owner } = await team(sql)
      await note(groupId, owner, "2026-10-12T09:00:00Z", "2026-10-12T10:00:00Z")
      await note(groupId, owner, "2026-10-09T09:00:00Z")

      expect(await overview.added(groupId, range, "UTC")).toBe(1)
    })

    await t.step("answers zeros for a group with no notes, one per day", async () => {
      const { groupId } = await team(sql)

      expect(await overview.dailyTotals(groupId, range, "UTC")).toEqual([0, 0, 0, 0])
      expect(await overview.added(groupId, range, "UTC")).toBe(0)
    })

    await t.step("names the day the group was created on, or null for no group", async () => {
      const { groupId } = await team(sql)
      await sql`UPDATE groups SET created_at = '2026-10-10T23:30:00Z' WHERE id = ${groupId}`

      expect(await overview.startDay(groupId, "UTC")).toBe("2026-10-10")
      expect(await overview.startDay(groupId, "Europe/Berlin")).toBe("2026-10-11")
      expect(await overview.startDay(uuidV7(), "UTC")).toBeNull()
    })
  })
})
