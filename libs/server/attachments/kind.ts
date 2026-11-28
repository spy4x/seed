/**
 * A kind of record that keeps attachments (docs/attachments-and-pictures.md, "Add attachments to
 * a record kind"): its names, its tables and who may act. Every identifier is fixed here, in code,
 * and checked once at start-up, so no request ever names a table or a column.
 *
 * @module
 */

import type postgres from "postgres"
import type { AttachmentKindRules } from "@domain/attachments"

/**
 * One registered kind. Its attachment table has the columns of `note_attachments`, with
 * `records.key` in place of `note_id`: a foreign key to the record, `ON DELETE CASCADE`, and the
 * trigger `queue_attachment_deletion()`. Its record table has `id`, `group_id`, `deleted_at` and
 * the column `records.title`.
 */
export interface AttachmentKind extends AttachmentKindRules {
  /** The operations' prefix: `attachment` gives `attachment.sign` and the rest. */
  prefix: string
  /** The payload's name for the record's id: `noteId`. */
  recordField: string
  /** The attachment table: `note_attachments`. */
  table: string
  /** The record table (`notes`), the attachment table's column naming it, and the title's. */
  records: { table: string; key: string; title: string }
}

/** A table or column: lower case, at most 40 characters. */
const IDENTIFIER = /^[a-z][a-z0-9_]{0,39}$/
/** A kind's name, at most 32 characters: the audit rows' `entity_type` holds it. */
const NAME = /^[a-z][a-z0-9_]{0,31}$/
const PREFIX = /^[a-z][a-zA-Z0-9]{0,39}$/
const FIELD = /^[a-z][a-zA-Z0-9]{0,39}$/

/**
 * Checks a kind's names and returns it. Throws at start-up on a name that is not a plain lower
 * case identifier, so a typo never reaches a query.
 */
export function attachmentKind(kind: AttachmentKind): AttachmentKind {
  if (!NAME.test(kind.name)) throw new Error(`Attachment kind: bad name ${kind.name}`)
  const identifiers = [kind.table, kind.records.table, kind.records.key, kind.records.title]
  for (const name of identifiers) {
    if (!IDENTIFIER.test(name)) throw new Error(`Attachment kind: ${name} is not an identifier`)
  }
  if (!PREFIX.test(kind.prefix)) throw new Error(`Attachment kind: bad prefix ${kind.prefix}`)
  if (!FIELD.test(kind.recordField)) {
    throw new Error(`Attachment kind: bad record field ${kind.recordField}`)
  }
  return kind
}

/**
 * Checks that a list of kinds can be served together: no two share a name, a prefix or a table.
 * Returns the list.
 */
export function attachmentKindList(kinds: readonly AttachmentKind[]): readonly AttachmentKind[] {
  for (const key of [`name`, `prefix`, `table`] as const) {
    const values = kinds.map((kind) => kind[key])
    const twice = values.find((value, index) => values.indexOf(value) !== index)
    if (twice !== undefined) throw new Error(`Attachment kinds: ${key} ${twice} is used twice`)
  }
  return kinds
}

/**
 * The files of every kind in `kinds` as one subquery, one row per file, with the columns `kind`,
 * `id`, `record_id`, `group_id`, `record_title`, `record_deleted`, `name`, `content_type`,
 * `size_bytes`, `object_key`, `created_by_user_id` and `created_at`. With no kind it has no row.
 * Filter it by `group_id` outside: Postgres pushes the filter into each branch.
 */
export function attachmentFiles(
  sql: postgres.Sql,
  kinds: readonly AttachmentKind[],
): postgres.PendingQuery<postgres.Row[]> {
  const branches = kinds.map((kind) =>
    sql`
      SELECT ${kind.name}::text AS kind, a.id, a.${sql(kind.records.key)} AS record_id, r.group_id,
        r.${sql(kind.records.title)}::text AS record_title,
        (r.deleted_at IS NOT NULL) AS record_deleted, a.name, a.content_type, a.size_bytes,
        a.object_key, a.created_by_user_id, a.created_at
      FROM ${sql(kind.table)} a JOIN ${sql(kind.records.table)} r
        ON r.id = a.${sql(kind.records.key)}
    `
  )
  if (branches.length === 0) {
    return sql`
      SELECT NULL::text AS kind, NULL::uuid AS id, NULL::uuid AS record_id, NULL::uuid AS group_id,
        NULL::text AS record_title, FALSE AS record_deleted, NULL::text AS name,
        NULL::text AS content_type, 0::int4 AS size_bytes, NULL::text AS object_key,
        NULL::int4 AS created_by_user_id, NULL::timestamptz AS created_at
      WHERE FALSE
    `
  }
  return branches.reduce((all, branch) => sql`${all} UNION ALL ${branch}`)
}
