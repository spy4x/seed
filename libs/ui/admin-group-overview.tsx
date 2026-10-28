import type { JSX } from "preact"
import type { DateRangeChoice } from "@spy4x/preact-ui/date-range-search"
import { OverviewGrid, OverviewRangeRow, type OverviewWidget } from "./overview-screen.tsx"
import type { WidgetView } from "./note-widgets.tsx"
import { useAdminText } from "./i18n.ts"

export interface AdminGroupOverviewProps {
  /** The group's name, for the grid's accessible name. */
  groupName: string
  range: DateRangeChoice
  timeZone: string
  now: Date
  onRangeChange: (choice: DateRangeChoice) => void
  /** Every widget, in the default layout. */
  widgets: readonly OverviewWidget[]
  views: Readonly<Record<string, WidgetView>>
  onRetry: (id: string) => void
}

/**
 * The admin group page's read-only "Overview widgets" section (#219): the widgets a member's
 * Overview page shows, in the default layout, with a range picker of its own. Nothing to hide or
 * reorder, and never a member's own layout.
 */
export function AdminGroupOverview(props: AdminGroupOverviewProps): JSX.Element {
  const t = useAdminText()
  return (
    <section
      aria-labelledby="admin-group-overview-title"
      class="flex flex-col gap-4"
      data-e2e="admin-group-overview"
    >
      <div class="flex flex-col gap-1">
        <h2 id="admin-group-overview-title" class="text-base font-semibold">
          {t.t(`AdminGroupOverview.title`)}
        </h2>
        <p class="text-sm text-muted">{t.t(`AdminGroupOverview.description`)}</p>
      </div>
      <OverviewRangeRow
        range={props.range}
        timeZone={props.timeZone}
        now={props.now}
        onRangeChange={props.onRangeChange}
        dataE2E="admin-group-overview-range"
      />
      <OverviewGrid
        label={t.t(`AdminGroupOverview.gridLabel`, { group: props.groupName })}
        widgets={props.widgets}
        views={props.views}
        range={props.range}
        timeZone={props.timeZone}
        now={props.now}
        onRetry={props.onRetry}
      />
    </section>
  )
}
