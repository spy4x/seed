import type postgres from "postgres"
import { assertRoomFor } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  assertCanWriteNotes,
  type DeletedNote,
  type Note,
  NOTE_EVENTS,
  type NoteCreateInput,
  type NoteDeleteInput,
  NoteError,
  type NoteListPage,
  type NoteListResult,
  type NoteMoveInput,
  type NoteRepository,
  type NoteRestoreInput,
  type NoteSearchHit,
  type NoteUpdateInput,
  NoteVersionConflictError,
  type NoteWriteResult,
} from "@domain/notes"
import { TAG_EVENTS, TAG_MAX_PER_GROUP, TagError } from "@domain/tags"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { writeAuditEvent } from "@server/groups/audit.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { searchNotesForMember } from "./note-search.ts"

/** The longest note title an audit event keeps, so the log never holds more than a line of text. */
const AUDIT_TITLE_MAX = 100

interface NoteRow extends postgres.Row, Note {}

interface VersionRow extends postgres.Row {
  version: number
}

interface DeletedRow extends postgres.Row {
  id: string
  groupId: string
  version: number
  title: string
}

/**
 * Sets the tags of a note to those of `tagIds` that exist in the note's group. An id the group has
 * no tag for (unknown, in another group, already deleted) is ignored, never an error: a client
 * may have queued a note naming a tag that is gone (ADR 003, section 5, rule 4).
 */
async function setNoteTags(
  transaction: postgres.TransactionSql,
  groupId: string,
  noteId: string,
  tagIds: readonly string[],
): Promise<void> {
  await transaction`DELETE FROM note_tags WHERE note_id = ${noteId}`
  if (tagIds.length === 0) return
  await transaction`
    INSERT INTO note_tags (note_id, tag_id)
    SELECT ${noteId}, id FROM tags WHERE group_id = ${groupId} AND id IN ${transaction(tagIds)}
    ON CONFLICT DO NOTHING
  `
}

/**
 * Gives the notes that just moved to `toGroupId` the tags of the same names there, creating the
 * ones the target lacks, and drops their links to the source group's tags. Names are compared
 * without regard to case, as the group's unique index does. The source group's tags stay.
 *
 * A tag created here counts against the target's cap (`TAG_MAX_PER_GROUP`) like one made by
 * `tag.create`, and gets the same audit event. The count runs after the insert, in the move's
 * transaction, which holds the lock on the target group that a `tag.create` there waits for. A
 * move that would pass the cap is refused whole with `TAG_LIMIT_REACHED`, and the caller's
 * transaction takes it back: moving the notes without the tags that do not fit would drop those
 * tags from the notes without telling anyone. A move that creates no tag is never refused, so
 * notes whose tags the target already has still move into a full group.
 */
async function mapTagsOnMove(
  transaction: postgres.TransactionSql,
  input: MoveNoteRowsInput,
  noteIds: readonly string[],
): Promise<void> {
  if (noteIds.length === 0) return
  // The application makes every id, so every copy gets its id here (docs/ids.md). A tag
  // the target already has keeps its own row and id: the conflict drops the copy.
  const carried = await transaction<{ name: string; color: string }[]>`
    SELECT source.name, source.color
    FROM tags source
    WHERE source.group_id = ${input.fromGroupId}
      AND source.id IN (SELECT tag_id FROM note_tags WHERE note_id IN ${transaction(noteIds)})
  `
  if (carried.length > 0) {
    const copies = carried.map((tag) => ({
      id: uuidV7(),
      group_id: input.toGroupId,
      name: tag.name,
      color: tag.color,
      change_sequence: input.changeSequence,
      created_by_user_id: input.actorId,
      updated_by_user_id: input.actorId,
    }))
    const created = await transaction<{ id: string; name: string }[]>`
      INSERT INTO tags ${transaction(copies)}
      ON CONFLICT (group_id, lower(name)) DO NOTHING
      RETURNING id, name
    `
    if (created.length > 0) {
      const [{ count }] = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM tags WHERE group_id = ${input.toGroupId}
      `
      if (count > TAG_MAX_PER_GROUP) {
        throw new TagError(
          "TAG_LIMIT_REACHED",
          `The other group has no room for these notes' tags: it can hold ${TAG_MAX_PER_GROUP}`,
        )
      }
    }
    for (const tag of created) {
      await writeAuditEvent(transaction, {
        eventKind: TAG_EVENTS.created,
        actorId: input.actorId,
        groupId: input.toGroupId,
        requestId: input.requestId,
        entityType: "tag",
        entityId: tag.id,
        details: { name: tag.name },
      })
    }
  }
  await transaction`
    INSERT INTO note_tags (note_id, tag_id)
    SELECT links.note_id, target.id
    FROM note_tags links
    INNER JOIN tags source ON source.id = links.tag_id AND source.group_id = ${input.fromGroupId}
    INNER JOIN tags target
      ON target.group_id = ${input.toGroupId} AND lower(target.name) = lower(source.name)
    WHERE links.note_id IN ${transaction(noteIds)}
    ON CONFLICT DO NOTHING
  `
  await transaction`
    DELETE FROM note_tags
    USING tags
    WHERE note_tags.tag_id = tags.id
      AND tags.group_id = ${input.fromGroupId}
      AND note_tags.note_id IN ${transaction(noteIds)}
  `
}

/**
 * Records a note's change on its group. A group deleted since the role check is answered as a
 * missing group, and the note write rolls back with it.
 */
async function recordNoteChange(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
  eventKind: string,
): Promise<string> {
  try {
    return await recordGroupChange(sql, groupId, actorId, eventKind)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new NoteError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/**
 * Checks, in the write's own transaction, that the actor may still change the group's notes: the
 * handler's check ran before it, and the owner may have removed or demoted the actor since. A group
 * deleted since is answered as a missing group.
 */
async function assertWriterNow(
  transaction: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole> {
  try {
    const role = await lockActorRole(transaction, groupId, actorId)
    assertCanWriteNotes(role)
    return role as GroupRole
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new NoteError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/** What {@link moveNoteRows} moves, and the facts it needs from the move around it. */
export interface MoveNoteRowsInput {
  fromGroupId: string
  toGroupId: string
  /** The notes to move, all of which must be live in the source; `null` moves every live note. */
  noteIds: readonly string[] | null
  actorId: number
  /** The sequence of the change recorded on the target for this move; the notes are stamped. */
  changeSequence: string
  /** The target's cap on notes, `null` for none. */
  allowance: number | null
  /** The actor's role in the target, which a plan refusal needs. */
  targetRole: GroupRole
  /** The request the move came from, kept on the audit event of each tag the move creates. */
  requestId?: string
}

/**
 * The part of a move that moving chosen notes and moving a whole group share, in the caller's
 * transaction (which has locked both groups and checked the roles): the notes change group, their
 * version grows by one so an edit made on the old version conflicts, and the target's cap is
 * counted after the update. The notes' tags follow by name (`mapTagsOnMove`). Throws
 * `NOTE_NOT_FOUND` when a named note is not live in the source, a `PlanError` when the target
 * would pass its cap on notes, and `TagError("TAG_LIMIT_REACHED")` when the notes' tags would pass
 * its cap on tags; the caller's transaction takes the move back. Returns how many notes moved.
 */
export async function moveNoteRows(
  transaction: postgres.TransactionSql,
  input: MoveNoteRowsInput,
): Promise<number> {
  const moved = await transaction<{ id: string }[]>`
    UPDATE notes
    SET group_id = ${input.toGroupId},
        version = version + 1,
        updated_by_user_id = ${input.actorId},
        updated_at = CURRENT_TIMESTAMP,
        change_sequence = ${input.changeSequence}::bigint
    WHERE group_id = ${input.fromGroupId}
      AND deleted_at IS NULL
      ${
    input.noteIds === null ? transaction`` : transaction`AND id IN ${transaction(input.noteIds)}`
  }
    RETURNING id
  `
  // One missing note refuses the whole move, and the transaction takes the others back.
  if (input.noteIds !== null && moved.length !== input.noteIds.length) {
    throw new NoteError("NOTE_NOT_FOUND", "Note not found")
  }
  await mapTagsOnMove(transaction, input, moved.map((row) => row.id))
  if (moved.length > 0 && input.allowance !== null) {
    const used = await new PostgresNoteRepository(transaction).count(input.toGroupId) - 1
    assertRoomFor("maxNotes", input.allowance, used, input.targetRole)
  }
  return moved.length
}

/**
 * Notes in Postgres. Every write runs in one transaction that first checks the actor's role on
 * the locked membership row and then records the change on the group (`recordGroupChange`): the
 * group's sequence moves and an outbox row is written, or neither happens.
 */
export class PostgresNoteRepository implements NoteRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async list(groupId: string, page: NoteListPage, deleted = false): Promise<NoteListResult> {
    const limit = Math.max(1, Math.min(100, page.limit))
    const rows = await this.sql<NoteRow[]>`
      SELECT ${this.columns()}
      FROM notes
      WHERE group_id = ${groupId}
        AND ${deleted ? this.sql`deleted_at IS NOT NULL` : this.sql`deleted_at IS NULL`}
        ${
      page.after
        ? this.sql`
          AND (
            updated_at < ${page.after.updatedAt}
            OR (updated_at = ${page.after.updatedAt} AND id > ${page.after.id})
          )
        `
        : this.sql``
    }
      ORDER BY updated_at DESC, id
      LIMIT ${limit + 1}
    `
    const notes = rows.slice(0, limit).map(toNote)
    const last = notes.at(-1)
    return {
      notes,
      nextPageKey: rows.length > limit && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    }
  }

  /** How many notes the group holds, deleted ones not counted: what `maxNotes` caps. */
  async count(groupId: string): Promise<number> {
    const [{ count }] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM notes WHERE group_id = ${groupId} AND deleted_at IS NULL
    `
    return count
  }

  async get(groupId: string, id: string): Promise<Note | null> {
    const row = (
      await this.sql<NoteRow[]>`
        SELECT ${this.columns()}
        FROM notes
        WHERE id = ${id} AND group_id = ${groupId} AND deleted_at IS NULL
      `
    )[0]
    return row ? toNote(row) : null
  }

  async groupIdOfForMember(id: string, userId: number): Promise<string | null> {
    const row = (
      await this.sql<{ groupId: string }[]>`
        SELECT notes.group_id
        FROM notes
        INNER JOIN groups ON groups.id = notes.group_id AND groups.deleted_at IS NULL
        INNER JOIN group_members
          ON group_members.group_id = notes.group_id AND group_members.user_id = ${userId}
        INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
        WHERE notes.id = ${id} AND notes.deleted_at IS NULL
      `
    )[0]
    return row?.groupId ?? null
  }

  searchForMember(userId: number, text: string, limit: number): Promise<NoteSearchHit[]> {
    return searchNotesForMember(this.sql, userId, text, limit)
  }

  /**
   * The cap is counted after the insert, in the same transaction: the group row that
   * `assertWriterNow` locks makes a second create of the same group wait for this one to commit,
   * and then count it. A retry of a create that already landed inserts nothing and is not counted.
   */
  async create(
    input: NoteCreateInput,
    actorId: number,
    allowance: number | null,
  ): Promise<NoteWriteResult> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      const role = await assertWriterNow(transaction, input.groupId, actorId)
      // `change_sequence` is set below, once the change is recorded: recording it before the insert
      // would announce a change for a retry that inserts nothing.
      const inserted = (
        await transaction<{ id: string }[]>`
          INSERT INTO notes (
            id, group_id, title, body, change_sequence, created_by_user_id, updated_by_user_id
          ) VALUES (
            ${input.id}, ${input.groupId}, ${input.title}, ${input.body}, 1, ${actorId}, ${actorId}
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `
      )[0]
      if (inserted) {
        await setNoteTags(transaction, input.groupId, input.id, input.tagIds ?? [])
        if (allowance !== null) {
          const used = await repository.count(input.groupId) - 1
          assertRoomFor("maxNotes", allowance, used, role)
        }
        const note = await repository.stamp(
          transaction,
          input.groupId,
          input.id,
          actorId,
          NOTE_EVENTS.created,
        )
        await writeAuditEvent(transaction, {
          eventKind: NOTE_EVENTS.created,
          actorId,
          groupId: input.groupId,
          requestId: input.requestId,
          entityType: "note",
          entityId: input.id,
          details: { title: input.title.slice(0, AUDIT_TITLE_MAX) },
        })
        return { note, created: true }
      }

      // The id is taken. A retry of this very request gets the note back; anything else is refused.
      const existing = await repository.get(input.groupId, input.id)
      if (
        existing &&
        existing.createdByUserId === actorId &&
        existing.title === input.title &&
        existing.body === input.body
      ) {
        return { note: existing, created: false }
      }
      throw new NoteError("ID_ALREADY_EXISTS", "Note id is already in use")
    })
  }

  async update(input: NoteUpdateInput, actorId: number): Promise<Note> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      await assertWriterNow(transaction, input.groupId, actorId)
      const updated = await transaction<{ id: string }[]>`
        UPDATE notes
        SET title = ${input.title},
            body = ${input.body},
            version = version + 1,
            updated_by_user_id = ${actorId},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${input.id}
          AND group_id = ${input.groupId}
          AND deleted_at IS NULL
          AND version = ${input.expectedVersion}
        RETURNING id
      `
      if (updated.length === 0) return await repository.refuseStaleWrite(input.groupId, input.id)
      if (input.tagIds !== undefined) {
        await setNoteTags(transaction, input.groupId, input.id, input.tagIds)
      }
      return await repository.stamp(
        transaction,
        input.groupId,
        input.id,
        actorId,
        NOTE_EVENTS.updated,
      )
    })
  }

  async delete(input: NoteDeleteInput, actorId: number): Promise<DeletedNote> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      await assertWriterNow(transaction, input.groupId, actorId)
      const deleted = (
        await transaction<DeletedRow[]>`
          UPDATE notes
          SET deleted_at = CURRENT_TIMESTAMP,
              version = version + 1,
              updated_by_user_id = ${actorId},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND deleted_at IS NULL
            AND version = ${input.expectedVersion}
          RETURNING id, group_id, version, title
        `
      )[0]
      if (!deleted) return await repository.refuseStaleWrite(input.groupId, input.id)
      await writeAuditEvent(transaction, {
        eventKind: NOTE_EVENTS.deleted,
        actorId,
        groupId: input.groupId,
        requestId: input.requestId,
        entityType: "note",
        entityId: input.id,
        details: { title: deleted.title.slice(0, AUDIT_TITLE_MAX) },
      })
      const sequence = await recordNoteChange(
        transaction,
        input.groupId,
        actorId,
        NOTE_EVENTS.deleted,
      )
      await transaction`UPDATE notes SET change_sequence = ${sequence}::bigint WHERE id = ${input.id}`
      return {
        id: deleted.id,
        groupId: deleted.groupId,
        version: deleted.version,
        changeSequence: sequence,
      }
    })
  }

  /**
   * The cap is counted after the update, in the same transaction, like a create's: the group row
   * that `assertWriterNow` locks makes a create or a second restore wait for this one to commit.
   * A note that is not deleted matches nothing and is answered as not found.
   */
  async restore(
    input: NoteRestoreInput,
    actorId: number,
    allowance: number | null,
  ): Promise<Note> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresNoteRepository(transaction)
      const role = await assertWriterNow(transaction, input.groupId, actorId)
      const restored = (
        await transaction<{ id: string; title: string }[]>`
          UPDATE notes
          SET deleted_at = NULL,
              version = version + 1,
              updated_by_user_id = ${actorId},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND deleted_at IS NOT NULL
          RETURNING id, title
        `
      )[0]
      if (!restored) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
      if (allowance !== null) {
        const used = await repository.count(input.groupId) - 1
        assertRoomFor("maxNotes", allowance, used, role)
      }
      await writeAuditEvent(transaction, {
        eventKind: NOTE_EVENTS.restored,
        actorId,
        groupId: input.groupId,
        requestId: input.requestId,
        entityType: "note",
        entityId: input.id,
        details: { title: restored.title.slice(0, AUDIT_TITLE_MAX) },
      })
      return await repository.stamp(
        transaction,
        input.groupId,
        input.id,
        actorId,
        NOTE_EVENTS.restored,
      )
    })
  }

  /**
   * Both groups are locked in id order, so two moves in opposite directions wait for each other
   * instead of deadlocking, and each role is read on its locked membership row. The changes are
   * recorded first, so the moved rows carry the target's new sequence; the cap is counted after
   * the update, in the same transaction, like a create's.
   */
  async move(input: NoteMoveInput, actorId: number, allowance: number | null): Promise<Note[]> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const roles = new Map<string, GroupRole>()
      for (const groupId of [input.fromGroupId, input.toGroupId].sort()) {
        roles.set(groupId, await assertWriterNow(transaction, groupId, actorId))
      }
      await recordNoteChange(transaction, input.fromGroupId, actorId, NOTE_EVENTS.movedOut)
      const sequence = await recordNoteChange(
        transaction,
        input.toGroupId,
        actorId,
        NOTE_EVENTS.movedIn,
      )
      const count = await moveNoteRows(transaction, {
        fromGroupId: input.fromGroupId,
        toGroupId: input.toGroupId,
        noteIds: input.noteIds,
        actorId,
        changeSequence: sequence,
        allowance,
        targetRole: roles.get(input.toGroupId)!,
        requestId: input.requestId,
      })
      // The log of the group the notes left names where they went; the other says only how many.
      const target = (
        await transaction<{ name: string }[]>`SELECT name FROM groups WHERE id = ${input.toGroupId}`
      )[0]
      for (
        const [groupId, kind, details] of [
          [input.fromGroupId, NOTE_EVENTS.movedOut, { count, groupName: target.name }],
          [input.toGroupId, NOTE_EVENTS.movedIn, { count }],
        ] as const
      ) {
        await writeAuditEvent(transaction, {
          eventKind: kind,
          actorId,
          groupId,
          requestId: input.requestId,
          details,
        })
      }
      const rows = await transaction<NoteRow[]>`
        SELECT ${this.columnsOn(transaction)}
        FROM notes
        WHERE id IN ${transaction(input.noteIds)}
      `
      const byId = new Map(rows.map((row) => [row.id, toNote(row)]))
      return input.noteIds.map((id) => byId.get(id)!)
    })
  }

  /**
   * Records the change of a note written in this transaction on its group, stores the sequence on
   * the note and returns the note as it now reads.
   */
  private async stamp(
    transaction: postgres.TransactionSql,
    groupId: string,
    id: string,
    actorId: number,
    eventKind: string,
  ): Promise<Note> {
    const sequence = await recordNoteChange(transaction, groupId, actorId, eventKind)
    const row = (
      await this.sql<NoteRow[]>`
        UPDATE notes SET change_sequence = ${sequence}::bigint
        WHERE id = ${id}
        RETURNING ${this.columns()}
      `
    )[0]
    if (!row) throw new Error(`Note ${id} vanished while its change was being recorded`)
    return toNote(row)
  }

  /**
   * Explains why an update or delete matched no row: the note is gone (`NOTE_NOT_FOUND`) or it is
   * at another version ({@link NoteVersionConflictError} with that version). Always throws.
   */
  private async refuseStaleWrite(groupId: string, id: string): Promise<never> {
    const current = (
      await this.sql<VersionRow[]>`
        SELECT version FROM notes
        WHERE id = ${id} AND group_id = ${groupId} AND deleted_at IS NULL
      `
    )[0]
    if (!current) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    throw new NoteVersionConflictError(current.version)
  }

  private columns() {
    return this.columnsOn(this.sql)
  }

  private columnsOn(sql: postgres.Sql | postgres.TransactionSql) {
    return sql`
      id,
      group_id,
      title,
      body,
      COALESCE(
        (SELECT array_agg(note_tags.tag_id::text ORDER BY note_tags.tag_id)
         FROM note_tags WHERE note_tags.note_id = notes.id),
        '{}'
      ) AS tag_ids,
      version,
      change_sequence::text AS change_sequence,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    `
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    groupId: row.groupId,
    title: row.title,
    body: row.body,
    tagIds: row.tagIds,
    version: row.version,
    changeSequence: row.changeSequence,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
