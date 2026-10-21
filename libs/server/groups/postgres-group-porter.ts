import type postgres from "postgres"
import { assertRoomFor } from "@domain/billing"
import {
  GROUP_FILE_EVENTS,
  GroupError,
  groupExportFileName,
  type GroupExportResult,
  type GroupExportSettings,
  type GroupFilePorter,
  type GroupImportInput,
  type GroupImportResult,
  type GroupImportSummary,
  GroupRole,
  type MoveAllAllowances,
  parseGroupName,
} from "@domain/groups"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { writeAuditEvent } from "./audit.ts"
import { PostgresGroupRepository } from "./postgres-group-repository.ts"
import {
  groupFileParts,
  type ParsedGroupFile,
  parseGroupFile,
  type PortableAggregate,
  writeGroupFile,
} from "./portable.ts"

/**
 * A group's export file and the import of one, over the registered aggregates
 * (`PORTABLE_AGGREGATES` in `apps/api/services/db-base.ts`). The handlers check who may do what
 * first; this checks the file, counts it against a new group's plan and writes the import in one
 * transaction.
 */
export class PostgresGroupPorter implements GroupFilePorter {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly aggregates: readonly PortableAggregate[],
    private readonly now: () => Date = () => new Date(),
  ) {}

  async exportGroup(
    groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupExportResult> {
    const [settings] = await this.sql<GroupExportSettings[]>`
      SELECT name, description, color, emoji FROM groups
      WHERE id = ${groupId} AND deleted_at IS NULL
    `
    if (!settings) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    const now = this.now()
    await writeAuditEvent(this.sql, {
      eventKind: GROUP_FILE_EVENTS.exported,
      actorId,
      groupId,
      requestId,
    })
    const { name, description, color, emoji } = settings
    return {
      fileName: groupExportFileName(name, now),
      chunks: writeGroupFile(
        this.sql,
        groupId,
        { name, description, color, emoji },
        this.aggregates,
        now,
      ),
    }
  }

  check(file: unknown, allowances: MoveAllAllowances): GroupImportSummary {
    const parsed = this.parse(file, allowances)
    return { name: parsed.settings.name, parts: groupFileParts(parsed, this.aggregates) }
  }

  async importGroup(
    input: GroupImportInput,
    actorId: number,
    allowances: MoveAllAllowances,
  ): Promise<GroupImportResult> {
    const file = this.parse(input.file, allowances)
    const name = input.name === null ? file.settings.name : parseGroupName(input.name)
    const parts = groupFileParts(file, this.aggregates)
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const { group, changeSequence } = await new PostgresGroupRepository(transaction)
        .createImported({ ...file.settings, id: uuidV7(), name }, actorId)
      const newIds = new Map<string, ReadonlyMap<string, string>>()
      for (const aggregate of this.aggregates) {
        newIds.set(
          aggregate.kind,
          await aggregate.write(transaction, file.entries.get(aggregate.kind) ?? [], {
            groupId: group.id,
            actorId,
            changeSequence,
            newIdOf: (kind, fileId) => newIds.get(kind)?.get(fileId),
          }),
        )
      }
      await writeAuditEvent(transaction, {
        eventKind: GROUP_FILE_EVENTS.imported,
        actorId,
        groupId: group.id,
        requestId: input.requestId,
        details: {
          ...Object.fromEntries(parts.map((part) => [part.kind, part.count])),
          count: parts.reduce((sum, part) => sum + part.count, 0),
        },
      })
      return { group, parts }
    })
  }

  /**
   * The file, checked whole, then counted against a new group's plan: a new group starts on the
   * plan whose caps `allowances` holds, and the importer would be its owner.
   */
  private parse(file: unknown, allowances: MoveAllAllowances): ParsedGroupFile {
    const parsed = parseGroupFile(file, this.aggregates)
    for (const aggregate of this.aggregates) {
      if (!aggregate.limit) continue
      const count = parsed.entries.get(aggregate.kind)?.length ?? 0
      const max = allowances[aggregate.limit] ?? null
      if (count > 0) assertRoomFor(aggregate.limit, max, count - 1, GroupRole.OWNER)
    }
    return parsed
  }
}
