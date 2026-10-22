import type { JSX } from "preact"
import { useEffect, useMemo, useRef } from "preact/hooks"
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
  /** Why the last save failed, shown under the form; `null` when it did not. */
  error: string | null
  /** Said to a screen reader when another device changed what is on screen. */
  announcement: string
  /** The moment the examples and the zones' offsets are read at. */
  now: Date
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

/** The messages the view shows when a save did not go through. */
export const PREFERENCES_FAILURES = {
  network: `Could not save your change. Check your connection and try again.`,
  offline: `You are offline, so nothing was saved. Change it again when you are back online.`,
  invalid: `Pick each value from its list.`,
} as const

/** Each theme in one word, as the profile's list of sections shows it. */
export const THEME_NAMES: Record<ThemePreference, string> = {
  system: `System`,
  light: `Light`,
  dark: `Dark`,
}

const THEMES: readonly ThemePreference[] = [`system`, `light`, `dark`]

/** Every region format, named in English; built once, on first use. */
let regionOptions: LocaleOption[] | undefined
function regions(): LocaleOption[] {
  regionOptions ??= localeOptions(`en`)
  return regionOptions
}

/** A region format's English name, `German (Germany)`, or the tag when the list lacks it. */
export function regionName(locale: string): string {
  return regions().find((option) => option.value === locale)?.name ?? locale
}

/** A clock as a person reads it. */
function clockLabel(cycle: "h12" | "h23"): string {
  return cycle === `h12` ? `12-hour` : `24-hour`
}

/** A theme as its choice reads: `System (dark on this device)`, `Light` or `Dark`. */
export function themeValue(theme: ThemePreference, system: "light" | "dark"): string {
  return theme === `system` ? `System (${system} on this device)` : THEME_NAMES[theme]
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
      label: `Automatic: ${regionName(device.locale)}`,
      searchText: `automatic device ${regionName(device.locale)}`.toLowerCase(),
    },
    ...regions().map((option) => ({
      value: option.value,
      label: option.label,
      searchText: option.searchText,
    })),
  ], [device.locale])

  const zoneItems = useMemo<ZoneItem[]>(() => [
    {
      value: null,
      label: `Automatic: ${zoneLabel(device.timeZone, now)}`,
      searchText: `automatic device ${device.timeZone.replaceAll(`_`, ` `)}`.toLowerCase(),
    },
    ...timeZoneOptions(now).map((option) => ({
      value: option.value,
      label: zoneLabel(option.value, now),
      searchText: option.searchText,
    })),
  ], [device.timeZone])

  const region = regionItems.find((item) => item.value === shown.locale) ?? regionItems[0]
  const zone = zoneItems.find((item) => item.value === shown.timeZone) ?? zoneItems[0]
  const resolvedClock = clockLabel(regionHourCycle(shown.locale ?? device.locale))

  return (
    <div ref={form} class="flex flex-col gap-6" data-e2e="preferences">
      <p class="text-sm text-muted" data-e2e="preferences-example">
        Dates and times look like this:{" "}
        <span class="text-foreground">{format.dateTime(now, `full`)}</span>.
      </p>
      {conflict && (
        <div ref={notice} tabIndex={-1} class="outline-none">
          <Notice tone="info" data-e2e="preferences-conflict">
            These changed on another device a moment ago. The values below are the ones it saved.
          </Notice>
        </div>
      )}
      <Stack class="max-w-md">
        <Field id="preferences-formats" label="Formats">
          {(wiring) => (
            <Combobox<RegionItem>
              id={wiring.id}
              ariaLabel="Formats"
              placeholder="Search by language or country"
              aria-describedby={wiring["aria-describedby"]}
              items={regionItems}
              value={region}
              getLabel={(item) => item.label}
              filter={(items, query) => matching(items, query)}
              onChange={(item) =>
                item && item.value !== shown.locale && save({ locale: item.value })}
              showClearButton={false}
              listboxClass="max-h-60"
              emptyMessage={(query) => `No formats match "${query}".`}
            />
          )}
        </Field>
        <Field
          id="preferences-time-zone"
          label="Time zone"
          hint="A zone you pick is used on all your devices. Automatic follows each device."
        >
          {(wiring) => (
            <Combobox<ZoneItem>
              id={wiring.id}
              ariaLabel="Time zone"
              placeholder="Search by city"
              aria-describedby={wiring["aria-describedby"]}
              items={zoneItems}
              value={zone}
              getLabel={(item) => item.label}
              filter={(items, query) => matching(items, query)}
              onChange={(item) =>
                item && item.value !== shown.timeZone && save({ timeZone: item.value })}
              showClearButton={false}
              listboxClass="max-h-60"
              emptyMessage={(query) =>
                `No time zones match "${query}". Try a city or an offset such as GMT+2.`}
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
          legend="Clock"
          name="hourCycle"
          class="flex flex-col"
          options={CLOCKS.map((clock) => ({
            value: clock,
            label: clock === `format` ? `From format (${resolvedClock})` : clockLabel(clock),
            inputAttributes: { "data-e2e": `preferences-clock-${clock}` },
          }))}
          value={shown.hourCycle ?? `format`}
          onChange={(next) => save({ hourCycle: next === `h12` || next === `h23` ? next : null })}
        />
        <ErrorState message={error} />
      </Stack>
      <p class="sr-only" aria-live="polite" data-e2e="preferences-announcement">
        {props.announcement}
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
  return (
    <RadioChips
      legend="Theme"
      name="theme"
      class="flex flex-col"
      options={THEMES.map((theme) => ({
        value: theme,
        label: themeValue(theme, systemTheme),
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
  return (
    <div class="flex flex-col gap-2 text-sm" data-e2e="preferences-other-zone">
      <span class="text-foreground">
        This device is on {city} time ({zoneOffsetLabel(here, now, `GMT`)}).
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
          Use {city} time
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class={TOUCH_TARGET}
          data-e2e="preferences-keep-zone"
          onClick={onKeep}
        >
          Keep {zoneCity(chosen)} time
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
 * The operator area's read-only "Language and region" group on a person's Overview (#163): the
 * person's choices, their local time now, and when they last changed them. Operators cannot change
 * them. "Automatic" is the person's device, which the operator cannot see: the zone the person
 * signed up in is shown instead, when known.
 */
export function AdminPreferencesGroup(
  { preferences, now }: { preferences: AdminUserPreferences; now: Date },
): JSX.Element {
  const format = useFormat()
  const { value, firstTimeZone } = preferences
  const zone = value.timeZone ?? firstTimeZone
  const localTime = zone
    ? createFormatters({ locale: format.locale, timeZone: zone, hourCycle: format.hourCycle })
      .time(now)
    : null
  const zoneText = value.timeZone !== null
    ? zoneLabel(value.timeZone, now)
    : firstTimeZone
    ? `Automatic: same as their device (signed up in ${zoneLabel(firstTimeZone, now)})`
    : `Automatic: same as their device`
  return (
    <SettingGroup title="Language and region">
      <SettingList>
        <SettingRow
          label="Theme"
          dataE2E="admin-user-preferences-theme"
          value={value.theme === `system`
            ? `System (follows their device)`
            : THEME_NAMES[value.theme]}
        />
        <SettingRow
          label="Formats"
          dataE2E="admin-user-preferences-formats"
          value={value.locale === null
            ? `Automatic: same as their device`
            : regionName(value.locale)}
        />
        <SettingRow
          label="Time zone"
          dataE2E="admin-user-preferences-time-zone"
          value={localTime ? `${zoneText} · ${localTime} there now` : zoneText}
        />
        <SettingRow
          label="Clock"
          dataE2E="admin-user-preferences-clock"
          value={value.hourCycle === null
            ? `As in their region format`
            : clockLabel(value.hourCycle)}
        />
        <SettingRow
          label="Changed"
          dataE2E="admin-user-preferences-changed"
          value={preferences.updatedAt ? <When at={preferences.updatedAt} /> : `Never`}
        />
      </SettingList>
    </SettingGroup>
  )
}
