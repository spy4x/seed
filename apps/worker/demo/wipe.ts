import type postgres from "postgres"

/**
 * The tables the nightly wipe keeps: the migration history, so the schema is not migrated again,
 * the backup service's last good backup (`infra/backup/backup.sh`), which is about the server,
 * not the demo, the blog's posts and the contact links, which are the product's website's own,
 * not demo data, and the queue of stored files to delete, which the wipe fills with every attachment's
 * object and profile picture so the nightly clean-up empties the file store too. Every other table in the schema is emptied, a new one included, so a table added later
 * needs no change here unless it must survive the wipe (docs/demo.md). A kept table must not
 * reference an emptied one: `TRUNCATE ... CASCADE` would empty it too.
 */
export const KEPT_TABLES: readonly string[] = [
  `migrations`,
  `backup_status`,
  `blog_posts`,
  `contact_links`,
  `file_deletions`,
]

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
    // TRUNCATE fires no row trigger, so the attachments' objects, the profile pictures and their
    // processed widths are queued here, in the same transaction, for the clean-up to delete.
    await tx`
      INSERT INTO file_deletions (object_key) SELECT object_key FROM note_attachments
      ON CONFLICT DO NOTHING
    `
    await tx`
      INSERT INTO file_deletions (object_key)
      SELECT 'pictures/' || picture_id FROM users WHERE picture_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `
    await tx`
      INSERT INTO file_deletions (object_key)
      SELECT object_key FROM images UNION SELECT object_key FROM image_variants
      ON CONFLICT DO NOTHING
    `
    if (names.length > 0) {
      const quoted = names.map((name) => `"${name.replaceAll(`"`, `""`)}"`)
      await tx.unsafe(`TRUNCATE ${quoted.join(`, `)} CASCADE`)
    }
    return names
  })
}
