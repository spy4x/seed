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

/** One widget's request once the membership is settled: the group, the days and the zone. */
export type NoteWidgetRequest = Omit<NoteWidgetPayload, "actor">

/** Whether the group existed for the whole previous period, so a comparison is fair. */
async function comparable(
  overview: NoteOverviewRepository,
  request: NoteWidgetRequest,
  periods: OverviewPeriods,
): Promise<boolean> {
  const start = await overview.startDay(request.groupId, request.timeZone)
  return start !== null && start <= periods.previous.from
}

/** "Notes": the live notes at the end of the range, and at the end of the period before it. */
export async function readNoteTotal(
  overview: NoteOverviewRepository,
  request: NoteWidgetRequest,
): Promise<CountWidgetResult> {
  const periods = noteWidgetPeriods(request)
  const totalOn = async (day: string) =>
    (await overview.dailyTotals(request.groupId, { from: day, to: day }, request.timeZone))[0]
  return {
    current: await totalOn(periods.current.to),
    previous: await comparable(overview, request, periods)
      ? await totalOn(periods.previous.to)
      : null,
  }
}

/** "Notes added": the notes created in the range, and in the period before it. */
export async function readNoteAdded(
  overview: NoteOverviewRepository,
  request: NoteWidgetRequest,
): Promise<CountWidgetResult> {
  const periods = noteWidgetPeriods(request)
  return {
    current: await overview.added(request.groupId, periods.current, request.timeZone),
    previous: await comparable(overview, request, periods)
      ? await overview.added(request.groupId, periods.previous, request.timeZone)
      : null,
  }
}

/** "Notes over time": the daily totals of the range, and of the period before it. */
export async function readNoteSeries(
  overview: NoteOverviewRepository,
  request: NoteWidgetRequest,
): Promise<SeriesWidgetResult> {
  const periods = noteWidgetPeriods(request)
  return {
    days: daysOf(periods.current),
    current: await overview.dailyTotals(request.groupId, periods.current, request.timeZone),
    previous: await comparable(overview, request, periods)
      ? await overview.dailyTotals(request.groupId, periods.previous, request.timeZone)
      : null,
  }
}

/**
 * Each note widget's reader, by widget id. The member's handlers below and the operator area's
 * route (`routes/admin/groups.ts`) both read through these; each decides first who may.
 */
export const NOTE_WIDGET_READERS: Readonly<
  Record<
    string,
    (overview: NoteOverviewRepository, request: NoteWidgetRequest) => Promise<unknown>
  >
> = {
  [NOTE_WIDGET_IDS.total]: readNoteTotal,
  [NOTE_WIDGET_IDS.added]: readNoteAdded,
  [NOTE_WIDGET_IDS.series]: readNoteSeries,
}

/**
 * A handler that makes the notes list's check first: every member reads, and a person who is not
 * a member is told the group does not exist, before anything is read.
 */
function forMembers<R>(
  { overview, groups }: NoteWidgetHandlerDependencies,
  read: (overview: NoteOverviewRepository, request: NoteWidgetRequest) => Promise<R>,
) {
  return async ({ data }: { data: NoteWidgetPayload }): Promise<R> => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const { actor: _actor, ...request } = data
    return await read(overview, request)
  }
}

export function createNoteTotalWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteTotalWidgetQuery> {
  return forMembers(dependencies, readNoteTotal)
}

export function createNoteAddedWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteAddedWidgetQuery> {
  return forMembers(dependencies, readNoteAdded)
}

export function createNoteSeriesWidgetHandler(
  dependencies: NoteWidgetHandlerDependencies,
): QueryHandler<NoteSeriesWidgetQuery> {
  return forMembers(dependencies, readNoteSeries)
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
