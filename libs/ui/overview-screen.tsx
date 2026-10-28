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
import { LayoutCustomiser, type LayoutEntry } from "@spy4x/preact-ui/layout-customiser"
import { Stack } from "@spy4x/preact-ui/layout"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { DashboardGrid, WidgetCard, type WidgetSize } from "@spy4x/preact-ui/widget-card"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import {
  createTranslator,
  type MessageValues,
  type Translator,
} from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import { type OverviewPeriods, overviewPeriods } from "@domain/groups"
import type { WidgetView } from "./note-widgets.tsx"
import { type Navigate, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"
import { useAppText } from "./i18n.ts"

/**
 * The ranges the overview offers, in the picker's order, each with its label's key in the `app`
 * catalog. "Last 30 days" is the default.
 */
export const OVERVIEW_PRESETS: readonly { preset: DateRangePreset; key: string }[] = [
  { preset: "last-7-days", key: `OverviewScreen.last7Days` },
  { preset: "last-30-days", key: `OverviewScreen.last30Days` },
  { preset: "last-90-days", key: `OverviewScreen.last90Days` },
  { preset: "last-12-months", key: `OverviewScreen.last12Months` },
  { preset: "this-month", key: `OverviewScreen.thisMonth` },
  { preset: "last-month", key: `OverviewScreen.lastMonth` },
  { preset: "custom", key: `OverviewScreen.custom` },
]

let english: Translator<string> | undefined

/**
 * The words of the overview's range row and grid, which the admin app draws too (the admin group
 * page). Both apps load the `app` catalog; a translator without it, such as an admin screen's in a
 * test, reads these keys in English instead of as the keys themselves.
 */
function useOverviewText(): Translator<string> {
  const t = useAppText()
  const pick = (key: string, values?: MessageValues) =>
    t.t(key, values) !== key
      ? t
      : english ??= createTranslator({ language: `en`, catalogs: [{ source: app }] })
  return {
    language: t.language,
    dir: t.dir,
    t: (key, values) => pick(key, values).t(key, values),
    parts: (key, values) => pick(key, values).parts(key, values),
  }
}

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
  /** The `app` catalog key of the widget's name (`WidgetDefinition.titleKey`). */
  titleKey: string
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
  /**
   * Every widget the person's role sees, hidden ones included, for the Customise dialog, each
   * named by the `app` catalog key of its name.
   */
  layout: readonly (LayoutEntry & { titleKey: string })[]
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

/**
 * The person's formatters, in UTC, with the month names in `language`: the region format's own
 * when it is in that language ("22 Sept" for en-GB in English), else the language's
 * ("22 сент." in Russian, whatever the region).
 */
function inLanguage(format: Formatters, language: string): Formatters {
  const spoken = (tag: string) => {
    try {
      return new Intl.Locale(tag).language
    } catch {
      return tag
    }
  }
  if (spoken(format.locale) === spoken(language)) return format.utc()
  return createFormatters(
    { locale: language, timeZone: `UTC`, hourCycle: null },
    { device: { locale: language, timeZone: `UTC` } },
  )
}

/** "22 Sep – 21 Oct": the days the widgets count, with the month names in `language`. */
export function periodRange(
  periods: OverviewPeriods,
  format: Formatters,
  language: string,
): string {
  const { from, to } = periods.current
  const utc = inLanguage(format, language)
  const at = (iso: string) => `${iso}T00:00:00Z`
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const start = sameYear ? utc.dayMonth(at(from)) : utc.date(at(from))
  const end = sameYear ? utc.dayMonth(at(to)) : utc.date(at(to))
  return from === to ? start : `${start} – ${end}`
}

/** "22 Sep – 21 Oct, compared with the 30 days before": the days counted, and what they are compared with. */
export function periodLine(
  t: Translator<string>,
  periods: OverviewPeriods,
  format: Formatters,
): string {
  return t.t(`OverviewScreen.period`, {
    range: periodRange(periods, format, t.language),
    count: periods.days,
  })
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
  const t = useAppText()
  const hide = (id: string) => {
    hidden.current = props.widgets.findIndex((widget) => widget.id === id)
    props.onHide(id)
  }
  return (
    <div ref={page}>
      <Stack gap="xl">
        <PageHeader
          title={t.t(`OverviewScreen.title`)}
          subtitle={group && <span translate={false}>{group.name}</span>}
          subtitleDataE2E="overview-group"
          navigate={navigate}
          menuDataE2E="overview-menu"
          menu={group && (
            <>
              <DropdownItem onClick={props.onCustomise} dataE2E="overview-customise">
                {t.t(`OverviewScreen.customise`)}
              </DropdownItem>
              <DropdownItem onClick={props.onResetLayout} dataE2E="overview-reset">
                {t.t(`OverviewScreen.reset`)}
              </DropdownItem>
              <DropdownItem onClick={props.onCopyLink} dataE2E="overview-copy-link">
                {t.t(`OverviewScreen.copyLink`)}
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
                title={t.t(props.loading ? `OverviewScreen.loading` : `OverviewScreen.missing`)}
                action={!props.loading && (
                  <Button
                    href={SCREEN_PATHS.groups}
                    navigate={navigate}
                    variant="outline"
                    class="min-h-11 sm:min-h-9"
                  >
                    {t.t(`OverviewScreen.backToGroups`)}
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
                    title={t.t(`OverviewScreen.emptyGroup`, { group: `\u2068${group.name}\u2069` })}
                    description={t.t(`OverviewScreen.emptyGroupText`)}
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
                        {t.t(`OverviewScreen.newNote`)}
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
                      title={t.t(`OverviewScreen.allHidden`)}
                      description={t.t(`OverviewScreen.allHiddenText`)}
                      action={
                        <Button
                          variant="outline"
                          class="min-h-11 sm:min-h-9"
                          onClick={props.onCustomise}
                          data-e2e="overview-all-hidden-customise"
                        >
                          {t.t(`OverviewScreen.customise`)}
                        </Button>
                      }
                    />
                  </Card>
                )
                : (
                  <OverviewGrid
                    label={t.t(`OverviewScreen.gridLabel`, { group: group.name })}
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
          title={t.t(`OverviewScreen.customise`)}
          description={t.t(`OverviewScreen.customiseText`)}
          items={props.layout.map(({ titleKey, ...entry }) => ({ ...entry, title: t.t(titleKey) }))}
          onChange={props.onLayoutChange}
          onReset={props.onResetLayout}
          error={props.layoutError}
          labels={{ list: t.t(`OverviewScreen.widgets`) }}
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
  const t = useOverviewText()
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
        presets={OVERVIEW_PRESETS.map(({ preset, key }): DateRangePresetOption => ({
          preset,
          label: t.t(key),
        }))}
        timeZone={props.timeZone}
        now={props.now}
        onChange={(range, chosen) => props.onRangeChange({ range, preset: chosen })}
        formatRange={() =>
          preset && preset.preset !== "custom"
            ? t.t(preset.key)
            : periods
            ? periodRange(periods, format, t.language)
            : t.t(`OverviewScreen.customRange`)}
        dataE2E={props.dataE2E ?? "overview-range"}
      />
      <p class="text-sm text-muted" data-e2e="overview-period">
        {periods ? periodLine(t, periods, format) : t.t(`OverviewScreen.rangeTooLong`)}
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
  const t = useOverviewText()
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
            t={t}
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
  { widget, view, periods, endsToday, format, t, onRetry, onHide }: {
    widget: OverviewWidget
    view: WidgetView
    periods: OverviewPeriods
    endsToday: boolean
    format: Formatters
    t: Translator<string>
    onRetry: () => void
    onHide?: () => void
  },
): JSX.Element {
  const { load } = widget
  const drawing = load.status === "ready"
    ? view.draw(load.data, { periods, endsToday, format, days: inLanguage(format, t.language) })
    : null
  const savedAt = load.status === "ready" ? load.savedAt : null
  return (
    <WidgetCard
      title={t.t(widget.titleKey)}
      // An empty chart is one line: it takes a number's height, not the chart's.
      size={drawing?.status === "empty" ? "stat" : widget.size}
      status={drawing ? drawing.status : load.status === "error" ? "error" : "loading"}
      caption={savedAt === null
        ? drawing?.caption
        : t.t(`OverviewScreen.asOf`, { time: format.time(savedAt) })}
      loadingLabel={t.t(view.loadingKey)}
      errorMessage={t.t(view.errorKey)}
      onRetry={onRetry}
      emptyLabel={drawing?.emptyKey && t.t(drawing.emptyKey)}
      menu={onHide && (
        <DropdownItem onClick={onHide} dataE2E="overview-widget-hide">
          {t.t(`OverviewScreen.hide`)}
        </DropdownItem>
      )}
      dataE2E={`overview-widget-${widget.id}`}
    >
      {drawing?.content}
    </WidgetCard>
  )
}
