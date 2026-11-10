import { importKinds } from "@server/imports/registry.ts"
import { PostgresImportRepository } from "@server/imports/postgres-import-repository.ts"
import type { ImportHandlerDependencies } from "../features/imports/handlers.ts"
import { config } from "../services/config.ts"
import { db, sql } from "../services/db.ts"

const kinds = importKinds(config.notes)

/**
 * What the import handlers run on: the imports table, the kinds `importKinds` offers under the
 * notes' switch, and the actor's role read from the group's membership in Postgres (never from a
 * cache: it decides who may see an import).
 */
export const importDependencies: ImportHandlerDependencies = {
  roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  imports: new PostgresImportRepository(sql, kinds),
  kinds,
}
