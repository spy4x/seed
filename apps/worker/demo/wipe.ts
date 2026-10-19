import type postgres from "postgres"

/**
 * The tables the nightly wipe keeps: the migration history, so the schema is not migrated again,
 * and the backup service's last good backup (`infra/backup/backup.sh`), which is about the server,
 * not the demo. Every other table in the schema is emptied, a new one included, so a table added
 * later needs no change here unless it must survive the wipe (docs/demo.md).
 */
export const KEPT_TABLES: readonly string[] = [`migrations`, `backup_status`]

/** How long the wipe waits for a lock before it gives up, instead of stalling the worker. */
const LOCK_TIMEOUT = `30s`

/**
 * Empties every table of the current schema except {@link KEPT_TABLES}, in one transaction, and
 * answers the tables it emptied. Identities are not restarted: a new row never gets an id an old
 * row had, so nothing cached under an old id (the API caches users by id) can describe a new one.
 * Running it twice leaves the same empty tables.
 */
export async function wipeDatabase(sql: postgres.Sql): Promise<string[]> {
  return await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`)
    const rows = await tx<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = current_schema() AND tablename NOT IN ${tx(KEPT_TABLES)}
      ORDER BY tablename
    `
    const names = rows.map((row) => row.name)
    if (names.length > 0) {
      const quoted = names.map((name) => `"${name.replaceAll(`"`, `""`)}"`)
      await tx.unsafe(`TRUNCATE ${quoted.join(`, `)} CASCADE`)
    }
    return names
  })
}
