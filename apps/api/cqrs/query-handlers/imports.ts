import { ImportCheckQuery, ImportGetQuery, ImportListQuery } from "@domain/imports"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import {
  createImportCheckHandler,
  createImportGetHandler,
  createImportListHandler,
} from "../../features/imports/handlers.ts"
import { importDependencies } from "../import-dependencies.ts"

export const importGetHandler: QueryHandler<ImportGetQuery> = createImportGetHandler(
  importDependencies,
)

export const importListHandler: QueryHandler<ImportListQuery> = createImportListHandler(
  importDependencies,
)

export const importCheckHandler: QueryHandler<ImportCheckQuery> = createImportCheckHandler(
  importDependencies,
)
