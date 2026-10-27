import type postgres from "postgres"
import {
  CONTACT_LINK_AUDIT_KINDS,
  CONTACT_LINK_ENTITY,
  CONTACT_LINKS_MAX,
  type ContactLinkAuditKind,
  ContactLinkError,
  type ContactLinkFields,
  type ContactLinkRecord,
  ContactLinkVersionConflictError,
  type PublicContactLink,
} from "@domain/contact-links"

/** The operator behind a write, for its audit row. */
export interface ContactLinkActor {
  userId: number
  /** The request's id, so the audit row can be matched with the request log. */
  requestId: string | null
}

/** A `contact_links` row as Postgres answers it (camelCase through the client's transform). */
interface ContactLinkRow extends Omit<ContactLinkRecord, `createdAt` | `updatedAt`> {
  createdAt: Date
  updatedAt: Date
}

function toRecord(row: ContactLinkRow): ContactLinkRecord {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
}

/**
 * The contact links' reads and writes for the admin app (#465). It checks no role: only the
 * operator area calls it, behind its gate. Every write runs in one transaction that locks the
 * table, checks what the operator saw, changes the links and writes the operator's audit row, so a
 * write and its record are kept or undone together, and two operators are served one after the
 * other.
 */
export class PostgresContactLinks {
  constructor(private readonly sql: postgres.Sql) {}

  /** Every link, in order. */
  async list(): Promise<ContactLinkRecord[]> {
    const rows = await this.sql<ContactLinkRow[]>`
      SELECT id, kind, value, label, position, created_at, updated_at, version
      FROM contact_links ORDER BY position, id
    `
    return rows.map(toRecord)
  }

  /**
   * Adds a link after the others. A create retried with the same id and fields answers the link
   * the first one made and writes nothing more; any other reuse of an id is refused.
   */
  async create(
    id: string,
    fields: ContactLinkFields,
    actor: ContactLinkActor,
  ): Promise<ContactLinkRecord> {
    return await this.write(async (tx) => {
      const [first] = await tx<ContactLinkRow[]>`SELECT * FROM contact_links WHERE id = ${id}`
      if (first) {
        if (
          first.version === 1 && first.kind === fields.kind && first.value === fields.value &&
          first.label === fields.label
        ) return toRecord(first)
        throw new ContactLinkError(`ID_ALREADY_EXISTS`, `A link with this id exists already.`)
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT COUNT(*)::int AS count FROM contact_links
      `
      if (count >= CONTACT_LINKS_MAX) {
        throw new ContactLinkError(
          `TOO_MANY_LINKS`,
          `The website keeps ${CONTACT_LINKS_MAX} links at most. Remove one first.`,
        )
      }
      const [row] = await tx<ContactLinkRow[]>`
        INSERT INTO contact_links (id, kind, value, label, position)
        VALUES (
          ${id}, ${fields.kind}, ${fields.value}, ${fields.label},
          (SELECT COALESCE(MAX(position) + 1, 0) FROM contact_links)
        )
        RETURNING *
      `
      await audit(tx, actor, CONTACT_LINK_AUDIT_KINDS.created, row)
      return toRecord(row)
    })
  }

  /** Saves every field of the link at `version`. */
  async update(
    id: string,
    version: number,
    fields: ContactLinkFields,
    actor: ContactLinkActor,
  ): Promise<ContactLinkRecord> {
    return await this.write(async (tx) => {
      await current(tx, id, version)
      const [row] = await tx<ContactLinkRow[]>`
        UPDATE contact_links
        SET kind = ${fields.kind}, value = ${fields.value}, label = ${fields.label},
          updated_at = now(), version = version + 1
        WHERE id = ${id}
        RETURNING *
      `
      await audit(tx, actor, CONTACT_LINK_AUDIT_KINDS.updated, row)
      return toRecord(row)
    })
  }

  /** Removes the link at `version`; the ones after it move up. */
  async delete(id: string, version: number, actor: ContactLinkActor): Promise<void> {
    await this.write(async (tx) => {
      const row = await current(tx, id, version)
      await tx`DELETE FROM contact_links WHERE id = ${id}`
      await tx`UPDATE contact_links SET position = position - 1 WHERE position > ${row.position}`
      await audit(tx, actor, CONTACT_LINK_AUDIT_KINDS.deleted, row)
    })
  }

  /**
   * Puts the links in the order of `ids`, which must name every link once. A list that misses one,
   * names one twice or names one that is gone is refused with `ORDER_STALE`: the operator's page
   * is behind. Positions change, versions do not: an edit open elsewhere still saves.
   */
  async reorder(ids: readonly string[], actor: ContactLinkActor): Promise<ContactLinkRecord[]> {
    return await this.write(async (tx) => {
      const rows = await tx<{ id: string }[]>`SELECT id FROM contact_links`
      const known = new Set(rows.map((row) => row.id))
      if (new Set(ids).size !== ids.length || ids.length !== known.size) throw stale()
      if (ids.some((id) => !known.has(id))) throw stale()
      await tx`
        UPDATE contact_links AS link SET position = ordered.position - 1, updated_at = now()
        FROM unnest(${tx.array([...ids])}::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE link.id = ordered.id AND link.position <> ordered.position - 1
      `
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, details)
        VALUES (
          ${CONTACT_LINK_AUDIT_KINDS.reordered}, ${actor.userId}, ${actor.requestId},
          ${CONTACT_LINK_ENTITY}, ${tx.json({ ids: [...ids] })}
        )
      `
      const list = await tx<ContactLinkRow[]>`SELECT * FROM contact_links ORDER BY position, id`
      return list.map(toRecord)
    })
  }

  /** Runs `body` in a transaction that holds the table's write lock. */
  private async write<T>(body: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return await this.sql.begin(async (tx) => {
      await tx`LOCK TABLE contact_links IN SHARE ROW EXCLUSIVE MODE`
      return await body(tx)
    }) as T
  }
}

/** Every link in order, as the public website reads them: no id, no times. */
export async function listPublicContactLinks(sql: postgres.Sql): Promise<PublicContactLink[]> {
  return await sql<PublicContactLink[]>`
    SELECT kind, value, label FROM contact_links ORDER BY position, id
  `
}

function stale(): ContactLinkError {
  return new ContactLinkError(
    `ORDER_STALE`,
    `The links changed since this page loaded. Reload and try again.`,
  )
}

/**
 * The link at `id`, checked to still be at `version`. Throws `LINK_NOT_FOUND` when it is gone, or
 * {@link ContactLinkVersionConflictError} with its version.
 */
async function current(
  tx: postgres.TransactionSql,
  id: string,
  version: number,
): Promise<ContactLinkRow> {
  const [row] = await tx<ContactLinkRow[]>`SELECT * FROM contact_links WHERE id = ${id}`
  if (!row) throw new ContactLinkError(`LINK_NOT_FOUND`, `This link does not exist any more.`)
  if (row.version !== version) throw new ContactLinkVersionConflictError(row.version)
  return row
}

/** Writes the operator's audit row of one change to `link`. Its details name the kind and value. */
async function audit(
  tx: postgres.TransactionSql,
  actor: ContactLinkActor,
  kind: ContactLinkAuditKind,
  link: Pick<ContactLinkRow, `id` | `kind` | `value`>,
): Promise<void> {
  await tx`
    INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
    VALUES (
      ${kind}, ${actor.userId}, ${actor.requestId}, ${CONTACT_LINK_ENTITY}, ${link.id},
      ${tx.json({ kind: link.kind, value: link.value })}
    )
  `
}
