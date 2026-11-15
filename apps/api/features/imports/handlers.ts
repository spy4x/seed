import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { GroupRole } from "@domain/groups"
import {
  assertCanSeeImport,
  IMPORT_REVIEW_ROWS_MAX,
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
  assertChoices,
  assertMapping,
  checkRows,
  columnCount,
  type ImportKind,
  kindOf,
} from "@server/imports/import-kind.ts"
import {
  noOptions,
  type PostgresImportRepository,
} from "@server/imports/postgres-import-repository.ts"

/** What the import handlers run on. */
export interface ImportHandlerDependencies {
  /** The actor's role in the group, from Postgres; `null` for a stranger. */
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
  imports: Pick<
    PostgresImportRepository,
    "create" | "get" | "listForUser" | "file" | "review" | "requestCommit" | "undo"
  >
  kinds: readonly ImportKind[]
}

/**
 * Stores an upload: the kind must exist, take the file's ending and size, and the actor must be a
 * member whose role may create its records (checked again inside the write). Options for a kind
 * that reads none are refused before anything is written.
 */
export function createImportCreateHandler(
  { imports, kinds }: ImportHandlerDependencies,
): CommandHandler<ImportCreateCommand> {
  return async ({ data }) => {
    const kind = kindOf(kinds, data.kind)
    if (data.options !== undefined && !kind.readOptions) throw noOptions(kind)
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
        options: data.options,
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
 * nothing. A kind with a `review` also answers the first valid rows with its review of each, in a
 * read-only transaction. Only someone who could save it may check it.
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
    const { values, valueRows, result } = checkRows(
      kind,
      read.value.rows,
      data.mapping,
      found.options,
    )
    if (!kind.review) return result
    const shown = values.slice(0, IMPORT_REVIEW_ROWS_MAX)
    const reviews = shown.length === 0 ? [] : await dependencies.imports.review(kind, shown, {
      importId: found.id,
      groupId: data.groupId,
      actorId: data.actor.userId,
      role: role!,
      options: found.options,
    })
    return {
      ...result,
      reviews: reviews.map(({ skip, suggestions }, index) => ({
        row: valueRows[index],
        cells: [...read.value.rows[valueRows[index] - 1]],
        skip,
        suggestions,
      })),
    }
  }
}

/**
 * Saves a read import under a mapping and the person's choices: the commit job writes the rows.
 * The mapping and the choices are checked against the kind and the file first, so a wrong column,
 * a field that is not a choice or a row past the file is a 400 here and never a failed import; the
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
      if (data.choices) assertChoices(kind, data.choices, found.rowCount ?? 0)
    }
    return await dependencies.imports.requestCommit(
      data.groupId,
      data.importId,
      data.actor.userId,
      data.mapping,
      data.choices,
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
