/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { PictureState } from "@domain/identity"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * The migration that adds processed images and `users.picture_state` (#464), on a database that
 * already holds a profile picture: the picture kept before it must count as ready, or the
 * migration's own check constraint refuses the row. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and
 * `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const IMAGES_MIGRATION = `2026_12_06_0002_images.sql`

Deno.test(`a picture kept before the images migration becomes ready, and a person without one keeps none`, async () => {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `images_migration_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 1,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = migrationNames()
    const at = names.indexOf(IMAGES_MIGRATION)
    expect(at).toBeGreaterThan(0)
    await applyMigrations(sql, names.slice(0, at))

    // Each `users` row shares its id with an `auth_users` row, which makes the id.
    const [withPicture] = await sql<{ id: number }[]>`
      WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
      INSERT INTO users (id, first_name, picture_id, picture_type)
      SELECT id, 'Ada', ${uuidV7()}, 'image/webp' FROM auth_user RETURNING id
    `
    const [without] = await sql<{ id: number }[]>`
      WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
      INSERT INTO users (id, first_name) SELECT id, 'Grace' FROM auth_user RETURNING id
    `

    await applyMigrations(sql, names.slice(at))

    const states = await sql<{ id: number; picture_state: number | null }[]>`
      SELECT id, picture_state FROM users ORDER BY id
    `
    expect(states).toEqual([
      { id: withPicture.id, picture_state: PictureState.Ready },
      { id: without.id, picture_state: null },
    ])
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
