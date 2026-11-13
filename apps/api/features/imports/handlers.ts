import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { GroupRole } from "@domain/groups"
import {
  assertCanSeeImport,
  ImportCheckQuery,
  ImportCommitCommand,
  ImportCreateCommand,
  ImportError,
  ImportGetQuery,
  ImportListQuery,
  ImportStatus,
  type ImportSummary,
  ImportUndoCommand,
} from "@domain/imports"
import {
  assertMapping,
  checkRows,
  columnCount,
  type ImportKind,
  kindOf,
} from "@server/imports/import-kind.ts"
import type { PostgresImportRepository } from "@server/imports/postgres-import-repository.ts"

/** What the import handlers run on. */
export interface ImportHandlerDependencies {
  /** The actor's role in the group, from Postgres; `null` for a stranger. */
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
  imports: Pick<
    PostgresImportRepository,
    "create" | "get" | "listForUser" | "file" | "requestCommit" | "undo"
  >
  kinds: readonly ImportKind[]
}

/**
 * Stores an upload: the kind must exist, take the file's ending and size, and the actor must be a
 * member whose role may create its records (checked again inside the write).
 */
export function createImportCreateHandler(
  { imports, kinds }: ImportHandlerDependencies,
): CommandHandler<ImportCreateCommand> {
  return async ({ data }) => {
    const kind = kindOf(kinds, data.kind)
    const name = data.fileName.toLowerCase()
    if (!kind.accept.some((ending) => name.endsWith(ending))) {
      throw new ImportError(
        "IMPORT_REFUSED",
        `${kind.label} import takes ${kind.accept.join(`, `)} files`,
      )
    }
    if (data.file.bytes.byteLength === 0) {
      throw new ImportError("IMPORT_REFUSED", `The file is empty`)
    }
    if (data.file.bytes.byteLength > kind.maxBytes) {
      throw new ImportError(
        "FILE_TOO_LARGE",
        `The file is larger than ${Math.floor(kind.maxBytes / 1024)} KiB`,
      )
    }
    return await imports.create(
      {
        id: uuidV7(),
        groupId: data.groupId,
        kind: kind.id,
        fileName: data.fileName,
        file: data.file.bytes,
      },
      data.actor.userId,
      kind,
    )
  }
}

/** One import, to its starter and the group's admins; anyone else is told it does not exist. */
export function createImportGetHandler(
  dependencies: ImportHandlerDependencies,
): QueryHandler<ImportGetQuery> {
  return async ({ data }) =>
    await visible(dependencies, data.groupId, data.importId, data.actor.userId)
}

/** The actor's own imports in a group they belong to. */
export function createImportListHandler(
  { roleOf, imports }: ImportHandlerDependencies,
): QueryHandler<ImportListQuery> {
  return async ({ data }) => {
    assertCanSeeImport(
      await roleOf(data.groupId, data.actor.userId),
      data.actor.userId,
      data.actor.userId,
    )
    return { imports: await imports.listForUser(data.groupId, data.actor.userId) }
  }
}

/**
 * Checks every row of a read import under a mapping and answers the refused ones, capped; saves
 * nothing. Only someone who could save it may check it.
 */
export function createImportCheckHandler(
  dependencies: ImportHandlerDependencies,
): QueryHandler<ImportCheckQuery> {
  return async ({ data }) => {
    const role = await dependencies.roleOf(data.groupId, data.actor.userId)
    const found = await visible(dependencies, data.groupId, data.importId, data.actor.userId, role)
    const kind = kindOf(dependencies.kinds, found.kind)
    if (!kind.canCreate(role!)) {
      throw new ImportError("ROLE_INSUFFICIENT", `Your role cannot add ${kind.label.toLowerCase()}`)
    }
    if (found.status !== ImportStatus.READY) {
      throw new ImportError(
        "VERSION_CONFLICT",
        `Only a read import that is not saved can be checked`,
      )
    }
    const bytes = await dependencies.imports.file(found.id)
    const read = bytes ? await kind.read(bytes) : null
    if (!read?.ok) throw new ImportError("IMPORT_REFUSED", read?.error ?? `The file is gone`)
    assertMapping(kind, data.mapping, columnCount(read.value))
    return checkRows(kind, read.value.rows, data.mapping).result
  }
}

/**
 * Saves a read import under a mapping: the commit job writes the rows. The mapping is checked
 * against the file first, so a wrong column is a 400 here and never a failed import; the
 * repository then checks who may save it again, on the locked group.
 */
export function createImportCommitHandler(
  dependencies: ImportHandlerDependencies,
): CommandHandler<ImportCommitCommand> {
  return async ({ data }) => {
    const found = await visible(dependencies, data.groupId, data.importId, data.actor.userId)
    if (found.status === ImportStatus.READY) {
      const kind = kindOf(dependencies.kinds, found.kind)
      const bytes = await dependencies.imports.file(found.id)
      const read = bytes ? await kind.read(bytes) : null
      if (read?.ok) assertMapping(kind, data.mapping, columnCount(read.value))
    }
    return await dependencies.imports.requestCommit(
      data.groupId,
      data.importId,
      data.actor.userId,
      data.mapping,
    )
  }
}

/**
 * Removes a saved import's records, in the request, in one transaction. The repository checks who
 * may undo it again, on the locked group.
 */
export function createImportUndoHandler(
  dependencies: ImportHandlerDependencies,
): CommandHandler<ImportUndoCommand> {
  return async ({ data }) => {
    await visible(dependencies, data.groupId, data.importId, data.actor.userId)
    return await dependencies.imports.undo(data.groupId, data.importId, data.actor.userId)
  }
}

/** The import, or the same "not found" for one that does not exist and one the actor may not see. */
async function visible(
  { roleOf, imports }: ImportHandlerDependencies,
  groupId: string,
  importId: string,
  userId: number,
  known?: GroupRole | null,
): Promise<ImportSummary> {
  const role = known === undefined ? await roleOf(groupId, userId) : known
  assertCanSeeImport(role, userId, userId)
  const found = await imports.get(groupId, importId)
  if (!found) throw new ImportError("ITEM_NOT_FOUND", "Import not found")
  assertCanSeeImport(role, found.userId, userId)
  return found
}
