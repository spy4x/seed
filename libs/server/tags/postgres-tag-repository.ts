import type postgres from "postgres"
import type { GroupRole } from "@domain/groups"
import {
  assertCanWriteTags,
  type DeletedTag,
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
 * membership row, then records the change on the group (`recordGroupChange`), like a note's.
 *
 * Deleting a tag deletes its `note_tags` rows through the foreign key and touches no note, so no
 * note's version or sequence moves (ADR 003, section 5, rule 3).
 */
export class PostgresTagRepository implements TagRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async list(groupId: string): Promise<Tag[]> {
    const rows = await this.sql<TagRow[]>`
      SELECT ${this.columns()} FROM tags WHERE group_id = ${groupId} ORDER BY lower(name), id
    `
    return rows.map(toTag)
  }

  async get(groupId: string, id: string): Promise<Tag | null> {
    const row = (
      await this.sql<TagRow[]>`
        SELECT ${this.columns()} FROM tags WHERE id = ${id} AND group_id = ${groupId}
      `
    )[0]
    return row ? toTag(row) : null
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
          return {
            tag: await repository.stamp(
              transaction,
              input.groupId,
              input.id,
              actorId,
              TAG_EVENTS.created,
            ),
            created: true,
          }
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
        const updated = await transaction<{ id: string }[]>`
          UPDATE tags
          SET name = ${input.name},
              color = ${input.color},
              version = version + 1,
              updated_by_user_id = ${actorId},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND version = ${input.expectedVersion}
          RETURNING id
        `
        if (updated.length === 0) return await repository.refuseStaleWrite(input.groupId, input.id)
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
      const deleted = (
        await transaction<{ id: string; groupId: string; version: number }[]>`
          DELETE FROM tags
          WHERE id = ${input.id}
            AND group_id = ${input.groupId}
            AND version = ${input.expectedVersion}
          RETURNING id, group_id, version
        `
      )[0]
      if (!deleted) return await repository.refuseStaleWrite(input.groupId, input.id)
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
