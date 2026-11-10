import { ImportCommitCommand, ImportCreateCommand, ImportUndoCommand } from "@domain/imports"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import {
  createImportCommitHandler,
  createImportCreateHandler,
  createImportUndoHandler,
} from "../../features/imports/handlers.ts"
import { importDependencies } from "../import-dependencies.ts"

export const importCreateHandler: CommandHandler<ImportCreateCommand> = createImportCreateHandler(
  importDependencies,
)

export const importCommitHandler: CommandHandler<ImportCommitCommand> = createImportCommitHandler(
  importDependencies,
)

export const importUndoHandler: CommandHandler<ImportUndoCommand> = createImportUndoHandler(
  importDependencies,
)
