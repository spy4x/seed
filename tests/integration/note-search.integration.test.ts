/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { NOTE_SEARCH_LIMIT } from "@domain/notes"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { team, withSchema } from "./group-team.ts"

/**
 * The note search against Postgres, built from `schema.sql` (the schema-snapshot test holds it
 * equal to the migrations). What it proves is who sees what: the membership is part of the search
 * query, so these steps search as people in, out of and removed from a group. Needs `DB_HOST`,
 * `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing.
 */

Deno.test("the note search against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const notes = new PostgresNoteRepository(sql)
    const titles = async (userId: number, text: string) =>
      (await notes.searchForMember(userId, text, NOTE_SEARCH_LIMIT)).map((hit) => hit.title)
    const write = async (groupId: string, by: number, title: string, body = "") =>
      (await notes.create({ groupId, id: uuidV7(), title, body }, by, null)).note

    await t.step("a member finds a note by a word of its title or the start of one", async () => {
      const { groupId, owner, viewer } = await team(sql)
      await write(groupId, owner, "Quarterly roadmap")

      expect(await titles(viewer, "roadmap")).toEqual(["Quarterly roadmap"])
      expect(await titles(viewer, "quar road")).toEqual(["Quarterly roadmap"])
      expect(await titles(viewer, "roadmaps")).toEqual([])
    })

    await t.step("a person never finds a note of a group they are not in", async () => {
      const { groupId, owner, stranger } = await team(sql)
      await write(groupId, owner, "Payroll secrets", "salaries for the team")

      expect(await titles(stranger, "payroll")).toEqual([])
      expect(await titles(stranger, "salaries")).toEqual([])
    })

    await t.step(
      "a removed member finds nothing of the group from the moment they leave",
      async () => {
        const { repository, groupId, owner, editor } = await team(sql)
        await write(groupId, owner, "Hiring plan")
        expect(await titles(editor, "hiring")).toEqual(["Hiring plan"])

        await repository.removeMember(groupId, editor, owner)

        expect(await titles(editor, "hiring")).toEqual([])
      },
    )

    await t.step("no one finds a note of a deleted group", async () => {
      const { groupId, owner } = await team(sql)
      await write(groupId, owner, "Archive index")
      await sql`UPDATE groups SET deleted_at = now() WHERE id = ${groupId}`

      expect(await titles(owner, "archive")).toEqual([])
    })

    await t.step("a deleted note is not found, and found again once restored", async () => {
      const { groupId, owner } = await team(sql)
      const note = await write(groupId, owner, "Vendor contract")
      await notes.delete({ groupId, id: note.id, expectedVersion: 1 }, owner)

      expect(await titles(owner, "vendor")).toEqual([])

      await notes.restore({ groupId, id: note.id }, owner, null)
      expect(await titles(owner, "vendor")).toEqual(["Vendor contract"])
    })

    await t.step("an edited note is found by its new words only", async () => {
      const { groupId, owner } = await team(sql)
      const note = await write(groupId, owner, "Draft", "lighthouse")
      await notes.update(
        { groupId, id: note.id, title: "Draft", body: "harbour", expectedVersion: 1 },
        owner,
      )

      expect(await titles(owner, "lighthouse")).toEqual([])
      expect(await titles(owner, "harbour")).toEqual(["Draft"])
    })

    await t.step("a title match ranks above a body match", async () => {
      const { groupId, owner } = await team(sql)
      // The body match is the newer note, so only the rank can put the title match first.
      await write(groupId, owner, "Budget", "")
      await write(groupId, owner, "Notes", "the budget is due")

      expect(await titles(owner, "budget")).toEqual(["Budget", "Notes"])
    })

    await t.step("a search answers at most the limit", async () => {
      const { groupId, owner } = await team(sql)
      for (let i = 0; i < NOTE_SEARCH_LIMIT + 3; i++) await write(groupId, owner, `Invoice ${i}`)

      expect((await titles(owner, "invoice")).length).toBe(NOTE_SEARCH_LIMIT)
    })

    await t.step("the snippet is plain text around the match, cut with an ellipsis", async () => {
      const { groupId, owner } = await team(sql)
      const words = Array.from({ length: 40 }, (_, i) => `word${i}`)
      words[25] = "zeppelin"
      await write(groupId, owner, "Long one", words.join(" "))

      const [hit] = await notes.searchForMember(owner, "zeppelin", NOTE_SEARCH_LIMIT)

      expect(hit.snippet.startsWith("…")).toBe(true)
      expect(hit.snippet.endsWith("…")).toBe(true)
      expect(hit.snippet).toContain("word24 zeppelin word26")
      expect(hit.snippet).not.toContain("<b>")
      expect(hit.snippet).not.toContain("word0 ")
    })

    await t.step(
      "a snippet that holds the whole body keeps its punctuation and no ellipsis",
      async () => {
        const { groupId, owner } = await team(sql)
        await write(groupId, owner, "Plan", "(Draft) Budget for the roadmap items.")

        const [hit] = await notes.searchForMember(owner, "roadmap", NOTE_SEARCH_LIMIT)

        expect(hit.snippet).toBe("(Draft) Budget for the roadmap items.")
      },
    )

    await t.step(
      "a snippet of a whole body that starts with a path has no ellipsis",
      async () => {
        const { groupId, owner } = await team(sql)
        await write(groupId, owner, "Paths", "/usr/bin holds the tools of /opt/")

        const [hit] = await notes.searchForMember(owner, "tools", NOTE_SEARCH_LIMIT)

        expect(hit.snippet).toBe("/usr/bin holds the tools of /opt/")
      },
    )

    await t.step(
      "a note found by its title shows its short body whole, a path's punctuation included",
      async () => {
        const { groupId, owner } = await team(sql)
        // With no match in the body, the snippet is the body's start with its punctuation kept.
        await write(groupId, owner, "Paths", "/usr/bin holds the tools.")

        const [hit] = await notes.searchForMember(owner, "paths", NOTE_SEARCH_LIMIT)

        expect(hit.snippet).toBe("/usr/bin holds the tools.")
      },
    )
  })
})
