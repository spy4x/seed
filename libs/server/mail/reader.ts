/**
 * Who reads a mail (#277): the language, region format, zone and clock a mail to an account is
 * written in, from what the person saved and what their first device reported.
 *
 * @module
 */

import { negotiateLanguage } from "@spy4x/platform/universal/i18n"
import { REGION_FORMAT_LOCALES } from "@spy4x/time/locale"
import { canonicalValidTimeZoneOrNull } from "@spy4x/time/tz"
import type { Sql } from "@spy4x/server/db"
import { isLanguage, LANGUAGES, preferencesDefinition } from "@domain/identity"
import type { MailReader } from "./mail.ts"

/** What is known of a reader: their saved preferences, their first device, and the request. */
export interface MailReaderSource {
  /** The stored preferences record, `null` when nothing was saved. Checked before use. */
  preferences: { version: number; value: unknown } | null
  /** The region format the first device reported (`user_preferences.first_locale`). */
  firstLocale: string | null
  /** The zone the first device reported (`user_preferences.first_time_zone`). */
  firstTimeZone: string | null
  /** The language of the page that asked for the mail, when one did. Checked before use. */
  requested?: unknown
}

/**
 * The reader of a mail. The language is the saved one, else the language of the page that asked
 * for the mail, else the one the first device's region format speaks, else English. The region
 * format is the saved one, else the first device's, else the language's own. The zone is the
 * saved one, else the first device's, else unknown. A value outside what the apps offer is
 * skipped as if it were not saved.
 */
export function mailReader(source: MailReaderSource): MailReader {
  const saved = preferencesDefinition.resolve(source.preferences).value
  const firstLocale = source.firstLocale && REGION_FORMAT_LOCALES.includes(source.firstLocale)
    ? source.firstLocale
    : null
  const language = saved.language ??
    (isLanguage(source.requested) ? source.requested : null) ??
    (firstLocale ? negotiateLanguage(firstLocale, LANGUAGES, `en`) : `en`)
  return {
    language,
    locale: saved.locale ?? firstLocale ?? language,
    timeZone: canonicalValidTimeZoneOrNull(saved.timeZone ?? ``) ??
      canonicalValidTimeZoneOrNull(source.firstTimeZone ?? ``),
    hourCycle: saved.hourCycle,
  }
}

/** The reader of a mail sent before any account is known: the asking page's language, in UTC. */
export function requestReader(requested: unknown): MailReader {
  return mailReader({ preferences: null, firstLocale: null, firstTimeZone: null, requested })
}

interface ReaderRow {
  value: unknown
  version: number
  firstLocale: string | null
  firstTimeZone: string | null
}

/** The reader of a mail to account `userId`; see {@link mailReader}. */
export async function readMailReader(
  sql: Sql,
  userId: number,
  requested?: unknown,
): Promise<MailReader> {
  const [row] = await sql<ReaderRow[]>`
    SELECT value, version, first_locale AS "firstLocale", first_time_zone AS "firstTimeZone"
    FROM user_preferences WHERE user_id = ${userId}
  `
  return mailReader({
    // Version 0 is the row recordFirstDevice writes before anything is saved.
    preferences: row && row.version > 0 ? { version: row.version, value: row.value } : null,
    firstLocale: row?.firstLocale ?? null,
    firstTimeZone: row?.firstTimeZone ?? null,
    requested,
  })
}
