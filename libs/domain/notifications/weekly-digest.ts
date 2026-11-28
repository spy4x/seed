import { type } from "arktype"
import { isValidTimeZone } from "@spy4x/time/tz"

/**
 * The opt-in weekly digest e-mail (docs/weekly-digest.md): off, the default, or on at a weekday
 * and hour of the person's wall clock in an IANA time zone.
 *
 * @module
 */

/** The longest zone name the column keeps (`weekly_digests.time_zone`). */
export const WEEKLY_DIGEST_ZONE_MAX_LENGTH = 64

/** The most groups one digest lists; the rest are counted as "and N more". */
export const WEEKLY_DIGEST_MAX_GROUPS = 20

/** The longest unsubscribe token the API reads: a user id, a dot and a 43-character signature. */
export const WEEKLY_DIGEST_TOKEN_MAX_LENGTH = 64

/**
 * A digest setting as `weekly-digest.save` takes it: `{ on: false }`, or `{ on: true, weekday,
 * hour, timeZone }` with the ISO weekday (Monday = 1), the hour 0 to 23 and a zone this runtime's
 * tzdata knows. Any other key is refused.
 */
export const weeklyDigestSettingSchema = type({
  "+": `reject`,
  on: `false`,
}).or({
  "+": `reject`,
  on: `true`,
  weekday: `1 <= number.integer <= 7`,
  hour: `0 <= number.integer <= 23`,
  timeZone: type(`string <= ${WEEKLY_DIGEST_ZONE_MAX_LENGTH}`).narrow((value, context) =>
    isValidTimeZone(value) || context.mustBe(`a time zone from the list`)
  ),
})

/** A digest setting; see {@link weeklyDigestSettingSchema}. */
export type WeeklyDigestSetting = typeof weeklyDigestSettingSchema.infer

/** A digest setting as `weekly-digest.get` answers it: when on, also when the next one goes. */
export type WeeklyDigestState =
  | { on: false }
  | { on: true; weekday: number; hour: number; timeZone: string; nextAt: string }
