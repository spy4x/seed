import type { JSX } from "preact"
import { useMemo } from "preact/hooks"
import { Combobox } from "@spy4x/preact-ui/combobox"
import { timeZoneOptions, zoneLabel } from "@spy4x/time/tz"
import { useAppText } from "./i18n.ts"

/** One choice of the picker: a zone, or `null` for the "Automatic" item. */
interface ZoneItem {
  value: string | null
  label: string
  searchText: string
}

/** The picker's first item, which stores no zone: "Automatic (Berlin, Europe · GMT+1)". */
export interface AutomaticZone {
  label: string
  /** Words a search finds it by, lower case. */
  searchText: string
}

export interface TimeZonePickerProps {
  /** The input's id, as `Field` hands it down. */
  id: string
  /** The `aria-describedby` that `Field` hands down: its hint and error. */
  "aria-describedby"?: string
  /** Marks the input invalid while its field shows an error. */
  "aria-invalid"?: boolean
  /** What is chosen: a zone, or `null` for {@link automatic}. */
  value: string | null
  /** The moment the offsets are read at, which daylight saving time moves. */
  now: Date
  /**
   * The first item, which stores no zone. Left out, every item is a real zone, and a `null` value
   * shows the empty input.
   */
  automatic?: AutomaticZone
  /** Called with the picked zone, or `null` for {@link automatic}, only when it differs. */
  onChange(value: string | null): void
}

/**
 * The time zone picker of the profile's "Language and region" and of a group's General tab: every
 * zone, west to east, as `Berlin, Europe · GMT+1`, searched by every word of the query in any
 * order. A stored zone the list lacks (an alias such as `Asia/Calcutta`) is shown as its own item,
 * so the field never reads as empty.
 */
export function TimeZonePicker(props: TimeZonePickerProps): JSX.Element {
  const { value, now, automatic, onChange } = props
  const t = useAppText()
  const items = useMemo<ZoneItem[]>(() => {
    const zones: ZoneItem[] = timeZoneOptions(now).map((option) => ({
      value: option.value,
      label: zoneLabel(option.value, now),
      searchText: option.searchText,
    }))
    if (value !== null && !zones.some((item) => item.value === value)) {
      zones.unshift({
        value,
        label: zoneLabel(value, now),
        searchText: value.replaceAll(`_`, ` `).toLowerCase(),
      })
    }
    return automatic ? [{ value: null, ...automatic }, ...zones] : zones
  }, [automatic?.label, automatic?.searchText, value, t])
  const chosen = items.find((item) => item.value === value) ?? null
  return (
    <Combobox<ZoneItem>
      id={props.id}
      ariaLabel={t.t(`Preferences.timeZone`)}
      placeholder={t.t(`Preferences.timeZonePlaceholder`)}
      aria-describedby={props[`aria-describedby`]}
      aria-invalid={props[`aria-invalid`]}
      items={items}
      value={chosen}
      getLabel={(item) => item.label}
      filter={(all, query) => matching(all, query)}
      onChange={(item) => item && item.value !== value && onChange(item.value)}
      showClearButton={false}
      // A long label ends in an ellipsis in the field; the list shows it whole.
      inputClass="text-ellipsis"
      listboxClass="max-h-60"
      emptyMessage={(query) => t.t(`Preferences.timeZoneEmpty`, { query })}
    />
  )
}

/** Every word of the query must appear in the option's label or its search text. */
export function matching<T extends { label: string; searchText: string }>(
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
