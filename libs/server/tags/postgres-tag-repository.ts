import type postgres from "postgres"
import type { GroupRole } from "@domain/groups"
import {
  assertCanWriteTags,
  assertTagRoom,
  type DeletedTag,
  type ListedTag,
  type Tag,
  TAG_EVENTS,
  type TagCreateInput,
  type TagDeleteInput,
  TagError,
  type TagRepository,
  type TagUpdateInput,
  TagVersionConflictError,
  type TagWriteResult,
} from "@domain/tags"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { writeAuditEvent } from "@server/groups/audit.ts"

interface TagRow extends postgres.Row, Tag {}

/** Postgres's code for a violated unique index: the name is taken. */
const UNIQUE_VIOLATION = "23505"

/**
 * Records a tag's change on its group. A group deleted since the role check is answered as a
 * missing group, and the tag write rolls back with it.
 */
async function recordTagChange(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
  eventKind: string,
): Promise<string> {
  try {
    return await recordGroupChange(sql, groupId, actorId, eventKind)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new TagError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/** Checks, in the write's own transaction, that the actor may still change the group's tags. */
async function assertWriterNow(
  transaction: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole> {
  try {
    const role = await lockActorRole(transaction, groupId, actorId)
    assertCanWriteTags(role)
    return role as GroupRole
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new TagError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

function isNameTaken(error: unknown): boolean {
  return typeof error === "object" && error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION &&
    String((error as { constraint_name?: string }).constraint_name ?? "").includes("name")
}

/**
 * Tags in Postgres. Every write runs in one transaction that checks the actor's role on the locked
 * membership row, then records the change on the group (`recordGroupChange`) and writes its audit
 * event, like a note's.
 *
 * A group holds at most `TAG_MAX_PER_GROUP` tags. A create counts them after its insert, in the
 * same transaction: the group row that `assertWriterNow` locks makes a second create of the same
 * group wait for this one to commit, and then count it. A move of notes creates tags too and
 * counts the same way (`mapTagsOnMove` in the note repository).
 *
 * Deleting a tag deletes its `note_tags` rows through the foreign key and touches no note, so no
 * note's version or sequence moves (ADR 003, section 5, rule 3).
 */
export class PostgresTagRepository implements TagRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /** Counts each tag's live notes through `idx_note_tags_tag`; a deleted note does not count. */
  async list(groupId: string): Promise<ListedTag[]> {
    const rows = await this.sql<(TagRow & { noteCount: number })[]>`
      SELECT ${this.columns()}, (
        SELECT count(*)::int FROM note_tags
        JOIN notes ON notes.id = note_tags.note_id AND notes.deleted_at IS NULL
        WHERE note_tags.tag_id = tags.id
      ) AS note_count
      FROM tags WHERE group_id = ${groupId} ORDER BY lower(name), id
    `
    return rows.map((row) => ({ ...toTag(row), noteCount: row.noteCount }))
  }

  async get(groupId: string, id: string): Promise<Tag | null> {
    const row = (
      await this.sql<TagRow[]>`
        SELECT ${this.columns()} FROM tags WHERE id = ${id} AND group_id = ${groupId}
      `
    )[0]
    return row ? toTag(row) : null
  }

  /** How many tags the group holds: what `TAG_MAX_PER_GROUP` caps. */
  async count(groupId: string): Promise<number> {
    const [{ count }] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM tags WHERE group_id = ${groupId}
    `
    return count
  }

  async create(input: TagCreateInput, actorId: number): Promise<TagWriteResult> {
    try {
      return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
        const repository = new PostgresTagRepository(transaction)
        await assertWriterNow(transaction, input.groupId, actorId)
        // The id is the primary key, so a retry of this request inserts nothing; the name is
        // unique too, and a name clash raises the unique violation handled below.
        const inserted = (
          await transaction<{ id: string }[]>`
            INSERT INTO tags (
              id, group_id, name, color, change_sequence, created_by_user_id, updated_by_user_id
            ) VALUES (
              ${input.id}, ${input.groupId}, ${input.name}, ${input.color}, 1, ${actorId}, ${actorId}
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
        )[0]
        if (inserted) {
          // A retry of a create that landed inserts nothing, so it is neither counted nor refused.
          assertTagRoom(await repository.count(input.groupId))
          const tag = await repository.stamp(
            transaction,
            input.groupId,
            input.id,
            actorId,
            TAG_EVENTS.created,
          )
          await writeAuditEvent(transaction, {
            eventKind: TAG_EVENTS.created,
            actorId,
            groupId: input.groupId,
            requestId: input.requestId,
            entityType: "tag",
            entityId: input.id,
            details: { name: input.name },
          })
          return { tag, created: true }
        }
        const existing = await repository.get(input.groupId, input.id)
        if (
          existing && existing.createdByUserId === actorId && existing.name === input.name &&
          existing.color === input.color
        ) {
          return { tag: existing, created: false }
        }
        throw new TagError("ID_ALREADY_EXISTS", "Tag id is already in use")
      })
    } catch (error) {
      if (isNameTaken(error)) throw new TagError("TAG_NAME_TAKEN", "A tag with this name exists")
      throw error
    }
  }

  async update(input: TagUpdateInput, actorId: number): Promise<Tag> {
    try {
      return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
        const repository = new PostgresTagRepository(transaction)
        await assertWriterNow(transaction, input.groupId, actorId)
        // The row is read locked first, so the audit event can say what the name and colour were.
        const [updated] = await transaction<{ previousName: string; previousColor: string }[]>`
          UPDATE tags
          SET name = ${input.name},
              color = ${input.color},
              version = version + 1,
              updated_by_user_id = ${actorId},
              updated_at = CURRENT_TIMESTAMP
          FROM (
            SELECT id, name, color FROM tags
            WHERE id = ${input.id}
              AND group_id = ${input.groupId}
              AND version = ${input.expectedVersion}
            FOR UPDATE
          ) AS previous
          WHERE tags.id = previous.id
          RETURNING previous.name AS previous_name, previous.color AS previous_color
        `
        if (!updated) return await repository.refuseStaleWrite(input.groupId, input.id)
        await writeAuditEvent(transaction, {
          eventKind: TAG_EVENTS.updated,
          actorId,
          groupId: input.groupId,
          requestId: input.requestId,
          entityType: "tag",
          entityId: input.id,
          details: {
            name: input.name,
            ...(updated.previousName !== input.name && { from: updated.previousName }),
            ...(updated.previousColor !== input.color && { color: input.color }),
          },
        })
        return await repository.stamp(
          transaction,
          input.groupId,
          input.id,
          actorId,
          TAG_EVENTS.updated,
        )
      })
    } catch (error) {
      if (isNameTaken(error)) throw new TagError("TAG_NAME_TAKEN", "A tag with this name exists")
      throw error
    }
  }

  async delete(input: TagDeleteInput, actorId: number): Promise<DeletedTag> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const repository = new PostgresTagRepository(transaction)
      await assertWriterNow(transaction, input.groupId, actorId)
      // Counted before the delete: the foreign key takes the links with the tag, and no note
      // records that it lost one, so the audit event is the only place that says how many did.
      // A note in the trash keeps its links, and is not counted: the activity log speaks of the
      // notes a member can see.
      const [{ notes }] = await transaction<{ notes: number }[]>`
        SELECT count(*)::int AS notes
        FROM note_tags
        INNER JOIN notes ON notes.id = note_tags.note_id
        WHERE note_tags.tag_id = ${input.id} AND notes.deleted_at IS NULL
      `
      const deleted = (
        await transaction<{ id: string; groupId: string; version: number; name: string }[]>`
          DELETE FROM tags
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND version = ${input.expectedVersion}
          RETURNING id, group_id, version, name
        `
      )[0]
      if (!deleted) return await repository.refuseStaleWrite(input.groupId, input.id)
      await writeAuditEvent(transaction, {
        eventKind: TAG_EVENTS.deleted,
        actorId,
        groupId: input.groupId,
        requestId: input.requestId,
        entityType: "tag",
        entityId: input.id,
        details: { name: deleted.name, notes },
      })
      const sequence = await recordTagChange(
        transaction,
        input.groupId,
        actorId,
        TAG_EVENTS.deleted,
      )
      return {
        id: deleted.id,
        groupId: deleted.groupId,
        version: deleted.version,
        changeSequence: sequence,
      }
    })
  }

  /**
   * Records the change of a tag written in this transaction on its group, stores the sequence on
   * the tag and returns the tag as it now reads.
   */
  private async stamp(
    transaction: postgres.TransactionSql,
    groupId: string,
    id: string,
    actorId: number,
    eventKind: string,
  ): Promise<Tag> {
    const sequence = await recordTagChange(transaction, groupId, actorId, eventKind)
    const row = (
      await this.sql<TagRow[]>`
        UPDATE tags SET change_sequence = ${sequence}::bigint
        WHERE id = ${id}
        RETURNING ${this.columns()}
      `
    )[0]
    if (!row) throw new Error(`Tag ${id} vanished while its change was being recorded`)
    return toTag(row)
  }

  /** Explains why a write matched no row: the tag is gone, or it is at another version. */
  private async refuseStaleWrite(groupId: string, id: string): Promise<never> {
    const current = (
      await this.sql<{ version: number }[]>`
        SELECT version FROM tags WHERE id = ${id} AND group_id = ${groupId}
      `
    )[0]
    if (!current) throw new TagError("TAG_NOT_FOUND", "Tag not found")
    throw new TagVersionConflictError(current.version)
  }

  private columns() {
    return this.sql`
      id,
      group_id,
      name,
      color,
      version,
      change_sequence::text AS change_sequence,
      created_by_user_id,
      updated_by_user_id,
      created_at,
      updated_at
    `
  }
}

function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    color: row.color,
    version: row.version,
    changeSequence: row.changeSequence,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
