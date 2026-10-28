import type { ComponentChildren } from "preact"
import { changeText } from "@spy4x/preact-charts/change"
import { LineChart } from "@spy4x/preact-charts/line-chart"
import { niceStep, ticks } from "@spy4x/preact-charts/scales"
import { WidgetStat } from "@spy4x/preact-ui/widget-card"
import type { Formatters } from "@spy4x/time/format"
import type { Translator } from "@spy4x/platform/universal/i18n"
import type { CountWidgetResult, OverviewPeriods, SeriesWidgetResult } from "@domain/groups"
import { NOTE_WIDGET_IDS } from "@domain/notes"
import { useAppText } from "./i18n.ts"

/** What a widget's drawing knows besides its data. */
export interface WidgetDrawContext {
  periods: OverviewPeriods
  /** Whether the range ends today, so "now" is true of its last day. */
  endsToday: boolean
  /** Dates and numbers in the person's settings. */
  format: Formatters
  /**
   * Calendar days in UTC with the month names in the person's language, as the overview's range
   * line writes them. Left out, the region format's, in UTC.
   */
  days?: Formatters
}

/** A widget drawn from its data: what its card shows when the data has arrived. */
export interface WidgetDrawing {
  /** `empty` shows the words of `emptyKey` in place of the content. */
  status: "ready" | "empty"
  caption?: ComponentChildren
  content?: ComponentChildren
  /** The `app` catalog key of what an empty widget says. */
  emptyKey?: string
}

/**
 * How the overview draws one widget. Its caption and content translate themselves when drawn;
 * the card's own lines (loading, failing, empty) are strings the card shows as given, so they come
 * as keys of the `app` catalog that the overview translates.
 */
export interface WidgetView {
  loadingKey: string
  errorKey: string
  draw(data: unknown, context: WidgetDrawContext): WidgetDrawing
}

/**
 * Draws `children` with the words of the person's language. A widget is drawn by a function the
 * overview calls, not by a component, so its words are read here, where a hook may run.
 */
function Words(
  { children }: { children: (t: Translator<string>) => ComponentChildren },
): ComponentChildren {
  return children(useAppText())
}

/**
 * The chart's Y axis for counts up to `top`: a domain whose top is itself a tick, so no tick or
 * gridline is drawn above the plot, and whole-number steps only. Uses the chart's own `ticks`, so
 * the steps here are the steps it draws.
 */
export function countAxis(top: number): { max: number; steps: number } {
  const high = Math.max(1, Math.ceil(top))
  for (let steps = 5; steps >= 1; steps--) {
    // The chart picks its step from the domain's span, so a top rounded up to one step may get a
    // coarser step: round again to that one until the two agree (two or three rounds at most).
    let step = niceStep(high, steps)
    for (let round = 0; round < 8 && Number.isInteger(step); round++) {
      const max = Math.ceil(high / step) * step
      const drawn = ticks(0, max, steps)
      if (drawn.at(-1) === max && drawn.every((tick) => Number.isInteger(tick))) {
        return { max, steps }
      }
      step = niceStep(max, steps)
    }
  }
  return { max: high, steps: 1 }
}

/** "previous 30 days", "previous day": the period a comparison names. */
export function previousPeriodName(t: Translator<string>, days: number): string {
  return t.t(`NoteWidgets.previousPeriod`, { count: days })
}

/** A calendar day (`YYYY-MM-DD`) as the context writes days, without moving it by zone. */
function day(
  { format, days }: WidgetDrawContext,
  iso: string,
  withYear = false,
): string {
  const at = `${iso}T00:00:00Z`
  const utc = days ?? format.utc()
  return withYear ? utc.date(at) : utc.dayMonth(at)
}

/** The comparison line of a number widget, or nothing when the group is too young for one. */
function comparison(
  result: CountWidgetResult,
  { periods, format }: WidgetDrawContext,
  t: Translator<string>,
): ComponentChildren[] {
  if (result.previous === null) return []
  return [
    changeText(
      { current: result.current, previous: result.previous },
      previousPeriodName(t, periods.days),
      format.locale,
      t,
    ),
  ]
}

const total: WidgetView = {
  loadingKey: `NoteWidgets.totalLoading`,
  errorKey: `NoteWidgets.totalError`,
  draw(data, context) {
    const { periods, endsToday, format } = context
    const result = data as CountWidgetResult
    return {
      status: "ready",
      caption: (
        <Words>
          {(t) =>
            endsToday
              ? t.t(`NoteWidgets.totalNow`)
              : t.t(`NoteWidgets.totalOn`, { date: day(context, periods.current.to, true) })}
        </Words>
      ),
      content: (
        <Words>
          {(t) => (
            <WidgetStat
              value={format.number(result.current)}
              lines={comparison(result, context, t)}
            />
          )}
        </Words>
      ),
    }
  },
}

const added: WidgetView = {
  loadingKey: `NoteWidgets.addedLoading`,
  errorKey: `NoteWidgets.addedError`,
  draw(data, context) {
    const { format } = context
    const result = data as CountWidgetResult
    return {
      status: "ready",
      caption: (
        <Words>
          {(t) =>
            result.current === 0 ? t.t(`NoteWidgets.addedNone`) : t.t(`NoteWidgets.addedSome`)}
        </Words>
      ),
      content: (
        <Words>
          {(t) => (
            <WidgetStat
              value={format.number(result.current)}
              lines={comparison(result, context, t)}
            />
          )}
        </Words>
      ),
    }
  },
}

/** The series chart's one-line summary: where the count started and where it ended. */
function seriesSummary(t: Translator<string>, format: Formatters, current: number[]): string {
  const first = current[0] ?? 0
  const last = current.at(-1) ?? 0
  return first === last
    ? t.t(`NoteWidgets.seriesFlat`, { value: format.number(last) })
    : t.t(`NoteWidgets.seriesFrom`, { first: format.number(first), last: format.number(last) })
}

const series: WidgetView = {
  loadingKey: `NoteWidgets.seriesLoading`,
  errorKey: `NoteWidgets.seriesError`,
  draw(data, context) {
    const { periods, format } = context
    const result = data as SeriesWidgetResult
    const values = [...result.current, ...(result.previous ?? [])]
    if (values.every((value) => value === 0)) {
      return { status: "empty", emptyKey: `NoteWidgets.seriesEmpty` }
    }
    const axis = countAxis(Math.max(...values))
    return {
      status: "ready",
      caption: <Words>{(t) => seriesSummary(t, format, result.current)}</Words>,
      content: (
        <Words>
          {(t) => (
            <LineChart
              series={[
                {
                  name: t.t(`NoteWidgets.seriesCurrent`),
                  points: result.days.map((x, i) => ({ x, y: result.current[i] })),
                  showPoints: result.days.length <= 31,
                },
                ...(result.previous
                  ? [{
                    name: t.t(`NoteWidgets.seriesPrevious`, { count: periods.days }),
                    points: result.days.map((x, i) => ({ x, y: result.previous![i] })),
                    dashed: true,
                    showPoints: false,
                    color: "var(--color-muted-foreground)",
                  }]
                  : []),
              ]}
              height={220}
              yDomain={[0, axis.max]}
              yTicks={axis.steps}
              xFormat={(x) =>
                day(context, typeof x === "string" ? x : x.toISOString().slice(0, 10))}
              yFormat={(value) => format.number(value)}
              ariaLabel={t.t(`NoteWidgets.seriesLabel`, {
                summary: seriesSummary(t, format, result.current),
              })}
              xLabel={t.t(`NoteWidgets.seriesDay`)}
              showLegend={result.previous !== null}
            />
          )}
        </Words>
      ),
    }
  },
}

/** How the overview draws each of the notes' widgets, by widget id. */
export const NOTE_WIDGET_VIEWS: Readonly<Record<string, WidgetView>> = {
  [NOTE_WIDGET_IDS.total]: total,
  [NOTE_WIDGET_IDS.added]: added,
  [NOTE_WIDGET_IDS.series]: series,
}
