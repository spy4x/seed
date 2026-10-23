import type postgres from "postgres"
import { type NoteSearchHit, trimNoteSnippet } from "@domain/notes"

/** The most words of a search that reach the query; the rest are dropped. */
const MAX_WORDS = 8

/**
 * `ts_headline`'s options: one short fragment around the first match, as plain text. Without
 * `StartSel` and `StopSel` set to nothing it would wrap each match in `<b>`, which a screen shows as
 * text.
 */
const HEADLINE_OPTIONS = `MaxFragments=1, MaxWords=14, MinWords=6, ShortWord=1, StartSel="", ` +
  `StopSel="", FragmentDelimiter=" "`

/**
 * The text of a search as a prefix query in Postgres' `to_tsquery` syntax, every word required:
 * `weekly plan` becomes `weekly:* & plan:*`, so "plan" finds "planning" too. Only letters and
 * digits pass, so nothing a person types can add an operator; at most {@link MAX_WORDS} words.
 * `null` when no word is left, as for "!!".
 */
export function prefixQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, MAX_WORDS)
  return words.length === 0 ? null : words.map((word) => `${word}:*`).join(" & ")
}

/**
 * A row of the search query: the hit, and where its snippet sits in the body. `ts_headline` drops
 * the punctuation before the first word and after the last, so `lead` and `tail` carry the body's
 * own, and the snippet starts or ends the body when it does with them. A token such as the path
 * `/usr/bin` keeps its punctuation, so `lead` and `tail` are empty when the snippet already starts
 * or ends the body without them.
 */
interface SearchRow {
  id: string
  groupId: string
  title: string
  updatedAt: Date
  snippet: string
  lead: string
  tail: string
  startsBody: boolean
  endsBody: boolean
}

/**
 * The live notes matching `text` in the groups `userId` is an active member of, best first: the
 * membership join, the live-group and live-user checks and the deleted-note check are in the same
 * statement as the match and the limit, so a note of another group can never be counted, ranked or
 * returned. The snippet is built for the returned rows only.
 *
 * A failure is rethrown without the database's error, which can carry the query's parameters,
 * the searched text among them: whatever logs it must not log what a person searched for.
 */
export async function searchNotesForMember(
  sql: postgres.Sql | postgres.TransactionSql,
  userId: number,
  text: string,
  limit: number,
): Promise<NoteSearchHit[]> {
  const query = prefixQuery(text)
  if (query === null) return []
  let rows: SearchRow[]
  try {
    rows = await sql<SearchRow[]>`
      SELECT
        found.id,
        found.group_id,
        found.title,
        found.updated_at,
        found.snippet,
        CASE WHEN starts_with(found.body, found.snippet) THEN '' ELSE found.lead END AS lead,
        CASE WHEN right(found.body, length(found.snippet)) = found.snippet THEN '' ELSE found.tail
          END AS tail,
        starts_with(found.body, found.snippet) OR
          starts_with(found.body, found.lead || found.snippet) AS starts_body,
        right(found.body, length(found.snippet)) = found.snippet OR
          right(found.body, length(found.snippet || found.tail)) = found.snippet || found.tail
          AS ends_body
      FROM (
        SELECT
          matched.*,
          ts_headline('simple', matched.body, matched.query, ${HEADLINE_OPTIONS}) AS snippet,
          substring(matched.body from '^[^[:alnum:]]*') AS lead,
          substring(matched.body from '[^[:alnum:]]*$') AS tail
        FROM (
          SELECT
            notes.id,
            notes.group_id,
            notes.title,
            notes.body,
            notes.updated_at,
            search.query,
            ts_rank(notes.search_vector, search.query) AS rank
          FROM to_tsquery('simple', ${query}) AS search(query)
          INNER JOIN group_members ON group_members.user_id = ${userId}
          INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
          INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
          INNER JOIN notes
            ON notes.group_id = group_members.group_id AND notes.deleted_at IS NULL
          WHERE notes.search_vector @@ search.query
          ORDER BY rank DESC, notes.updated_at DESC, notes.id
          LIMIT ${limit}
        ) AS matched
      ) AS found
      ORDER BY found.rank DESC, found.updated_at DESC, found.id
    `
  } catch {
    throw new Error("The note search failed")
  }
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    updatedAt: row.updatedAt,
    snippet: trimNoteSnippet(
      `${row.startsBody ? row.lead : ""}${row.snippet}${row.endsBody ? row.tail : ""}`,
      row.startsBody,
      row.endsBody,
    ),
  }))
}
