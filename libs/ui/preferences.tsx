import type { JSX } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Combobox } from "@spy4x/preact-ui/combobox"
import { Dropdown, DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { TOUCH_TARGET } from "@spy4x/preact-ui/page-header"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { createFormatters, regionHourCycle } from "@spy4x/time/format"
import { type LocaleOption, localeOptions } from "@spy4x/time/locale"
import { timeZoneOptions, zoneCity, zoneLabel, zoneOffsetLabel } from "@spy4x/time/tz"
import type { AdminUserPreferences, Preferences, ThemePreference } from "@domain/identity"
import { ScreenForm } from "./progressive.tsx"

/** The fields the "Language and region" dialog edits; the theme changes from its own menu. */
export type RegionPreferences = Pick<Preferences, "locale" | "timeZone" | "hourCycle">

/** A device's own region format and zone: what "Automatic" resolves to. */
export interface DeviceRegion {
  locale: string
  timeZone: string
}

export interface PreferencesGroupProps {
  /** The person's preferences, with any change still on its way. */
  value: Preferences
  /** This device's region format and zone. */
  device: DeviceRegion
  /** What "System" paints on this device now. */
  systemTheme: "light" | "dark"
  /** This device's zone when the person chose another and has not kept theirs; else `null`. */
  otherZone: string | null
  /**
   * The record that won when this device's save was refused: another device saved first. The
   * dialog then shows its values and says why.
   */
  conflict: { version: number; value: Preferences } | null
  /** The version of {@link value}: a draft is saved on the version it was made on. */
  version: number
  /** A save of the dialog is on its way. */
  pending: boolean
  /** Why the last save of the dialog failed, shown under its form; `null` when it did not. */
  error: string | null
  /** Said to a screen reader when another device changed what is on screen. */
  announcement: string
  /** The moment the examples and the zones' offsets are read at. */
  now: Date
  onTheme(theme: ThemePreference): void
  /**
   * Save the dialog's values on `baseVersion`, the version they were made on, so a change another
   * device saved meanwhile is refused instead of overwritten.
   */
  onSave(next: RegionPreferences, baseVersion: number): void
  /** "Use Tokyo time": this device's zone becomes the person's zone. */
  onUseDeviceZone(): void
  /** "Keep Berlin time": stop offering this device's zone. */
  onKeepZone(): void
  /** The dialog closed: forget the refused save's notice and error. */
  onCloseDialog(): void
}

/** The messages the view shows when a save of the dialog did not go through. */
export const PREFERENCES_FAILURES = {
  network: `We could not save your preferences. Check your connection and try again.`,
  offline: `You are offline, so nothing was saved. Save again when you are back online.`,
  invalid: `Pick each value from its list, then save again.`,
} as const

const THEME_LABELS: Record<ThemePreference, string> = {
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

/** The theme row's value: `System (dark on this device)`, `Light` or `Dark`. */
export function themeValue(theme: ThemePreference, system: "light" | "dark"): string {
  return theme === `system` ? `System (${system} on this device)` : THEME_LABELS[theme]
}

/** The rows' values for one person's preferences, as their own page or the operator area says. */
export function preferenceValues(
  value: Preferences,
  device: DeviceRegion,
  now: Date,
  whose: "this device" | "their device" = `this device`,
) {
  const locale = value.locale ?? device.locale
  return {
    formats: value.locale === null
      ? `Automatic: same as ${whose} — ${regionName(device.locale)}`
      : regionName(value.locale),
    timeZone: value.timeZone === null
      ? `Automatic: same as ${whose} — ${zoneLabel(device.timeZone, now)}`
      : zoneLabel(value.timeZone, now),
    clock: value.hourCycle === null
      ? `As in ${whose === `this device` ? `your` : `their`} region format (${
        clockLabel(regionHourCycle(locale))
      })`
      : clockLabel(value.hourCycle),
  }
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

/** Which field the dialog was opened from, so it gets the focus. */
type DialogField = "formats" | "timeZone" | "clock"

const FIELD_IDS: Record<DialogField, string> = {
  formats: `preferences-formats`,
  timeZone: `preferences-time-zone`,
  clock: `preferences-clock`,
}

/**
 * "Language and region" on the profile page (#163): the theme, the region format, the time zone and
 * the clock, which follow the person to every device. The theme changes at once from its row's
 * menu; the other three are edited together in one dialog with Save, like the name. The group's
 * description shows a date and time in the person's settings, so the result shows before anything
 * is opened.
 */
export function PreferencesGroup(props: PreferencesGroupProps): JSX.Element {
  const { value, device, systemTheme, otherZone, now, onTheme } = props
  const format = useFormat()
  const [editing, setEditing] = useState<DialogField | null>(null)
  const group = useRef<HTMLDivElement>(null)
  // "Use" and "Keep" remove themselves; the focus goes to the row's own button, not the page.
  const focusZoneChange = () =>
    group.current?.querySelector<HTMLElement>(`[data-e2e="preferences-change-timeZone"]`)?.focus()
  const values = preferenceValues(value, device, now)

  const change = (field: DialogField, object: string) => (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      class={TOUCH_TARGET}
      data-e2e={`preferences-change-${field}`}
      onClick={() => setEditing(field)}
    >
      Change <span class="sr-only">{object}</span>
    </Button>
  )

  return (
    <div ref={group} data-e2e="preferences">
      <SettingGroup
        title="Language and region"
        description={
          <span data-e2e="preferences-example">
            Dates and times look like this: {format.dateTime(now, `full`)}.
          </span>
        }
      >
        <SettingList>
          <SettingRow
            label="Theme"
            dataE2E="preferences-theme"
            value={themeValue(value.theme, systemTheme)}
            action={
              <Dropdown
                trigger={
                  <>
                    Change <span class="sr-only">theme</span>
                  </>
                }
                triggerClasses={buttonClasses(`secondary`, `sm`, TOUCH_TARGET)}
                triggerNamedByContent
                horizontal="right"
                menuLabel="Theme"
              >
                {THEMES.map((theme) => (
                  <DropdownItem
                    key={theme}
                    checked={value.theme === theme}
                    onClick={() => onTheme(theme)}
                    dataE2E={`preferences-theme-${theme}`}
                  >
                    {THEME_LABELS[theme]}
                  </DropdownItem>
                ))}
              </Dropdown>
            }
          />
          <SettingRow
            label="Formats"
            dataE2E="preferences-formats"
            value={values.formats}
            action={change(`formats`, `formats`)}
          />
          <SettingRow
            label="Time zone"
            dataE2E="preferences-time-zone"
            value={
              <span class="flex flex-col gap-2">
                <span>{values.timeZone}</span>
                {otherZone && value.timeZone && (
                  <OtherZone
                    chosen={value.timeZone}
                    here={otherZone}
                    now={now}
                    onUse={() => {
                      props.onUseDeviceZone()
                      focusZoneChange()
                    }}
                    onKeep={() => {
                      props.onKeepZone()
                      focusZoneChange()
                    }}
                  />
                )}
              </span>
            }
            action={change(`timeZone`, `time zone`)}
          />
          <SettingRow
            label="Clock"
            dataE2E="preferences-clock"
            value={values.clock}
            action={change(`clock`, `clock`)}
          />
        </SettingList>
      </SettingGroup>
      <p class="sr-only" aria-live="polite" data-e2e="preferences-announcement">
        {props.announcement}
      </p>
      <RegionDialog
        {...props}
        field={editing}
        onClose={() => {
          setEditing(null)
          props.onCloseDialog()
        }}
      />
    </div>
  )
}

/** The second line of the Time zone row, for a person whose device is somewhere else now. */
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
    <span class="flex flex-col gap-2" data-e2e="preferences-other-zone">
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
    </span>
  )
}

/** The dialog that edits the region format, the time zone and the clock together. */
function RegionDialog(
  props: PreferencesGroupProps & { field: DialogField | null; onClose: () => void },
): JSX.Element {
  const { value, version, device, conflict, pending, error, now, field, onClose, onSave } = props
  const open = field !== null
  const [draft, setDraft] = useState<RegionPreferences>(pick(value))
  // The version the draft was made on, and the values it had then. A save goes out on that
  // version, so a change another device made to these fields after the person started editing is
  // refused, never overwritten.
  const [base, setBase] = useState(version)
  const [made, setMade] = useState<RegionPreferences>(pick(value))
  const [touched, setTouched] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const notice = useRef<HTMLDivElement>(null)

  // Each opening starts from what is saved, with the focus in the field of the row it came from.
  useEffect(() => {
    if (!open) return
    setDraft(pick(value))
    setMade(pick(value))
    setBase(version)
    setTouched(false)
    body.current?.querySelector<HTMLElement>(`#${FIELD_IDS[field]}`)?.focus()
  }, [open, field])

  // Another device saved while the dialog is open. An untouched draft follows it. An edited one
  // moves to the new version only when these three fields are as it found them (the theme
  // changed), so only a change to what the person is editing makes the save refused.
  useEffect(() => {
    if (!open) return
    const saved = pick(value)
    if (touched && !sameRegion(saved, made)) return
    if (!touched) setDraft(saved)
    setMade(saved)
    setBase(version)
  }, [value.locale, value.timeZone, value.hourCycle, version])

  // A refused save: the dialog shows the values that won, and says why.
  useEffect(() => {
    if (!conflict) return
    setDraft(pick(conflict.value))
    setMade(pick(conflict.value))
    setBase(conflict.version)
    setTouched(false)
    notice.current?.focus()
  }, [conflict])

  // A save that went through closes the dialog; the rows and every date change at once.
  const was = useRef(pending)
  useEffect(() => {
    if (was.current && !pending && !error && !conflict) onClose()
    was.current = pending
  }, [pending, error, conflict])

  const regionItems = useMemo<RegionItem[]>(() => [
    {
      value: null,
      label: `Automatic: same as this device — ${regionName(device.locale)}`,
      searchText: `automatic device ${regionName(device.locale)}`.toLowerCase(),
    },
    ...regions().map((option) => ({
      value: option.value,
      label: option.label,
      searchText: option.searchText,
    })),
  ], [device.locale])

  const zoneItems = useMemo<ZoneItem[]>(() =>
    open
      ? [
        {
          value: null,
          label: `Automatic: same as this device — ${zoneLabel(device.timeZone, now)}`,
          searchText: `automatic device ${device.timeZone.replaceAll(`_`, ` `)}`.toLowerCase(),
        },
        ...timeZoneOptions(now).map((option) => ({
          value: option.value,
          label: zoneLabel(option.value, now),
          searchText: option.searchText,
        })),
      ]
      : [], [open, device.timeZone])

  const region = regionItems.find((item) => item.value === draft.locale) ?? regionItems[0]
  const zone = zoneItems.find((item) => item.value === draft.timeZone) ?? zoneItems[0] ?? null
  const set = (patch: Partial<RegionPreferences>) => {
    setTouched(true)
    setDraft({ ...draft, ...patch })
  }
  const resolvedClock = clockLabel(regionHourCycle(draft.locale ?? device.locale))
  const example = createFormatters(draft, { device }).dateTime(now, `full`)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Language and region"
      cancelLabel="Close"
      dataE2E="preferences-dialog"
    >
      <ScreenForm pending={pending} onSubmit={() => onSave(draft, base)}>
        <div ref={body}>
          <Stack>
            {conflict && (
              <div ref={notice} tabIndex={-1} class="outline-none">
                <Notice tone="info" data-e2e="preferences-conflict">
                  These changed on another device while you were editing. Check the values below and
                  save again.
                </Notice>
              </div>
            )}
            <Field
              id={FIELD_IDS.formats}
              label="Formats"
              hint="How dates and times are written. The app stays in English."
            >
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
                  onChange={(item) => item && set({ locale: item.value })}
                  showClearButton={false}
                  listboxClass="max-h-40 sm:max-h-60"
                  emptyMessage={(query) => `No formats match "${query}".`}
                />
              )}
            </Field>
            <Field
              id={FIELD_IDS.timeZone}
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
                  onChange={(item) => item && set({ timeZone: item.value })}
                  showClearButton={false}
                  listboxClass="max-h-40 sm:max-h-60"
                  emptyMessage={(query) =>
                    `No time zones match "${query}". Try a city or an offset such as GMT+2.`}
                />
              )}
            </Field>
            <Field id={FIELD_IDS.clock} label="Clock">
              <Select
                name="hourCycle"
                data-e2e="preferences-clock-select"
                options={[
                  { value: ``, label: `As in your region format (${resolvedClock})` },
                  { value: `h23`, label: `24-hour` },
                  { value: `h12`, label: `12-hour` },
                ]}
                value={draft.hourCycle ?? ``}
                onChange={(event) => {
                  const next = event.currentTarget.value
                  set({ hourCycle: next === `h12` || next === `h23` ? next : null })
                }}
              />
            </Field>
            <p class="text-sm text-muted" aria-live="polite" data-e2e="preferences-preview">
              Example: {example}
            </p>
            <ErrorState message={error} />
            {
              // On a phone Save is on top at full width, Cancel under it; from `sm` up they are a
              // row at the right, Save last.
            }
            <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                class="min-h-11 w-full sm:min-h-9 sm:w-auto"
                data-e2e="preferences-save"
                busy={pending}
                busyLabel="Saving…"
              >
                Save
              </Button>
            </div>
          </Stack>
        </div>
      </ScreenForm>
    </Modal>
  )
}

function pick(value: Preferences): RegionPreferences {
  return { locale: value.locale, timeZone: value.timeZone, hourCycle: value.hourCycle }
}

/** Whether two drafts name the same region format, zone and clock. */
function sameRegion(a: RegionPreferences, b: RegionPreferences): boolean {
  return a.locale === b.locale && a.timeZone === b.timeZone && a.hourCycle === b.hourCycle
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
            : THEME_LABELS[value.theme]}
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
