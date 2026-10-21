/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { saveSettings } from "@spy4x/platform/universal/settings"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { DEFAULT_PREFERENCES, type Preferences, preferencesDefinition } from "@domain/identity"
import {
  preferencesStore,
  readAdminPreferences,
  recordFirstDevice,
} from "@server/auth/preferences.ts"

/**
 * A person's display preferences against a real Postgres built from schema.sql. Needs `DB_HOST`,
 * `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1, onnotice: () => {} })
  const schema = `preferences_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...connection,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile("libs/server/db/schema.sql"))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function insertUser(sql: postgres.Sql): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `
  return row.id
}

const berlin: Preferences = {
  theme: `dark`,
  locale: `de-DE`,
  timeZone: `Europe/Berlin`,
  hourCycle: `h23`,
  overview: [],
}

Deno.test(`preferences: a save writes the next version, and one on an older version is refused`, async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)
    const store = preferencesStore(sql)

    const first = await saveSettings(preferencesDefinition, store, String(userId), {
      version: 0,
      value: berlin,
    })
    expect(first).toEqual({ ok: true, settings: { version: 1, value: berlin } })

    const stale = await saveSettings(preferencesDefinition, store, String(userId), {
      version: 0,
      value: { ...berlin, theme: `light` },
    })
    expect(stale).toEqual({ ok: false, reason: `conflict`, current: { version: 1, value: berlin } })

    // Past the first save, the same holds: a save on version 1 after version 2 landed is refused.
    const light = { ...berlin, theme: `light` as const }
    const second = await saveSettings(preferencesDefinition, store, String(userId), {
      version: 1,
      value: light,
    })
    expect(second).toEqual({ ok: true, settings: { version: 2, value: light } })
    const staleAgain = await saveSettings(preferencesDefinition, store, String(userId), {
      version: 1,
      value: berlin,
    })
    expect(staleAgain).toEqual({
      ok: false,
      reason: `conflict`,
      current: { version: 2, value: light },
    })
    expect(await store.read(String(userId))).toEqual({ version: 2, value: light })
  })
})

Deno.test(`preferences: of two saves on the same version at once, exactly one lands`, async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)
    const store = preferencesStore(sql)

    const [a, b] = await Promise.all([
      store.write(String(userId), 0, { version: 1, value: berlin }),
      store.write(String(userId), 0, { version: 1, value: { ...berlin, theme: `light` } }),
    ])

    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect((await store.read(String(userId)))?.version).toBe(1)

    // The same on an existing row: two writes that both read version 1.
    const [c, d] = await Promise.all([
      store.write(String(userId), 1, { version: 2, value: berlin }),
      store.write(String(userId), 1, { version: 2, value: { ...berlin, theme: `system` } }),
    ])
    expect([c, d].filter(Boolean)).toHaveLength(1)
    // A write on a version already passed changes nothing.
    expect(await store.write(String(userId), 1, { version: 2, value: DEFAULT_PREFERENCES }))
      .toBe(false)
  })
})

Deno.test(`preferences: one person's save never changes another person's row`, async () => {
  await withSchema(async (sql) => {
    const ann = await insertUser(sql)
    const bob = await insertUser(sql)
    const store = preferencesStore(sql)

    await saveSettings(preferencesDefinition, store, String(ann), { version: 0, value: berlin })
    expect(await store.read(String(bob))).toBeNull()

    // Both now hold version 1; Ann's next save changes her row only.
    await saveSettings(preferencesDefinition, store, String(bob), { version: 0, value: berlin })
    await saveSettings(preferencesDefinition, store, String(ann), {
      version: 1,
      value: { ...berlin, theme: `light` },
    })
    expect(await store.read(String(bob))).toEqual({ version: 1, value: berlin })
  })
})

Deno.test(`preferences: the first device is kept, a later one changes nothing`, async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)

    await recordFirstDevice(sql, userId, { timeZone: `Asia/Bangkok`, locale: `th-TH` })
    await recordFirstDevice(sql, userId, { timeZone: `Europe/Berlin`, locale: `de-DE` })

    const shown = await readAdminPreferences(sql, userId)
    expect(shown).toEqual({
      value: DEFAULT_PREFERENCES,
      version: 0,
      updatedAt: null,
      firstTimeZone: `Asia/Bangkok`,
    })
    // The row the device made is still "never saved", so the first save on version 0 lands.
    const saved = await saveSettings(preferencesDefinition, preferencesStore(sql), String(userId), {
      version: 0,
      value: berlin,
    })
    expect(saved.ok).toBe(true)
  })
})

Deno.test(`preferences: an unknown zone from a device is kept as nothing`, async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)

    await recordFirstDevice(sql, userId, { timeZone: `Mars/Olympus_Mons`, locale: `xx-YY` })

    expect((await readAdminPreferences(sql, userId)).firstTimeZone).toBeNull()
  })
})

Deno.test(`preferences: the row goes with the account`, async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)
    await saveSettings(preferencesDefinition, preferencesStore(sql), String(userId), {
      version: 0,
      value: berlin,
    })

    await sql`DELETE FROM auth_users WHERE id = ${userId}`

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM user_preferences WHERE user_id = ${userId}
    `
    expect(count).toBe(0)
  })
})
