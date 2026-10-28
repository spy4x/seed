import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconTrendingUp } from "@spy4x/preact-icons"
import {
  WEBSITE_STATS_DEFAULT_PERIOD,
  type WebsiteStatsPeriod,
  websiteStatsPeriod,
} from "@domain/identity"
import { ADMIN_STATS_PATH, AdminStatsScreen } from "@ui/admin-stats-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { createStatsState, type StatsModuleState } from "./state.ts"

/** One Stats state per signed-in session, so a return to the page shows the last numbers at once. */
const states = new WeakMap<AdminContext, StatsModuleState>()

function statsState(context: AdminContext): StatsModuleState {
  let state = states.get(context)
  if (!state) {
    state = createStatsState(context.request)
    states.set(context, state)
  }
  return state
}

/** The address of a period and a chart source; the default period stays out of it. */
function statsHref(days: WebsiteStatsPeriod, source: string | null): string {
  const query = new URLSearchParams()
  if (days !== WEBSITE_STATS_DEFAULT_PERIOD) query.set(`days`, String(days))
  if (source) query.set(`source`, source)
  const text = query.toString()
  return text ? `${ADMIN_STATS_PATH}?${text}` : ADMIN_STATS_PATH
}

/** The Stats page. Its period and chart source live in the address, so back and forward work. */
function StatsView({ context }: { context: AdminContext }): JSX.Element {
  const state = statsState(context)
  const search = useSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const days = websiteStatsPeriod(params.get(`days`))
  const source = params.get(`source`) || null
  useEffect(() => {
    state.load({ days, source })
  }, [state, days, source])
  const { response, pending, error } = state.stats.value
  return (
    <AdminStatsScreen
      days={days}
      source={source}
      response={response}
      pending={pending}
      error={error}
      onPeriod={(next) => context.navigate(statsHref(next, source))}
      onSource={(next) => context.navigate(statsHref(days, next))}
      onRefresh={(fresh) => state.load({ days, source, fresh })}
      navigate={context.navigate}
    />
  )
}

/** The website's numbers from Umami (#485): visits, sources, items and order channels. */
export const statsModule: AdminModule = {
  id: `stats`,
  nav: { name: `AdminNav.stats`, href: ADMIN_STATS_PATH, Icon: IconTrendingUp },
  routes: [{ path: ADMIN_STATS_PATH, View: StatsView }],
}
