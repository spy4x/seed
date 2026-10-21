import type { QueryHandler } from "@spy4x/platform/cqrs"
import type { Operations } from "@spy4x/realtime/operations"
import {
  assertCanReadNotes,
  type GroupRoleLookup,
  NOTE_WIDGET_IDS,
  NOTE_WIDGETS,
  NoteAddedWidgetQuery,
  type NoteOverviewRepository,
  NoteSeriesWidgetQuery,
  NoteTotalWidgetQuery,
  type NoteWidgetPayload,
  noteWidgetPeriods,
  parseNoteWidgetRequest,
} from "@domain/notes"
import {
  type CountWidgetResult,
  daysOf,
  type OverviewPeriods,
  type SeriesWidgetResult,
} from "@domain/groups"
import type { Actor } from "@domain/identity"

/** What the note widget handlers need: the numbers, and the actor's role in the group. */
export interface NoteWidgetHandlerDependencies {
  overview: NoteOverviewRepository
  groups: GroupRoleLookup
}

/**
 * The periods of the request, after the same check the notes list makes: every member reads, and
 * a person who is not a member is told the group does not exist.
 */
async function readablePeriods(
  { groups }: NoteWidgetHandlerDependencies,
  data: NoteWidgetPayload,
): Promise<OverviewPeriods> {
  assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
  return noteWidgetPeriods(data)
}

/** Whether the group existed for the whole previous period, so a comparison is fair. */
async function comparable(
  { overview }: NoteWidgetHandlerDependencies,
  data: NoteWidgetPayload,
  periods: OverviewPeriods,
): Promise<boolean> {
  const start = await overview.startDay(data.groupId, data.timeZone)
  return start !== null && start <= periods.previous.from
}

/** "Notes": the live notes at the end of the range, and at the end of the period before it. */
export function createNoteTotalWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteTotalWidgetQuery> {
  return async ({ data }): Promise<CountWidgetResult> => {
    const periods = await readablePeriods(dependencies, data)
    const totalOn = async (day: string) =>
      (await dependencies.overview.dailyTotals(
        data.groupId,
        { from: day, to: day },
        data.timeZone,
      ))[0]
    return {
      current: await totalOn(periods.current.to),
      previous: await comparable(dependencies, data, periods)
        ? await totalOn(periods.previous.to)
        : null,
    }
  }
}

/** "Notes added": the notes created in the range, and in the period before it. */
export function createNoteAddedWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteAddedWidgetQuery> {
  return async ({ data }): Promise<CountWidgetResult> => {
    const periods = await readablePeriods(dependencies, data)
    const { overview } = dependencies
    return {
      current: await overview.added(data.groupId, periods.current, data.timeZone),
      previous: await comparable(dependencies, data, periods)
        ? await overview.added(data.groupId, periods.previous, data.timeZone)
        : null,
    }
  }
}

/** "Notes over time": the daily totals of the range, and of the period before it. */
export function createNoteSeriesWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteSeriesWidgetQuery> {
  return async ({ data }): Promise<SeriesWidgetResult> => {
    const periods = await readablePeriods(dependencies, data)
    const { overview } = dependencies
    return {
      days: daysOf(periods.current),
      current: await overview.dailyTotals(data.groupId, periods.current, data.timeZone),
      previous: await comparable(dependencies, data, periods)
        ? await overview.dailyTotals(data.groupId, periods.previous, data.timeZone)
        : null,
    }
  }
}

/** What the widget operations need from the app: the query bus, one function per widget. */
export interface NoteWidgetOperationDependencies {
  total(query: NoteTotalWidgetQuery): Promise<CountWidgetResult>
  added(query: NoteAddedWidgetQuery): Promise<CountWidgetResult>
  series(query: NoteSeriesWidgetQuery): Promise<SeriesWidgetResult>
}

/**
 * The note widget queries the socket and `POST /api/call` serve, one per entry of
 * {@link NOTE_WIDGETS}, named by its `operation`.
 */
export function createNoteWidgetOperations(
  dependencies: NoteWidgetOperationDependencies,
): Operations<Actor> {
  const operation = (id: string) => NOTE_WIDGETS.find((widget) => widget.id === id)!.operation
  return {
    [operation(NOTE_WIDGET_IDS.total)]: {
      kind: "query",
      handle: async ({ actor, payload }) =>
        await dependencies.total(
          new NoteTotalWidgetQuery({ actor, ...parseNoteWidgetRequest(payload) }),
        ),
    },
    [operation(NOTE_WIDGET_IDS.added)]: {
      kind: "query",
      handle: async ({ actor, payload }) =>
        await dependencies.added(
          new NoteAddedWidgetQuery({ actor, ...parseNoteWidgetRequest(payload) }),
        ),
    },
    [operation(NOTE_WIDGET_IDS.series)]: {
      kind: "query",
      handle: async ({ actor, payload }) =>
        await dependencies.series(
          new NoteSeriesWidgetQuery({ actor, ...parseNoteWidgetRequest(payload) }),
        ),
    },
  }
}
