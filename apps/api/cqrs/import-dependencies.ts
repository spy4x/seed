import { IMPORT_KINDS } from "@server/imports/registry.ts"
import { PostgresImportRepository } from "@server/imports/postgres-import-repository.ts"
import type { ImportHandlerDependencies } from "../features/imports/handlers.ts"
import { db, sql } from "../services/db.ts"

/**
 * What the import handlers run on: the imports table, the kinds in `IMPORT_KINDS`, and the actor's
 * role read from the group's membership in Postgres (never from a cache: it decides who may see an
 * import).
 */
export const importDependencies: ImportHandlerDependencies = {
  roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  imports: new PostgresImportRepository(sql, IMPORT_KINDS),
  kinds: IMPORT_KINDS,
}
