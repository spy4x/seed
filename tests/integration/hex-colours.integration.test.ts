/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { LEGACY_COLORS } from "@domain/groups"
import { applyMigrations, migrationNames } from "./migrations.ts"

/**
 * The migration that turns the tags' and groups' palette names into hex colours (#329), on a
 * database that holds rows written before it. Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME`
 * (recipe in docs/handoff.md); it fails when they are missing rather than skipping.
 */

const HEX_MIGRATION = "2026_11_27_0001_hex_colours.sql"

Deno.test("the hex colour migration turns every palette name into the hex an import reads it as", async () => {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `hex_colours_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 1,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = migrationNames()
    const at = names.indexOf(HEX_MIGRATION)
    expect(at).toBeGreaterThan(0)
    await applyMigrations(sql, names.slice(0, at))

    const [{ id: owner }] = await sql<{ id: number }[]>`
      WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
      INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
    `
    const palette = Object.keys(LEGACY_COLORS)
    const groupIds: string[] = []
    for (const color of [...palette, null]) {
      const id = uuidV7()
      groupIds.push(id)
      await sql`
        INSERT INTO groups (id, name, owner_user_id, color)
        VALUES (${id}, ${`Group ${color}`}, ${owner}, ${color})
      `
    }
    for (const color of palette) {
      await sql`
        INSERT INTO tags (id, group_id, name, color, change_sequence)
        VALUES (${uuidV7()}, ${groupIds[0]}, ${color}, ${color}, 1)
      `
    }

    await applyMigrations(sql, names.slice(at))

    // An import reads a version 1 file's colour names through the same table.
    const expected = LEGACY_COLORS
    const tags = await sql<{ name: string; color: string }[]>`SELECT name, color FROM tags`
    expect(Object.fromEntries(tags.map((tag) => [tag.name, tag.color]))).toEqual(expected)
    const groups = await sql<{ name: string; color: string | null }[]>`
      SELECT name, color FROM groups
    `
    expect(Object.fromEntries(groups.map((group) => [group.name, group.color]))).toEqual({
      ...Object.fromEntries(Object.entries(expected).map(([name, hex]) => [`Group ${name}`, hex])),
      "Group null": null,
    })
    const [{ color: fresh }] = await sql<{ color: string }[]>`
      INSERT INTO tags (id, group_id, name, change_sequence)
      VALUES (${uuidV7()}, ${groupIds[0]}, 'New', 1)
      RETURNING color
    `
    expect(fresh).toBe("#4b5563")
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
})
