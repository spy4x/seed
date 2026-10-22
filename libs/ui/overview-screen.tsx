import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DateRangePicker, type DateRangePresetOption } from "@spy4x/preact-ui/date-range-picker"
import type { DateRangeChoice } from "@spy4x/preact-ui/date-range-search"
import { type DateRangePreset, rangeForPreset } from "@spy4x/preact-ui/date-range"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { useFormat } from "@spy4x/preact-ui/format"
import {
  LayoutCustomiser,
  type LayoutCustomiserItem,
  type LayoutEntry,
} from "@spy4x/preact-ui/layout-customiser"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { DashboardGrid, WidgetCard, type WidgetSize } from "@spy4x/preact-ui/widget-card"
import type { Formatters } from "@spy4x/time/format"
import { type OverviewPeriods, overviewPeriods } from "@domain/groups"
import type { WidgetView } from "./note-widgets.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"

/** The ranges the overview offers, in the picker's order. "Last 30 days" is the default. */
export const OVERVIEW_PRESETS: readonly DateRangePresetOption[] = [
  { preset: "last-7-days", label: "Last 7 days" },
  { preset: "last-30-days", label: "Last 30 days" },
  { preset: "last-90-days", label: "Last 90 days" },
  { preset: "last-12-months", label: "Last 12 months" },
  { preset: "this-month", label: "This month" },
  { preset: "last-month", label: "Last month" },
  { preset: "custom", label: "Custom…" },
]

/** The range an address without one shows. */
export const OVERVIEW_DEFAULT_PRESET = "last-30-days" satisfies Exclude<DateRangePreset, "custom">

/** Where one widget's data stands. `savedAt` is set when the data is the device's saved copy. */
export type OverviewWidgetLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: unknown; savedAt: number | null }

/** One widget the overview draws, in the person's order. */
export interface OverviewWidget {
  id: string
  title: string
  size: WidgetSize
  load: OverviewWidgetLoad
}

/** The group the overview is about. */
export interface OverviewGroup {
  id: string
  name: string
}

export interface OverviewScreenProps {
  /** `null` while the group is not known yet (loading), or when the person is not a member. */
  group: OverviewGroup | null
  /** The groups are still loading, so a missing group may yet turn up. */
  loading: boolean
  /** The range shown and the preset that chose it. */
  range: DateRangeChoice
  /** The zone whose days the picker's presets count. */
  timeZone: string
  /** The clock the presets and "now" read; tests pass a fixed one. */
  now: Date
  onRangeChange: (choice: DateRangeChoice) => void
  /** The widgets to draw, the hidden ones left out, in the person's order. */
  widgets: readonly OverviewWidget[]
  /** How each widget is drawn, by id. */
  views: Readonly<Record<string, WidgetView>>
  onRetry: (id: string) => void
  onHide: (id: string) => void
  /** Every widget the person's role sees, hidden ones included, for the Customise dialog. */
  layout: readonly LayoutCustomiserItem[]
  customising: boolean
  onCustomise: () => void
  onCloseCustomise: () => void
  /** A change in the Customise dialog, saved as it is made. */
  onLayoutChange: (layout: LayoutEntry[]) => void
  onResetLayout: () => void
  /** Why the last layout change was not saved. */
  layoutError?: string | null
  onCopyLink: () => void
  /**
   * The group has no notes: a first-run card names what fills the page. `canCreate` offers the
   * "New note" button.
   */
  emptyGroup?: { canCreate: boolean } | null
  /** `data-e2e` of the range picker's button, so the page's `d` key can open it. */
  rangeDataE2E?: string
  navigate?: Navigate
}

/** "22 Sep – 21 Oct, compared with the 30 days before": the days the widgets count. */
export function periodLine(periods: OverviewPeriods, format: Formatters): string {
  const { from, to } = periods.current
  const utc = format.utc()
  const at = (iso: string) => `${iso}T00:00:00Z`
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const start = sameYear ? utc.dayMonth(at(from)) : utc.date(at(from))
  const end = sameYear ? utc.dayMonth(at(to)) : utc.date(at(to))
  const days = from === to ? start : `${start} – ${end}`
  const before = periods.days === 1 ? "the day before" : `the ${periods.days} days before`
  return `${days}, compared with ${before}`
}

/** The calendar day `now` falls on in `timeZone`, `YYYY-MM-DD`. */
function today(now: Date, timeZone: string): string {
  return rangeForPreset("today", { now, timeZone }).to
}

/**
 * A group's overview: key numbers and a chart for a range of days, each widget loading, failing
 * and going empty on its own. The range picker sits in its own row with a line naming the exact
 * days and what they are compared with. Each person hides and reorders the widgets: from a card's
 * menu, or in the "Customise overview" dialog, which saves each change as it is made.
 */
export function OverviewScreen(props: OverviewScreenProps): JSX.Element {
  const { group, navigate } = props
  // After "Hide widget" the card is gone: focus moves to the card now in its place, the one before
  // it when it was the last, or the "Customise overview" button when none is left.
  const page = useRef<HTMLDivElement>(null)
  const hidden = useRef<number | null>(null)
  useEffect(() => {
    const index = hidden.current
    if (index === null || !page.current) return
    hidden.current = null
    const cards = page.current.querySelectorAll<HTMLElement>("[data-widget-status]")
    const next = cards[Math.min(index, cards.length - 1)] ??
      page.current.querySelector<HTMLElement>("[data-e2e=overview-all-hidden-customise]")
    next?.focus()
  }, [props.widgets.length])
  const hide = (id: string) => {
    hidden.current = props.widgets.findIndex((widget) => widget.id === id)
    props.onHide(id)
  }
  return (
    <div ref={page}>
      <Stack gap="xl">
        <PageHeader
          title="Overview"
          subtitle={group?.name}
          subtitleDataE2E="overview-group"
          navigate={navigate}
          menuDataE2E="overview-menu"
          menu={group && (
            <>
              <DropdownItem onClick={props.onCustomise} dataE2E="overview-customise">
                Customise overview
              </DropdownItem>
              <DropdownItem onClick={props.onResetLayout} dataE2E="overview-reset">
                Reset layout
              </DropdownItem>
              <DropdownItem onClick={props.onCopyLink} dataE2E="overview-copy-link">
                Copy link to this view
              </DropdownItem>
            </>
          )}
        />
        {!group
          ? (
            <Card>
              <EmptyState
                headingLevel={2}
                inset
                title={props.loading ? "Loading the group…" : "This group does not exist."}
                action={!props.loading && (
                  <Button
                    href={SCREEN_PATHS.groups}
                    navigate={navigate}
                    variant="outline"
                    class="min-h-11 sm:min-h-9"
                  >
                    Back to groups
                  </Button>
                )}
              />
            </Card>
          )
          : (
            <>
              <OverviewRangeRow
                range={props.range}
                timeZone={props.timeZone}
                now={props.now}
                onRangeChange={props.onRangeChange}
                dataE2E={props.rangeDataE2E}
              />
              {props.emptyGroup && (
                <Card data-e2e="overview-empty-group">
                  <EmptyState
                    headingLevel={2}
                    inset
                    title={`No notes in ${group.name} yet`}
                    description="The overview fills in as people in the group add notes."
                    action={props.emptyGroup.canCreate && (
                      // A labelled button, not the header's PageAction, which shrinks to an icon
                      // on a phone.
                      <Button
                        href={NOTE_PATHS.new}
                        navigate={navigate}
                        variant="outline"
                        class="min-h-11 sm:min-h-9"
                        data-e2e="overview-new-note"
                      >
                        New note
                      </Button>
                    )}
                  />
                </Card>
              )}
              {props.widgets.length === 0
                ? (
                  <Card data-e2e="overview-all-hidden">
                    <EmptyState
                      headingLevel={2}
                      inset
                      title="All widgets are hidden"
                      description="Choose the ones you want to see."
                      action={
                        <Button
                          variant="outline"
                          class="min-h-11 sm:min-h-9"
                          onClick={props.onCustomise}
                          data-e2e="overview-all-hidden-customise"
                        >
                          Customise overview
                        </Button>
                      }
                    />
                  </Card>
                )
                : (
                  <OverviewGrid
                    label={`Overview of ${group.name}`}
                    widgets={props.widgets}
                    views={props.views}
                    range={props.range}
                    timeZone={props.timeZone}
                    now={props.now}
                    onRetry={props.onRetry}
                    onHide={hide}
                  />
                )}
            </>
          )}
        <LayoutCustomiser
          open={props.customising}
          onClose={props.onCloseCustomise}
          title="Customise overview"
          description="Choose which widgets you see and their order. The layout is yours and follows you to your other devices."
          items={props.layout}
          onChange={props.onLayoutChange}
          onReset={props.onResetLayout}
          error={props.layoutError}
          labels={{ list: "Widgets" }}
          dataE2E="overview-customiser"
        />
      </Stack>
    </div>
  )
}

/** What {@link OverviewRangeRow} takes. */
export interface OverviewRangeRowProps {
  range: DateRangeChoice
  timeZone: string
  now: Date
  onRangeChange: (choice: DateRangeChoice) => void
  /** `data-e2e` of the picker's button. Defaults to `"overview-range"`. */
  dataE2E?: string
}

/**
 * The range picker in its own row, with the muted line that names the exact days and what they are
 * compared with, or asks for a shorter range.
 */
export function OverviewRangeRow(props: OverviewRangeRowProps): JSX.Element {
  const format = useFormat()
  const periods = overviewPeriods(props.range.range)
  const preset = OVERVIEW_PRESETS.find((option) => option.preset === props.range.preset)
  return (
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <DateRangePicker
        // The picker takes a class for its root only; its trigger is the root's one direct button.
        // 44 px tall on a phone, the house touch target, 36 px from `sm` like the other controls.
        class="[&>button]:min-h-11 sm:[&>button]:min-h-9"
        range={props.range.range}
        selectedPreset={props.range.preset}
        presets={OVERVIEW_PRESETS}
        timeZone={props.timeZone}
        now={props.now}
        onChange={(range, chosen) => props.onRangeChange({ range, preset: chosen })}
        formatRange={() =>
          preset && preset.preset !== "custom"
            ? preset.label
            : periods
            ? periodLine(periods, format).split(",")[0]
            : "Custom range"}
        dataE2E={props.dataE2E ?? "overview-range"}
      />
      <p class="text-sm text-muted" data-e2e="overview-period">
        {periods ? periodLine(periods, format) : "Choose a range of a year or less."}
      </p>
    </div>
  )
}

/** What {@link OverviewGrid} takes. */
export interface OverviewGridProps {
  /** The grid's name for a screen reader, such as "Overview of Acme Studio". */
  label: string
  widgets: readonly OverviewWidget[]
  views: Readonly<Record<string, WidgetView>>
  range: DateRangeChoice
  timeZone: string
  now: Date
  onRetry: (id: string) => void
  /** Offers "Hide widget" in each card's menu. Left out, the cards have no menu. */
  onHide?: (id: string) => void
}

/** The widgets' cards in their order: numbers share a row, a chart takes one. Nothing for a bad range. */
export function OverviewGrid(props: OverviewGridProps): JSX.Element | null {
  const format = useFormat()
  const periods = overviewPeriods(props.range.range)
  if (!periods) return null
  const endsToday = periods.current.to === today(props.now, props.timeZone)
  const { onHide } = props
  return (
    <DashboardGrid
      label={props.label}
      items={props.widgets.map((widget) => ({
        id: widget.id,
        size: widget.size,
        content: (
          <OverviewWidgetCard
            widget={widget}
            view={props.views[widget.id]}
            periods={periods}
            endsToday={endsToday}
            format={format}
            onRetry={() => props.onRetry(widget.id)}
            onHide={onHide && (() => onHide(widget.id))}
          />
        ),
      }))}
    />
  )
}

/** One widget's card: its state from the load, its drawing from the view. */
function OverviewWidgetCard(
  { widget, view, periods, endsToday, format, onRetry, onHide }: {
    widget: OverviewWidget
    view: WidgetView
    periods: OverviewPeriods
    endsToday: boolean
    format: Formatters
    onRetry: () => void
    onHide?: () => void
  },
): JSX.Element {
  const { load } = widget
  const drawing = load.status === "ready"
    ? view.draw(load.data, { periods, endsToday, format })
    : null
  const savedAt = load.status === "ready" ? load.savedAt : null
  return (
    <WidgetCard
      title={widget.title}
      // An empty chart is one line: it takes a number's height, not the chart's.
      size={drawing?.status === "empty" ? "stat" : widget.size}
      status={drawing ? drawing.status : load.status === "error" ? "error" : "loading"}
      caption={savedAt === null ? drawing?.caption : `As of ${format.time(savedAt)}`}
      loadingLabel={view.loadingLabel}
      errorMessage={view.errorMessage}
      onRetry={onRetry}
      emptyLabel={drawing?.emptyLabel}
      menu={onHide && (
        <DropdownItem onClick={onHide} dataE2E="overview-widget-hide">
          Hide widget
        </DropdownItem>
      )}
      dataE2E={`overview-widget-${widget.id}`}
    >
      {drawing?.content}
    </WidgetCard>
  )
}
