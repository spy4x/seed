/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { insertUser, withSchema } from "./group-team.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * A group's time zone against a real Postgres built from schema.sql: a new group takes its
 * creator's zone, a zone change writes its own audit row, and the migration gives every existing
 * group its owner's zone. Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in
 * docs/handoff.md); it fails when they are missing.
 */

const MIGRATION = "2026_12_14_0003_group_time_zone.sql"

async function prefer(
  sql: postgres.Sql,
  userId: number,
  saved: string | null,
  first: string | null,
): Promise<void> {
  const value = saved === null ? {} : { timeZone: saved }
  await sql`
    INSERT INTO user_preferences (user_id, value, first_time_zone)
    VALUES (${userId}, ${sql.json(value)}, ${first})
  `
}

async function zoneOf(sql: postgres.Sql, groupId: string): Promise<string | null> {
  return (await sql<{ timeZone: string | null }[]>`
    SELECT time_zone FROM groups WHERE id = ${groupId}
  `)[0].timeZone
}

Deno.test("time zone: a new group takes its creator's saved zone, then the first one, then UTC", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const saved = await insertUser(sql)
    const firstOnly = await insertUser(sql)
    const unknownSaved = await insertUser(sql)
    const nothing = await insertUser(sql)
    await prefer(sql, saved, "Asia/Tokyo", "Europe/Berlin")
    await prefer(sql, firstOnly, null, "Europe/Berlin")
    await prefer(sql, unknownSaved, "Mars/Olympus", "America/New_York")

    const zones = []
    for (const user of [saved, firstOnly, unknownSaved, nothing]) {
      zones.push((await repository.create({ id: uuidV7(), name: "Home" }, user)).group.timeZone)
    }
    const picked = await repository.create(
      { id: uuidV7(), name: "Trip", timeZone: "Asia/Bangkok" },
      saved,
    )

    expect(zones).toEqual(["Asia/Tokyo", "Europe/Berlin", "America/New_York", "UTC"])
    expect(picked.group.timeZone).toBe("Asia/Bangkok")
    expect(await zoneOf(sql, picked.group.id)).toBe("Asia/Bangkok")
  })
})

Deno.test("time zone: a zone change writes its own activity row with both zones", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    const { group } = await repository.create({ id: uuidV7(), name: "Home" }, owner)
    const details = { description: "", color: null, emoji: null }

    await repository.updateDetails(group.id, { ...details, timeZone: "Europe/Berlin" }, owner)
    await repository.updateDetails(group.id, { ...details, description: "Ours" }, owner)

    const rows = await sql<{ eventKind: string; details: Record<string, unknown> }[]>`
      SELECT event_kind, details FROM audit_events
      WHERE group_id = ${group.id} AND event_kind LIKE 'group.%' AND event_kind <> 'group.created'
      ORDER BY id
    `
    expect(rows).toEqual([
      { eventKind: "group.time_zone_changed", details: { from: "UTC", to: "Europe/Berlin" } },
      { eventKind: "group.details_updated", details: {} },
    ])
    expect(await zoneOf(sql, group.id)).toBe("Europe/Berlin")
  })
})

Deno.test("time zone: the migration gives every group its owner's zone, and runs twice", async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owners = [await insertUser(sql), await insertUser(sql), await insertUser(sql)]
    const ids = []
    for (const owner of owners) {
      ids.push((await repository.create({ id: uuidV7(), name: "Home" }, owner)).group.id)
    }
    // As before the migration: no column value, and preferences saved later.
    await sql`ALTER TABLE groups ALTER COLUMN time_zone DROP NOT NULL`
    await sql`ALTER TABLE groups ALTER COLUMN time_zone DROP DEFAULT`
    await sql`UPDATE groups SET time_zone = NULL`
    await prefer(sql, owners[0], "Asia/Tokyo", "Europe/Berlin")
    await prefer(sql, owners[1], "Mars/Olympus", "Europe/Berlin")

    await applyMigrations(sql, [MIGRATION, MIGRATION])

    const zones = []
    for (const id of ids) zones.push(await zoneOf(sql, id))
    expect(zones).toEqual(["Asia/Tokyo", "Europe/Berlin", "UTC"])
    const column = await sql<{ isNullable: string; columnDefault: string }[]>`
      SELECT is_nullable, column_default FROM information_schema.columns
      WHERE table_name = 'groups' AND column_name = 'time_zone'
    `
    expect(column[0].isNullable).toBe("NO")
    expect(column[0].columnDefault).toContain("UTC")
  })
})
