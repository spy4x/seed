import { type NoteExportEntry, parseNoteExportEntry } from "@domain/notes"
import { portable } from "@server/groups/portable.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** Notes one page of the export reads. */
const READ_PAGE = 500

/** Rows one statement writes: well under Postgres's 65,535 parameters at nine columns a row. */
const WRITE_BATCH = 1_000

/**
 * Notes in a group's export file: every live note with its text, its tags by their ids in the file
 * and its dates. Deleted notes stay behind, as they do in a move. On import each note gets a new id
 * and keeps the tags the file holds; a tag id the file has no tag for is ignored, as a create
 * ignores one (`docs/aggregates.md`, "Relations between aggregates"). They count against the new
 * group's `maxNotes`.
 */
export const notePortable = portable<NoteExportEntry>({
  kind: "notes",
  one: "note",
  other: "notes",
  limit: "maxNotes",
  parse: parseNoteExportEntry,
  async *read(sql, groupId) {
    // Keyset pages, each its own short query after the last id: nothing is held between pages, so
    // a download the reader stopped keeps no connection from the pool. Ids are UUID v7, so this is
    // also roughly the order the notes were made in.
    let after: string | null = null
    while (true) {
      const page: NoteExportEntry[] = await sql<NoteExportEntry[]>`
        SELECT
          notes.id, notes.title, notes.body,
          COALESCE(
            (SELECT array_agg(tag_id ORDER BY tag_id) FROM note_tags WHERE note_id = notes.id),
            '{}'
          ) AS tag_ids,
          notes.created_at, notes.updated_at
        FROM notes
        WHERE notes.group_id = ${groupId} AND notes.deleted_at IS NULL
          AND (${after}::uuid IS NULL OR notes.id > ${after}::uuid)
        ORDER BY notes.id
        LIMIT ${READ_PAGE}
      `
      if (page.length > 0) yield page
      if (page.length < READ_PAGE) return
      after = page[page.length - 1].id
    }
  },
  async write(sql, entries, context) {
    const ids = new Map<string, string>()
    const rows = entries.map((note) => {
      const id = uuidV7()
      ids.set(note.id, id)
      return {
        id,
        group_id: context.groupId,
        title: note.title,
        body: note.body,
        change_sequence: context.changeSequence,
        created_by_user_id: context.actorId,
        updated_by_user_id: context.actorId,
        created_at: note.createdAt,
        updated_at: note.updatedAt,
      }
    })
    const links = entries.flatMap((note) =>
      [...new Set(note.tagIds)].flatMap((fileTagId) => {
        const tagId = context.newIdOf("tags", fileTagId)
        return tagId === undefined ? [] : [{ note_id: ids.get(note.id)!, tag_id: tagId }]
      })
    )
    for (let start = 0; start < rows.length; start += WRITE_BATCH) {
      await sql`INSERT INTO notes ${sql(rows.slice(start, start + WRITE_BATCH))}`
    }
    for (let start = 0; start < links.length; start += WRITE_BATCH) {
      await sql`INSERT INTO note_tags ${sql(links.slice(start, start + WRITE_BATCH))}`
    }
    return ids
  },
})
