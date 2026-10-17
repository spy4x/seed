/**
 * A person's display preferences (#163) in Postgres: the `user_preferences` row behind the
 * `SettingsStore` port of `@spy4x/platform/universal/settings`. Every function takes the person's
 * id from the caller, which takes it from the session; nothing here reads a request.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import type { SettingsStore, StoredSettings } from "@spy4x/platform/universal/settings"
import {
  type AdminUserPreferences,
  preferencesDefinition,
  type PreferencesDevice,
} from "@domain/identity"
import { REGION_FORMAT_LOCALES } from "@spy4x/time/locale"
import { canonicalValidTimeZoneOrNull } from "@spy4x/time/tz"

interface PreferencesRow extends postgres.Row {
  value: unknown
  version: number
  updatedAt: Date | null
  firstTimeZone: string | null
}

/** The stored record of `userId`, or `null` when nothing was ever stored for them. */
export async function readPreferences(
  sql: postgres.Sql,
  userId: number,
): Promise<StoredSettings | null> {
  const [row] = await sql<PreferencesRow[]>`
    SELECT value, version FROM user_preferences WHERE user_id = ${userId}
  `
  return row ? { version: row.version, value: row.value } : null
}

/**
 * Stores `next` only while the stored version is still `expectedVersion`, in one statement, and
 * answers whether it did. Version `0` is "never saved": the row may be missing, or exist with only
 * the first device's zone ({@link recordFirstDevice}).
 */
export async function writePreferences(
  sql: postgres.Sql,
  userId: number,
  expectedVersion: number,
  next: { version: number; value: unknown },
): Promise<boolean> {
  const value = sql.json(next.value as postgres.JSONValue)
  const rows = expectedVersion === 0
    ? await sql`
      INSERT INTO user_preferences (user_id, value, version, updated_at)
      VALUES (${userId}, ${value}, ${next.version}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE
        SET value = EXCLUDED.value, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at
        WHERE user_preferences.version = 0
      RETURNING user_id
    `
    : await sql`
      UPDATE user_preferences
      SET value = ${value}, version = ${next.version}, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ${userId} AND version = ${expectedVersion}
      RETURNING user_id
    `
  return rows.length === 1
}

/** The settings store of the API: one person's row, by the id the handler passes. */
export function preferencesStore(sql: postgres.Sql): SettingsStore {
  return {
    read: (userId) => readPreferences(sql, Number(userId)),
    write: (userId, expected, next) => writePreferences(sql, Number(userId), expected, next),
  }
}

/**
 * Keeps the zone and region format of the first device that reports them, which operators see on
 * the person's account. A later device changes nothing, so this is the zone the person signed up
 * in. A zone this runtime does not know, or a format outside the
 * picker's list, is kept as `NULL`.
 */
export async function recordFirstDevice(
  sql: postgres.Sql,
  userId: number,
  device: PreferencesDevice,
): Promise<void> {
  const timeZone = canonicalValidTimeZoneOrNull(device.timeZone)
  const locale = REGION_FORMAT_LOCALES.includes(device.locale) ? device.locale : null
  await sql`
    INSERT INTO user_preferences (user_id, first_time_zone, first_locale)
    VALUES (${userId}, ${timeZone}, ${locale})
    ON CONFLICT (user_id) DO UPDATE
      SET first_time_zone = COALESCE(user_preferences.first_time_zone, EXCLUDED.first_time_zone),
        first_locale = COALESCE(user_preferences.first_locale, EXCLUDED.first_locale)
      WHERE user_preferences.first_time_zone IS NULL OR user_preferences.first_locale IS NULL
  `
}

/** What the operator area shows of `userId`'s preferences: the record, resolved, read-only. */
export async function readAdminPreferences(
  sql: postgres.Sql,
  userId: number,
): Promise<AdminUserPreferences> {
  const [row] = await sql<PreferencesRow[]>`
    SELECT value, version, updated_at, first_time_zone FROM user_preferences
    WHERE user_id = ${userId}
  `
  const resolved = preferencesDefinition.resolve(
    row ? { version: row.version, value: row.value } : null,
  )
  return {
    value: resolved.value,
    version: resolved.version,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    firstTimeZone: row?.firstTimeZone ?? null,
  }
}
