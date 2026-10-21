import { parseTagExportEntry, type TagExportEntry, tagExportProblems } from "@domain/tags"
import { portable } from "@server/groups/portable.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** Rows one statement writes: well under Postgres's 65,535 parameters at nine columns a row. */
const WRITE_BATCH = 1_000

/**
 * Tags in a group's export file. Every tag goes, by name and colour; each gets a new id on import,
 * and the notes that carried it are linked to that id. A file's tags fit one group: at most
 * `TAG_MAX_PER_GROUP`, each name once.
 */
export const tagPortable = portable<TagExportEntry>({
  kind: "tags",
  one: "tag",
  other: "tags",
  parse: parseTagExportEntry,
  check: tagExportProblems,
  async *read(sql, groupId) {
    yield await sql<TagExportEntry[]>`
      SELECT id, name, color, created_at, updated_at
      FROM tags WHERE group_id = ${groupId}
      ORDER BY lower(name), id
    `
  },
  async write(sql, entries, context) {
    const ids = new Map<string, string>()
    const rows = entries.map((tag) => {
      const id = uuidV7()
      ids.set(tag.id, id)
      return {
        id,
        group_id: context.groupId,
        name: tag.name,
        color: tag.color,
        change_sequence: context.changeSequence,
        created_by_user_id: context.actorId,
        updated_by_user_id: context.actorId,
        created_at: tag.createdAt,
        updated_at: tag.updatedAt,
      }
    })
    for (let start = 0; start < rows.length; start += WRITE_BATCH) {
      await sql`INSERT INTO tags ${sql(rows.slice(start, start + WRITE_BATCH))}`
    }
    return ids
  },
})
