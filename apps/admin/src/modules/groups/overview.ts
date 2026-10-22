import { signal } from "@preact/signals"
import type { DateRange } from "@spy4x/time/date"
import type { OverviewWidgetLoad } from "@ui/overview-screen.tsx"
import { OVERVIEW_WIDGETS } from "@ui/overview-widgets.ts"
import type { AdminFetch } from "../../state.ts"

/** The group, the days and the zone the admin group page's widgets show. */
export interface AdminOverviewRequest {
  groupId: string
  range: DateRange
  timeZone: string
}

/** Where the API answers one widget of a group: `GET /api/admin/groups/:id/widgets/:widgetId`. */
export function adminWidgetPath(widgetId: string, request: AdminOverviewRequest): string {
  const query = new URLSearchParams({
    from: request.range.from,
    to: request.range.to,
    timeZone: request.timeZone,
  })
  return `/api/admin/groups/${encodeURIComponent(request.groupId)}/widgets/${
    encodeURIComponent(widgetId)
  }?${query}`
}

/**
 * The admin group page's "Overview widgets": every widget in the default layout, each read on its
 * own. An answer for a request the page has moved on from is dropped.
 */
export function createAdminOverviewState(request: AdminFetch) {
  const loads = signal<Readonly<Record<string, OverviewWidgetLoad>>>({})
  let current: AdminOverviewRequest | null = null

  async function load(widgetId: string, asked: AdminOverviewRequest): Promise<void> {
    loads.value = { ...loads.value, [widgetId]: { status: "loading" } }
    let next: OverviewWidgetLoad
    try {
      const answer = await request<unknown>(adminWidgetPath(widgetId, asked))
      next = answer.ok ? { status: "ready", data: answer.data, savedAt: null } : { status: "error" }
    } catch (_error) {
      next = { status: "error" }
    }
    if (current === asked) loads.value = { ...loads.value, [widgetId]: next }
  }

  /** Reads every widget for `next`. */
  function open(next: AdminOverviewRequest): void {
    current = next
    loads.value = {}
    for (const widget of OVERVIEW_WIDGETS) void load(widget.id, next)
  }

  /** Reads one widget again: its "Try again". */
  function retry(widgetId: string): void {
    if (current) void load(widgetId, current)
  }

  return { loads, open, retry }
}
