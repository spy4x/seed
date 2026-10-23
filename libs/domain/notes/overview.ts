import { type } from "arktype"
import type { Query } from "@spy4x/platform/cqrs"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import type { DateRange } from "@spy4x/time/date"
import { isValidTimeZone } from "@spy4x/time/tz"
import type { Actor } from "@domain/identity"
import {
  canRead,
  type CountWidgetResult,
  type OverviewPeriods,
  overviewPeriods,
  type SeriesWidgetResult,
  type WidgetDefinition,
} from "@domain/groups"
import { NoteError } from "./+lib.ts"
import { fieldErrors } from "@spy4x/validation"

/**
 * The notes' widgets on the group overview (#219). Every member of the group sees them, as every
 * member reads the notes. Counts only: who wrote what stays out, so the page never ranks people.
 *
 * Edits leave no trace a count could use (an update writes no audit row), so the second number is
 * the notes *added* in the range, read from each note's creation time.
 */

/** The notes' widget ids. They are what a saved layout keeps: never rename one. */
export const NOTE_WIDGET_IDS = {
  total: "notes.total",
  added: "notes.added",
  series: "notes.over-time",
} as const

/** The notes' widgets, in their default order. */
export const NOTE_WIDGETS: readonly WidgetDefinition[] = [
  {
    id: NOTE_WIDGET_IDS.total,
    title: "Notes",
    size: "stat",
    canView: canRead,
    operation: "note.widget.total",
  },
  {
    id: NOTE_WIDGET_IDS.added,
    title: "Notes added",
    size: "stat",
    canView: canRead,
    operation: "note.widget.added",
  },
  {
    id: NOTE_WIDGET_IDS.series,
    title: "Notes over time",
    size: "full",
    canView: canRead,
    operation: "note.widget.series",
  },
]

/** The payload of every note widget operation: the group, the days and the zone that cuts them. */
export const noteWidgetPayloadSchema = type({
  groupId: UUID_PATTERN,
  from: "string",
  to: "string",
  timeZone: "string <= 64",
  "+": "reject",
})

/** What a note widget query carries. */
export interface NoteWidgetPayload {
  actor: Actor
  groupId: string
  range: DateRange
  /** The IANA zone whose midnights split the days: the person's own. */
  timeZone: string
}

/**
 * A widget payload as the handlers need it. Throws `NoteError("INVALID_REQUEST")` for a payload
 * that fails the schema, a range that is not two real days in order or is longer than a year, and
 * a zone the runtime does not know.
 */
export function parseNoteWidgetRequest(
  value: unknown,
): Omit<NoteWidgetPayload, "actor"> {
  const result = noteWidgetPayloadSchema(value)
  if (result instanceof type.errors) {
    throw new NoteError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  const range = { from: result.from, to: result.to }
  if (!overviewPeriods(range)) {
    throw new NoteError("INVALID_REQUEST", "The range must be up to a year of days in order")
  }
  if (!isValidTimeZone(result.timeZone)) {
    throw new NoteError("INVALID_REQUEST", "The time zone is unknown")
  }
  return { groupId: result.groupId, range, timeZone: result.timeZone }
}

/** The periods of a payload that {@link parseNoteWidgetRequest} accepted. */
export function noteWidgetPeriods(payload: Pick<NoteWidgetPayload, "range">): OverviewPeriods {
  const periods = overviewPeriods(payload.range)
  if (!periods) throw new NoteError("INVALID_REQUEST", "The range is invalid")
  return periods
}

/** "Notes": the group's live notes at the end of the range's last day. */
export class NoteTotalWidgetQuery implements Query<NoteWidgetPayload, CountWidgetResult> {
  __resultType?: CountWidgetResult
  constructor(public data: NoteWidgetPayload) {}
}

/** "Notes added": the notes created in the range, deleted ones included. */
export class NoteAddedWidgetQuery implements Query<NoteWidgetPayload, CountWidgetResult> {
  __resultType?: CountWidgetResult
  constructor(public data: NoteWidgetPayload) {}
}

/** "Notes over time": the live notes at the end of each day of the range. */
export class NoteSeriesWidgetQuery implements Query<NoteWidgetPayload, SeriesWidgetResult> {
  __resultType?: SeriesWidgetResult
  constructor(public data: NoteWidgetPayload) {}
}

/**
 * The numbers behind the note widgets. Who may read them is the handler's check, made before it
 * calls this; every method reads one group only.
 */
export interface NoteOverviewRepository {
  /** The live notes at the end of each day of `range` in `timeZone`, oldest day first. */
  dailyTotals(groupId: string, range: DateRange, timeZone: string): Promise<number[]>
  /** The notes created on the days of `range` in `timeZone`, deleted ones included. */
  added(groupId: string, range: DateRange, timeZone: string): Promise<number>
  /** The day the group was created on in `timeZone`, or `null` for a group that does not exist. */
  startDay(groupId: string, timeZone: string): Promise<string | null>
}
