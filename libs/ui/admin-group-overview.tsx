import type { JSX } from "preact"
import { operatorWidgets, type WidgetOperatorView } from "@domain/groups"
import type { DateRangeChoice } from "@spy4x/preact-ui/date-range-search"
import { OverviewGrid, OverviewRangeRow, type OverviewWidget } from "./overview-screen.tsx"
import type { WidgetView } from "./note-widgets.tsx"
import { useAdminText } from "./i18n.ts"

export interface AdminGroupOverviewProps {
  /** The group's name, for the grid's accessible name. */
  groupName: string
  range: DateRangeChoice
  timeZone: string
  /** The operator's own zone: when it is another, the range line names the group's city. */
  viewerTimeZone?: string
  now: Date
  onRangeChange: (choice: DateRangeChoice) => void
  /**
   * Every widget, in the default layout, each with its `operatorView`: only the `counts` ones are
   * drawn, and a line under them says the rest are for members.
   */
  widgets: readonly AdminOverviewWidget[]
  views: Readonly<Record<string, WidgetView>>
  onRetry: (id: string) => void
}

/** One widget of the admin group page, and whether the operator may see it. */
export interface AdminOverviewWidget extends OverviewWidget {
  operatorView: WidgetOperatorView
}

/**
 * The admin group page's read-only "Overview widgets" section: the widgets a member's
 * Overview page shows, in the default layout, with a range picker of its own. Nothing to hide or
 * reorder, and never a member's own layout. A widget that shows the group's own figures
 * (`operatorView: "never"`) is not drawn: a line under the cards says so, and when none is
 * left the section keeps only its title and that reason.
 */
export function AdminGroupOverview(props: AdminGroupOverviewProps): JSX.Element {
  const t = useAdminText()
  const shown = operatorWidgets(props.widgets)
  if (shown.length === 0) {
    return (
      <section
        aria-labelledby="admin-group-overview-title"
        class="flex flex-col gap-1"
        data-e2e="admin-group-overview"
      >
        <h2 id="admin-group-overview-title" class="text-base font-semibold">
          {t.t(`AdminGroupOverview.title`)}
        </h2>
        <p class="text-sm text-muted" data-e2e="admin-group-overview-members-only">
          {t.t(`AdminGroupOverview.noneShown`)}
        </p>
      </section>
    )
  }
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
        viewerTimeZone={props.viewerTimeZone}
        now={props.now}
        onRangeChange={props.onRangeChange}
        dataE2E="admin-group-overview-range"
      />
      <OverviewGrid
        label={t.t(`AdminGroupOverview.gridLabel`, { group: props.groupName })}
        widgets={shown}
        views={props.views}
        range={props.range}
        timeZone={props.timeZone}
        now={props.now}
        onRetry={props.onRetry}
      />
      {shown.length < props.widgets.length && (
        <p class="text-sm text-muted" data-e2e="admin-group-overview-members-only">
          {t.t(`AdminGroupOverview.membersOnly`)}
        </p>
      )}
    </section>
  )
}
