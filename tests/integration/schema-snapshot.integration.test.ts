/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * `schema.sql` against the migrations. Most integration tests build their database from
 * `schema.sql`, while production applies the migrations, so the two must describe the same schema.
 * The migrations come from the folder, never from a list, so a new migration that nobody copied
 * into `schema.sql` fails this test. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME`; it fails
 * when they are missing rather than skipping.
 */

const SNAPSHOT = "libs/server/db/schema.sql"

/**
 * Tables left out of the comparison. `schema.sql` keeps a `migrations` history table, which the
 * migration runner owns and no migration creates.
 */
const NOT_COMPARED = ["migrations"]

interface MetadataRow extends postgres.Row {
  value: string
}

/** Runs `body` with two fresh schemas, and drops both after. */
async function withSchemas(
  body: (migrated: postgres.Sql, snapshot: postgres.Sql) => Promise<void>,
): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const id = uuidV7().replaceAll("-", "")
  const schemas = [`snapshot_migrated_${id}`, `snapshot_file_${id}`]
  const [migrated, snapshot] = schemas.map((schema) =>
    postgres({
      ...connection,
      max: 1,
      connection: { options: `-c search_path=${schema}` },
      onnotice: () => {},
    })
  )
  try {
    for (const schema of schemas) await admin`CREATE SCHEMA ${admin(schema)}`
    await body(migrated, snapshot)
  } finally {
    await migrated.end({ timeout: 5 })
    await snapshot.end({ timeout: 5 })
    for (const schema of schemas) await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

Deno.test("schema.sql describes the same schema as every migration in the folder", async () => {
  await withSchemas(async (migrated, snapshot) => {
    await applyMigrations(migrated)
    await snapshot.unsafe(await Deno.readTextFile(SNAPSHOT))
    expect(await schemaMetadata(migrated)).toEqual(await schemaMetadata(snapshot))
  })
})

Deno.test("the comparison sees a column or an index that schema.sql lacks, on any table", async () => {
  await withSchemas(async (migrated, snapshot) => {
    await applyMigrations(migrated)
    // A table the comparison used to skip, and an index left out of schema.sql.
    await migrated`ALTER TABLE notifications ADD COLUMN extra text`
    await migrated`CREATE INDEX auth_audits_extra_idx ON auth_audits (created_at)`
    await snapshot.unsafe(await Deno.readTextFile(SNAPSHOT))

    const migratedRows = await schemaMetadata(migrated)
    const snapshotRows = new Set(await schemaMetadata(snapshot))
    const onlyMigrated = migratedRows.filter((row) => !snapshotRows.has(row))
    expect(onlyMigrated).toEqual([
      expect.stringMatching(/^column\|notifications\|\d+\|extra\|/),
      expect.stringMatching(/^index\|auth_audits\|auth_audits_extra_idx\|/),
    ])
  })
})

/**
 * Every table's columns, constraints, indexes and triggers, and every function, of the schema
 * `sql` searches, as sorted lines. A column is numbered by its position among the table's live
 * columns, not by `ordinal_position`: a dropped column leaves a gap there, which a fresh
 * `schema.sql` does not have.
 */
async function schemaMetadata(sql: postgres.Sql): Promise<string[]> {
  const [{ schema }] = await sql<{ schema: string }[]>`SELECT current_schema() AS schema`
  const rows = await sql<MetadataRow[]>`
    SELECT value
    FROM (
      SELECT
        'column|' || table_name || '|' ||
        ROW_NUMBER() OVER (PARTITION BY table_name ORDER BY ordinal_position) || '|' ||
        column_name || '|' ||
        data_type || '|' || COALESCE(character_maximum_length::text, '') || '|' ||
        COALESCE(datetime_precision::text, '') || '|' || is_nullable || '|' ||
        COALESCE(column_default, '') AS value
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name NOT IN ${sql(NOT_COMPARED)}

      UNION ALL

      SELECT
        'constraint|' || tables.relname || '|' || constraints.conname || '|' ||
        pg_get_constraintdef(constraints.oid) AS value
      FROM pg_constraint constraints
      INNER JOIN pg_class tables ON tables.oid = constraints.conrelid
      INNER JOIN pg_namespace namespaces ON namespaces.oid = tables.relnamespace
      WHERE namespaces.nspname = ${schema}
        AND tables.relname NOT IN ${sql(NOT_COMPARED)}

      UNION ALL

      SELECT
        'index|' || tablename || '|' || indexname || '|' ||
        replace(indexdef, ${schema}, '<schema>') AS value
      FROM pg_indexes
      WHERE schemaname = ${schema}
        AND tablename NOT IN ${sql(NOT_COMPARED)}

      UNION ALL

      SELECT
        'trigger|' || tables.relname || '|' || triggers.tgname || '|' ||
        replace(pg_get_triggerdef(triggers.oid), ${schema}, '<schema>') AS value
      FROM pg_trigger triggers
      INNER JOIN pg_class tables ON tables.oid = triggers.tgrelid
      INNER JOIN pg_namespace namespaces ON namespaces.oid = tables.relnamespace
      WHERE namespaces.nspname = ${schema}
        AND tables.relname NOT IN ${sql(NOT_COMPARED)}
        AND NOT triggers.tgisinternal

      UNION ALL

      SELECT
        'function|' || procedures.proname || '|' ||
        replace(pg_get_functiondef(procedures.oid), ${schema}, '<schema>') AS value
      FROM pg_proc procedures
      INNER JOIN pg_namespace namespaces ON namespaces.oid = procedures.pronamespace
      WHERE namespaces.nspname = ${schema}
        AND procedures.prokind = 'f'
    ) metadata
    ORDER BY value
  `
  return rows.map((row: MetadataRow) => row.value)
}
