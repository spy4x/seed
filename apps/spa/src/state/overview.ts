import { signal } from "@preact/signals"
import type { DateRange } from "@spy4x/time/date"
import type { WidgetDefinition } from "@domain/groups"
import type { OverviewWidgetLoad } from "@ui/overview-screen.tsx"
import { callQuery, type LocalReads, localReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"

/** What the overview store needs from the outside. Injected so tests need no socket. */
export interface OverviewDependencies {
  /** Sends a widget's query operation; rejects when the server refuses or cannot be reached. */
  query<T>(name: string, payload: unknown): Promise<T>
}

/** What the overview shows: one group, one range of days, cut in one zone. */
export interface OverviewRequest {
  groupId: string
  range: DateRange
  timeZone: string
}

/**
 * The widgets of the overview that is open. Each widget reads on its own, so one slow or failing
 * widget never holds the others back. An answer for a request the page has moved on from (another
 * group or range), or for an older read of the same widget, is dropped.
 *
 * The device keeps each widget's last answer per group and range: when the server cannot be
 * reached, that copy answers, with the time it was saved (`savedAt`).
 */
export function createOverviewStore(
  dependencies: OverviewDependencies,
  device: LocalReads = noLocalReads,
) {
  const loads = signal<Readonly<Record<string, OverviewWidgetLoad>>>({})
  let request: OverviewRequest | null = null
  let requestKey = ""
  let widgets: readonly WidgetDefinition[] = []
  const reads = new Map<string, number>()

  function set(id: string, load: OverviewWidgetLoad): void {
    loads.value = { ...loads.value, [id]: load }
  }

  async function load(widget: WidgetDefinition): Promise<void> {
    const asked = request
    if (!asked) return
    const read = (reads.get(widget.id) ?? 0) + 1
    reads.set(widget.id, read)
    const current = () => request === asked && reads.get(widget.id) === read
    set(widget.id, { status: "loading" })
    const payload = {
      groupId: asked.groupId,
      from: asked.range.from,
      to: asked.range.to,
      timeZone: asked.timeZone,
    }
    try {
      const answer = await device.through(
        READ_KEYS.overviewWidget(asked.groupId, widget.id, requestKey),
        () => dependencies.query<unknown>(widget.operation, payload),
      )
      if (!current()) return
      set(widget.id, {
        status: "ready",
        data: answer.value,
        savedAt: answer.fresh ? null : answer.savedAt,
      })
    } catch (_error) {
      if (current()) set(widget.id, { status: "error" })
    }
  }

  /**
   * Shows `next` with `shown`, the widgets on screen. The same request again reads only the widgets
   * that have no answer yet, such as one the person just showed again.
   */
  function open(next: OverviewRequest, shown: readonly WidgetDefinition[]): void {
    widgets = shown
    const key = `${next.range.from}:${next.range.to}:${next.timeZone}`
    if (request?.groupId === next.groupId && key === requestKey) {
      for (const widget of shown) if (!loads.value[widget.id]) void load(widget)
      return
    }
    request = next
    requestKey = key
    loads.value = {}
    for (const widget of shown) void load(widget)
  }

  /** Reads one widget again: its "Try again". */
  function retry(id: string): void {
    const widget = widgets.find((candidate) => candidate.id === id)
    if (widget) void load(widget)
  }

  /** Forgets the request, so the next `open` reads everything: after sign-out, say. */
  function reset(): void {
    request = null
    requestKey = ""
    loads.value = {}
  }

  return { loads, open, retry, reset }
}

/** The overview's widgets over the socket (or `POST /api/call`) and the device's copies. */
export const overviewStore = createOverviewStore(
  { query: (name, payload) => callQuery(name, payload) },
  localReads,
)
