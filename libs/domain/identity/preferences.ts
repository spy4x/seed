import { type } from "arktype"
import { defineSettings, type VersionedSettings } from "@spy4x/platform/universal/settings"
import { REGION_FORMAT_LOCALES } from "@spy4x/time/locale"
import { isValidTimeZone } from "@spy4x/time/tz"

/**
 * A person's display preferences (#163): one record per person, kept on the server with a version,
 * so every device shows the same theme, language, region format, time zone and clock.
 *
 * `null` means "automatic": each device uses its own region format or zone. A zone or format the
 * person picks is stored and follows them everywhere.
 *
 * @module
 */

/** The longest zone name the runtime knows is about 30 characters; anything past this is junk. */
const NAME_MAX_LENGTH = 64

/** A time zone this runtime's tzdata knows, such as `Europe/Berlin`. */
const timeZoneSchema = type(`string <= ${NAME_MAX_LENGTH}`).narrow((value, context) =>
  isValidTimeZone(value) || context.mustBe(`a time zone from the list`)
)

/** A region format from the picker's list, such as `de-DE`. */
const localeSchema = type.enumerated(...REGION_FORMAT_LOCALES)

/**
 * The interface languages the apps ship (#216), English first. `language` in the preferences is
 * one of these or `null`; a catalog import is picked only by a member of this list.
 */
export const LANGUAGES = [`en`, `ru`, `es`, `de`, `pt-BR`, `ar`] as const

/** An interface language the apps ship. */
export type Language = typeof LANGUAGES[number]

/**
 * The product's main language: the public website serves it without a prefix, and a blog post is
 * written in it unless the operator picks another. A product whose main language is not English
 * changes it here.
 */
export const DEFAULT_LANGUAGE: Language = `en`

/**
 * The public website's address of the page at `path` in `language`, as the website serves it:
 * `/blog/hello` in the main language, `/de/blog/hello` in German. Not for the home page, `/`; an
 * empty `path` gives the language's prefix alone.
 */
export function sitePath(language: Language, path: string): string {
  return language === DEFAULT_LANGUAGE ? path : `/${language}${path}`
}

/** True for a member of {@link LANGUAGES}, compared exactly. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === `string` && (LANGUAGES as readonly string[]).includes(value)
}

/** The most entries a group overview layout keeps: far more widgets than any product has. */
export const OVERVIEW_LAYOUT_MAX_ENTRIES = 32

/**
 * The group overview's layout (#219): widget ids in the person's order, each with whether the
 * person hid it. Ids only, never what a widget shows. Ids the app no longer has are dropped when
 * the page reads it (`mergeLayout`), so an old record still reads.
 */
const overviewLayoutSchema = type({ id: `string <= ${NAME_MAX_LENGTH}`, hidden: `boolean` })
  .array()
  .atMostLength(OVERVIEW_LAYOUT_MAX_ENTRIES)

/** The record's shape. Every key has a default, so a record saved before a key existed reads. */
export const preferencesSchema = type({
  theme: `'system' | 'light' | 'dark'`,
  /** The interface language; `null` follows each device (#216). */
  language: type.enumerated(...LANGUAGES).or(`null`),
  locale: localeSchema.or(`null`),
  timeZone: timeZoneSchema.or(`null`),
  hourCycle: `'h12' | 'h23' | null`,
  overview: overviewLayoutSchema,
})

export type Preferences = typeof preferencesSchema.infer

/** The theme preference: `system` follows each device's light or dark setting. */
export type ThemePreference = Preferences["theme"]

/** What a person has before their first save: the system theme, everything else automatic. */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: `system`,
  language: null,
  locale: null,
  timeZone: null,
  hourCycle: null,
  overview: [],
}

/**
 * The largest value the server stores, in bytes of JSON. The display keys need about 100, and an
 * overview layout of 32 widgets with ids of about 30 characters about 1,800 (the widget ids of
 * today are 11 to 15 characters), so the row cannot be used as free storage.
 */
export const PREFERENCES_MAX_BYTES = 2048

/** The checks the server and the SPA share: the schema, the defaults, the cap and the version. */
export const preferencesDefinition = defineSettings<Preferences>(preferencesSchema, {
  defaults: DEFAULT_PREFERENCES,
  maxBytes: PREFERENCES_MAX_BYTES,
})

/** A record as the server answers it: the value and the version it was saved as. */
export type VersionedPreferences = VersionedSettings<Preferences>

/** What the operator area shows of a person's preferences (read-only). */
export interface AdminUserPreferences {
  /** The stored record, resolved: defaults where nothing was saved. */
  value: Preferences
  /** `0` while the person never saved. */
  version: number
  /** When the person last saved, or `null` when they never did. */
  updatedAt: string | null
  /** The zone of the first device the person used: the one they signed up with. */
  firstTimeZone: string | null
  /** The region format of that first device, from the picker's list; `null` when unknown. */
  firstLocale: string | null
}

/** The body of `preferences.device`: the zone and region format of the device that is open. */
export const preferencesDeviceSchema = type({
  timeZone: `string <= ${NAME_MAX_LENGTH}`,
  locale: `string <= ${NAME_MAX_LENGTH}`,
})

export type PreferencesDevice = typeof preferencesDeviceSchema.infer
