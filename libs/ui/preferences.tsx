import type { JSX } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Combobox } from "@spy4x/preact-ui/combobox"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { RadioChips } from "@spy4x/preact-ui/radio-chips"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { createFormatters, regionHourCycle } from "@spy4x/time/format"
import { type LocaleOption, localeOptions } from "@spy4x/time/locale"
import { timeZoneOptions, zoneCity, zoneLabel, zoneOffsetLabel } from "@spy4x/time/tz"
import type { AdminUserPreferences, Preferences, ThemePreference } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { Rich } from "@spy4x/preact-ui/i18n"
import { LanguageDialog, languageName } from "@spy4x/preact-ui/language-picker"
import type { AccountMenuLanguage } from "@spy4x/preact-system/account-menu"
import { textDirection } from "@spy4x/platform/universal/i18n"
import { useAdminText, useAppText } from "./i18n.ts"

/** The fields "Language and region" edits; the theme is under Appearance. */
export type RegionPreferences = Pick<Preferences, "locale" | "timeZone" | "hourCycle">

/** A device's own region format and zone: what "Automatic" resolves to. */
export interface DeviceRegion {
  locale: string
  timeZone: string
}

export interface PreferencesProps {
  /** The person's preferences, with any change still on its way. */
  value: Preferences
  /** This device's region format and zone. */
  device: DeviceRegion
  /** What "System" paints on this device now. */
  systemTheme: "light" | "dark"
  /** This device's zone when the person chose another and has not kept theirs; else `null`. */
  otherZone: string | null
  /**
   * The record that won when this device's save was refused: another device saved first. The form
   * then shows its values and says why.
   */
  conflict: { version: number; value: Preferences } | null
  /** The version of {@link value}: a change is saved on the version it was made on. */
  version: number
  /** A save is on its way. */
  pending: boolean
  /** Why the last save failed, shown under the form in the person's language; `null` when it did not. */
  error: PreferencesFailure | null
  /**
   * Not empty when another device changed what is on screen: a screen reader then hears so, in the
   * person's language.
   */
  announcement: string
  /** The moment the examples and the zones' offsets are read at. */
  now: Date
  /**
   * The interface language: what is chosen, what loads, and the switch. Left out, the section has
   * no Language row.
   */
  language?: AccountMenuLanguage
  onTheme(theme: ThemePreference): void
  /**
   * Save the region values on `baseVersion`, the version they were made on, so a change another
   * device saved meanwhile is refused instead of overwritten.
   */
  onSave(next: RegionPreferences, baseVersion: number): void
  /** "Use Tokyo time": this device's zone becomes the person's zone. */
  onUseDeviceZone(): void
  /** "Keep Berlin time": stop offering this device's zone. */
  onKeepZone(): void
}

/** Why a save did not go through: each has its message under the form. */
export type PreferencesFailure = `network` | `offline` | `invalid`

/** The message of each failure, by its key in the `app` catalog. */
const FAILURE_KEYS: Record<PreferencesFailure, string> = {
  network: `Preferences.failedNetwork`,
  offline: `Preferences.failedOffline`,
  invalid: `Preferences.failedInvalid`,
}

/** Each theme in one word, by its key in the `app` catalog. */
const THEME_KEYS: Record<ThemePreference, string> = {
  system: `Preferences.themeSystem`,
  light: `Preferences.themeLight`,
  dark: `Preferences.themeDark`,
}

/** A theme in one word, in the person's language, as the profile's list of sections shows it. */
export function themeName(t: Translator<string>, theme: ThemePreference): string {
  return t.t(THEME_KEYS[theme])
}

const THEMES: readonly ThemePreference[] = [`system`, `light`, `dark`]

/** Every region format, named in a language; each list built once, on first use. */
const regionOptions = new Map<string, LocaleOption[]>()
function regions(language: string): LocaleOption[] {
  let options = regionOptions.get(language)
  if (!options) {
    options = localeOptions(language)
    regionOptions.set(language, options)
  }
  return options
}

/**
 * A region format's name in `language` (English by default), `German (Germany)`, or the tag when
 * the list lacks it.
 */
export function regionName(locale: string, language = `en`): string {
  return regions(language).find((option) => option.value === locale)?.name ?? locale
}

/** A clock as a person reads it. */
function clockLabel(t: Translator<string>, cycle: "h12" | "h23"): string {
  return t.t(cycle === `h12` ? `Preferences.clock12` : `Preferences.clock24`)
}

/** A theme as its choice reads: `System (dark on this device)`, `Light` or `Dark`. */
export function themeValue(
  t: Translator<string>,
  theme: ThemePreference,
  system: "light" | "dark",
): string {
  if (theme !== `system`) return themeName(t, theme)
  return t.t(system === `light` ? `Preferences.themeSystemLight` : `Preferences.themeSystemDark`)
}

interface RegionItem {
  /** The tag to store, or `null` for Automatic. */
  value: string | null
  label: string
  searchText: string
}

interface ZoneItem {
  /** The zone to store, or `null` for Automatic. */
  value: string | null
  label: string
  searchText: string
}

/** The clock's choices: the region format's own, or one the person picked. */
const CLOCKS = [`format`, `h12`, `h23`] as const

/**
 * The profile's "Language and region" section (#163): the region format, the time zone and the
 * clock, which follow the person to every device. One form, with no Save button: each change is
 * saved as it is made, on the version it was made on, so a change another device saved meanwhile
 * is refused and the form then shows the values that won. A line above the form shows a date and
 * time in the person's settings, and a person whose device is in another zone is offered it.
 */
export function RegionSection(props: PreferencesProps): JSX.Element {
  const { value, version, device, conflict, otherZone, error, now, onSave } = props
  const format = useFormat()
  const t = useAppText()
  const language = t.language
  const form = useRef<HTMLDivElement>(null)
  const notice = useRef<HTMLDivElement>(null)
  // A refused save shows the values that won; the next change is made on them.
  const shown = pick(conflict?.value ?? value)
  const base = conflict?.version ?? version
  const save = (patch: Partial<RegionPreferences>) => onSave({ ...shown, ...patch }, base)
  // "Use" and "Keep" remove themselves; the focus goes on to the next control, the clock, not
  // to the page. The zone's field would open its list on focus and cover the clock.
  const focusNext = () =>
    form.current?.querySelector<HTMLElement>(`input[name="hourCycle"]:checked`)?.focus()

  useEffect(() => {
    if (conflict) notice.current?.focus()
  }, [conflict])

  const regionItems = useMemo<RegionItem[]>(() => [
    {
      value: null,
      label: t.t(`Preferences.automatic`, { value: regionName(device.locale, language) }),
      searchText: `${t.t(`Preferences.automaticSearch`)} automatic device ${
        regionName(device.locale, language)
      }`.toLowerCase(),
    },
    ...regions(language).map((option) => ({
      value: option.value,
      label: option.label,
      searchText: option.searchText,
    })),
  ], [device.locale, t])

  const zoneItems = useMemo<ZoneItem[]>(() => [
    {
      value: null,
      label: t.t(`Preferences.automatic`, { value: zoneLabel(device.timeZone, now) }),
      searchText: `${t.t(`Preferences.automaticSearch`)} automatic device ${
        device.timeZone.replaceAll(`_`, ` `)
      }`.toLowerCase(),
    },
    ...timeZoneOptions(now).map((option) => ({
      value: option.value,
      label: zoneLabel(option.value, now),
      searchText: option.searchText,
    })),
  ], [device.timeZone, t])

  const region = regionItems.find((item) => item.value === shown.locale) ?? regionItems[0]
  const zone = zoneItems.find((item) => item.value === shown.timeZone) ?? zoneItems[0]
  const resolvedClock = clockLabel(t, regionHourCycle(shown.locale ?? device.locale))

  return (
    <div ref={form} class="flex flex-col gap-6" data-e2e="preferences">
      {props.language && (
        // As wide as the fields under it.
        <div class="max-w-md">
          <LanguageRow language={props.language} />
        </div>
      )}
      <p class="text-sm text-muted" data-e2e="preferences-example">
        <Rich
          parts={t.parts(`Preferences.example`, { date: format.dateTime(now, `full`) })}
          tags={{ value: (text) => <span class="text-foreground">{text}</span> }}
        />
      </p>
      {conflict && (
        <div ref={notice} tabIndex={-1} class="outline-none">
          <Notice tone="info" data-e2e="preferences-conflict">
            {t.t(`Preferences.conflict`)}
          </Notice>
        </div>
      )}
      <Stack class="max-w-md">
        <Field
          id="preferences-formats"
          label={t.t(`Preferences.formats`)}
          hint={t.t(`Preferences.formatsHint`)}
        >
          {(wiring) => (
            <Combobox<RegionItem>
              id={wiring.id}
              ariaLabel={t.t(`Preferences.formats`)}
              placeholder={t.t(`Preferences.formatsPlaceholder`)}
              aria-describedby={wiring["aria-describedby"]}
              items={regionItems}
              value={region}
              getLabel={(item) => item.label}
              filter={(items, query) => matching(items, query)}
              onChange={(item) =>
                item && item.value !== shown.locale && save({ locale: item.value })}
              showClearButton={false}
              listboxClass="max-h-60"
              emptyMessage={(query) => t.t(`Preferences.formatsEmpty`, { query })}
            />
          )}
        </Field>
        <Field
          id="preferences-time-zone"
          label={t.t(`Preferences.timeZone`)}
          hint={t.t(`Preferences.timeZoneHint`)}
        >
          {(wiring) => (
            <Combobox<ZoneItem>
              id={wiring.id}
              ariaLabel={t.t(`Preferences.timeZone`)}
              placeholder={t.t(`Preferences.timeZonePlaceholder`)}
              aria-describedby={wiring["aria-describedby"]}
              items={zoneItems}
              value={zone}
              getLabel={(item) => item.label}
              filter={(items, query) => matching(items, query)}
              onChange={(item) =>
                item && item.value !== shown.timeZone && save({ timeZone: item.value })}
              showClearButton={false}
              listboxClass="max-h-60"
              emptyMessage={(query) => t.t(`Preferences.timeZoneEmpty`, { query })}
            />
          )}
        </Field>
        {otherZone && value.timeZone && (
          <OtherZone
            chosen={value.timeZone}
            here={otherZone}
            now={now}
            onUse={() => {
              props.onUseDeviceZone()
              focusNext()
            }}
            onKeep={() => {
              props.onKeepZone()
              focusNext()
            }}
          />
        )}
        <RadioChips
          legend={t.t(`Preferences.clock`)}
          name="hourCycle"
          class="flex flex-col"
          options={CLOCKS.map((clock) => ({
            value: clock,
            label: clock === `format`
              ? t.t(`Preferences.clockFromFormat`, { clock: resolvedClock })
              : clockLabel(t, clock),
            inputAttributes: { "data-e2e": `preferences-clock-${clock}` },
          }))}
          value={shown.hourCycle ?? `format`}
          onChange={(next) => save({ hourCycle: next === `h12` || next === `h23` ? next : null })}
        />
        <ErrorState message={error && t.t(FAILURE_KEYS[error])} />
      </Stack>
      <p class="sr-only" aria-live="polite" data-e2e="preferences-announcement">
        {props.announcement && t.t(`Preferences.updatedElsewhere`)}
      </p>
    </div>
  )
}

/**
 * The profile's "Appearance" section: the theme as three choices, which paints at once and is
 * saved for every device.
 */
export function AppearanceSection(
  { value, systemTheme, onTheme }: Pick<PreferencesProps, "value" | "systemTheme" | "onTheme">,
): JSX.Element {
  const t = useAppText()
  return (
    <RadioChips
      legend={t.t(`Preferences.theme`)}
      name="theme"
      class="flex flex-col"
      options={THEMES.map((theme) => ({
        value: theme,
        label: themeValue(t, theme, systemTheme),
        inputAttributes: { "data-e2e": `preferences-theme-${theme}` },
      }))}
      value={value.theme}
      onChange={(next) => onTheme(next as ThemePreference)}
    />
  )
}

/** The line under the time zone, for a person whose device is somewhere else now. */
function OtherZone(
  { chosen, here, now, onUse, onKeep }: {
    chosen: string
    here: string
    now: Date
    onUse: () => void
    onKeep: () => void
  },
): JSX.Element {
  const city = zoneCity(here)
  const t = useAppText()
  return (
    <div class="flex flex-col gap-2 text-sm" data-e2e="preferences-other-zone">
      <span class="text-foreground">
        {t.t(`Preferences.deviceZone`, { city, offset: zoneOffsetLabel(here, now, `GMT`) })}
      </span>
      <Cluster>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          class={TOUCH_TARGET}
          data-e2e="preferences-use-device-zone"
          onClick={onUse}
        >
          {t.t(`Preferences.useZone`, { city })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class={TOUCH_TARGET}
          data-e2e="preferences-keep-zone"
          onClick={onKeep}
        >
          {t.t(`Preferences.keepZone`, { city: zoneCity(chosen) })}
        </Button>
      </Cluster>
    </div>
  )
}

function pick(value: Preferences): RegionPreferences {
  return { locale: value.locale, timeZone: value.timeZone, hourCycle: value.hourCycle }
}

/** Every word of the query must appear in the option's label or its search text. */
function matching<T extends { label: string; searchText: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...items]
  return items.filter((item) => {
    const text = `${item.label.toLowerCase()} ${item.searchText}`
    return words.every((word) => text.includes(word))
  })
}

/**
 * The operator area's read-only "Language and region" group on a person's Overview (#163, #216):
 * the person's language and choices, their local time now, and when they last changed them.
 * Operators cannot change them. "Automatic" is the person's device, which the operator cannot see:
 * the zone and region format the person signed up with are shown instead, when known. Names of
 * languages and formats are in the operator's language.
 */
export function AdminPreferencesGroup(
  { preferences, now }: { preferences: AdminUserPreferences; now: Date },
): JSX.Element {
  const format = useFormat()
  const t = useAdminText()
  const { value, firstTimeZone, firstLocale } = preferences
  const zone = value.timeZone ?? firstTimeZone
  const localTime = zone
    ? createFormatters({ locale: format.locale, timeZone: zone, hourCycle: format.hourCycle })
      .time(now)
    : null
  const zoneText = value.timeZone !== null
    ? zoneLabel(value.timeZone, now)
    : firstTimeZone
    ? t.t(`AdminPreferences.zoneSignedUp`, { zone: zoneLabel(firstTimeZone, now) })
    : t.t(`AdminPreferences.automatic`)
  const formats = value.locale !== null
    ? regionName(value.locale, t.language)
    : firstLocale
    ? t.t(`AdminPreferences.formatsSignedUp`, { format: regionName(firstLocale, t.language) })
    : t.t(`AdminPreferences.automatic`)
  const themes: Record<ThemePreference, string> = {
    system: t.t(`AdminPreferences.themeSystem`),
    light: t.t(`AdminPreferences.themeLight`),
    dark: t.t(`AdminPreferences.themeDark`),
  }
  return (
    <SettingGroup title={t.t(`AdminPreferences.title`)}>
      <SettingList>
        <SettingRow
          label={t.t(`AdminPreferences.theme`)}
          dataE2E="admin-user-preferences-theme"
          value={themes[value.theme]}
        />
        <SettingRow
          label={t.t(`AdminPreferences.language`)}
          dataE2E="admin-user-preferences-language"
          value={value.language === null
            ? t.t(`AdminPreferences.automatic`)
            : <LanguageLabel language={value.language} inLanguage={t.language} />}
        />
        <SettingRow
          label={t.t(`AdminPreferences.formats`)}
          dataE2E="admin-user-preferences-formats"
          value={formats}
        />
        <SettingRow
          label={t.t(`AdminPreferences.timeZone`)}
          dataE2E="admin-user-preferences-time-zone"
          value={localTime
            ? t.t(`AdminPreferences.zoneNow`, { zone: zoneText, time: localTime })
            : zoneText}
        />
        <SettingRow
          label={t.t(`AdminPreferences.clock`)}
          dataE2E="admin-user-preferences-clock"
          value={value.hourCycle === null ? t.t(`AdminPreferences.clockFromFormat`) : t.t(
            value.hourCycle === `h12` ? `AdminPreferences.clock12` : `AdminPreferences.clock24`,
          )}
        />
        <SettingRow
          label={t.t(`AdminPreferences.changed`)}
          dataE2E="admin-user-preferences-changed"
          value={preferences.updatedAt
            ? <When at={preferences.updatedAt} />
            : t.t(`AdminPreferences.never`)}
        />
      </SettingList>
    </SettingGroup>
  )
}

/**
 * A language's name for a reader of `inLanguage`, with the name in the language itself after it
 * when the two differ, in that language: `German (Deutsch)`, so an operator who reads neither
 * still recognises it.
 */
export function LanguageLabel(
  { language, inLanguage }: { language: string; inLanguage: string },
): JSX.Element {
  const own = languageName(language)
  let theirs = own
  try {
    const text = new Intl.DisplayNames([inLanguage], { type: `language` }).of(language) ?? language
    theirs = text.charAt(0).toLocaleUpperCase(inLanguage) + text.slice(1)
  } catch {
    // A tag `Intl` cannot read: its own name alone.
  }
  const ownName = <span lang={language} dir={textDirection(language)}>{own}</span>
  return theirs === own ? ownName : <>{theirs} ({ownName})</>
}

/** Stands for a value in a message, so an element can be drawn where the value lands. */
const MARK = `\u0000`

/**
 * The "Language" row above Formats: the language in use, by its own name, and the button that
 * opens `LanguageDialog`. Each choice there applies at once.
 */
function LanguageRow({ language }: { language: AccountMenuLanguage }): JSX.Element {
  const t = useAppText()
  const [open, setOpen] = useState(false)
  const inUse = language.current ?? language.automatic ?? t.language
  const name = (
    <span lang={inUse} dir={textDirection(inUse)} data-e2e="preferences-language-name">
      {languageName(inUse)}
    </span>
  )
  // "Automatic: Deutsch", with the name drawn where the message puts it, in its own language.
  const [before, after = ``] = t.t(`Preferences.automatic`, { value: MARK }).split(MARK)
  return (
    <>
      <SettingList>
        <SettingRow
          label={t.t(`Preferences.language`)}
          dataE2E="preferences-language"
          value={language.current === null ? <>{before}{name}{after}</> : name}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(true)}
              data-e2e="preferences-language-change"
            >
              {t.t(`Preferences.changeLanguage`)}
            </Button>
          }
        />
      </SettingList>
      <LanguageDialog {...language} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
