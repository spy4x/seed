import { signal } from "@preact/signals"
import type { WebsiteStatsPeriod, WebsiteStatsResponse } from "@domain/identity"
import type { AdminFetch } from "../../state.ts"

/** What the Stats page shows: the last answer, kept while the next one loads. */
export interface StatsState {
  response: WebsiteStatsResponse | null
  pending: boolean
  error: string | null
}

/** One read of the Stats screen: its period, its chart's source and whether it skips the cache. */
export interface StatsQuery {
  days: WebsiteStatsPeriod
  source: string | null
  fresh?: boolean
}

/** The API path of `query`. */
export function statsPath({ days, source, fresh }: StatsQuery): string {
  const params = new URLSearchParams({ days: String(days) })
  if (source) params.set(`source`, source)
  if (fresh) params.set(`fresh`, `1`)
  return `/api/admin/website-stats?${params}`
}

/**
 * The Stats module's state. A new read keeps the old numbers on screen, dimmed by `pending`, so a
 * period switch never blanks the page; an answer to a read that a later one replaced is dropped.
 */
export function createStatsState(request: AdminFetch) {
  const stats = signal<StatsState>({ response: null, pending: false, error: null })
  let latest = 0

  return {
    stats,

    async load(query: StatsQuery): Promise<void> {
      const id = ++latest
      stats.value = { ...stats.value, pending: true, error: null }
      const result = await request<WebsiteStatsResponse>(statsPath(query))
      if (id !== latest) return
      stats.value = result.ok
        ? { response: result.data, pending: false, error: null }
        : { ...stats.value, pending: false, error: result.error.message }
    },
  }
}

export type StatsModuleState = ReturnType<typeof createStatsState>
