import { type DateRange, formatIsoDate, isValidDateRange, parseIsoDate } from "@spy4x/time/date"
import type { GroupRole } from "./+lib.ts"

/**
 * The group overview (#219): a page of widgets, each a number or a chart about the group over a
 * range of days. Each aggregate lists its own widgets (`NOTE_WIDGETS` in `@domain/notes`); the
 * overview draws the ones the person's role may see, in the order the person chose.
 * `docs/aggregates.md`, "Adding a widget to the overview", walks through adding one.
 *
 * @module
 */

/** A widget's width: `stat` shares a row with other numbers, `full` takes the row. */
export type WidgetSize = "stat" | "full"

/** One widget an aggregate offers. Its data comes from {@link WidgetDefinition.operation}. */
export interface WidgetDefinition {
  /** Stable: it is what a person's saved layout keeps, so it never changes once shipped. */
  id: string
  title: string
  size: WidgetSize
  /** Whether a member of this role sees the widget at all. A hidden one is neither drawn nor listed. */
  canView(role: GroupRole): boolean
  /** The query operation (`note.widget.total`) that answers with the widget's data. */
  operation: string
}

/** The longest range a widget answers for, in days: a year, a leap day included. */
export const OVERVIEW_RANGE_MAX_DAYS = 366

const MS_PER_DAY = 86_400_000

/** The range asked for and the period of the same length right before it, both inclusive days. */
export interface OverviewPeriods {
  current: DateRange
  previous: DateRange
  /** How many days each period has. */
  days: number
}

/**
 * The periods a widget compares: `range`, and as many days right before it. `null` when the range
 * is not two real days in order, or longer than {@link OVERVIEW_RANGE_MAX_DAYS}.
 */
export function overviewPeriods(range: DateRange): OverviewPeriods | null {
  if (!isValidDateRange(range)) return null
  const from = parseIsoDate(range.from)
  const days = (parseIsoDate(range.to) - from) / MS_PER_DAY + 1
  if (days > OVERVIEW_RANGE_MAX_DAYS) return null
  return {
    current: range,
    previous: {
      from: formatIsoDate(from - days * MS_PER_DAY),
      to: formatIsoDate(from - MS_PER_DAY),
    },
    days,
  }
}

/** Every day of `range`, oldest first. */
export function daysOf(range: DateRange): string[] {
  const days: string[] = []
  for (let ms = parseIsoDate(range.from); ms <= parseIsoDate(range.to); ms += MS_PER_DAY) {
    days.push(formatIsoDate(ms))
  }
  return days
}

/**
 * A number widget's answer: the value for the range, and for the period before it. `previous` is
 * `null` when the group did not exist for the whole previous period, so a comparison would
 * mislead.
 */
export interface CountWidgetResult {
  current: number
  previous: number | null
}

/** A chart widget's answer: one value per day of the range, and of the period before it. */
export interface SeriesWidgetResult {
  /** The range's days, `YYYY-MM-DD`, oldest first. */
  days: string[]
  current: number[]
  /** Same length as `current`; `null` for the same reason as {@link CountWidgetResult.previous}. */
  previous: number[] | null
}

/** One entry of a person's overview layout: a widget id and whether the person hid it. */
export interface OverviewLayoutEntry {
  id: string
  hidden: boolean
}
