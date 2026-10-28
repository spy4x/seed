import type { JSX } from "preact"
import { useEffect, useState } from "preact/hooks"
import { IconHome } from "@spy4x/preact-icons"
import type { AdminStats } from "@domain/identity"
import { ADMIN_PATHS } from "@ui/admin-frame.tsx"
import { AdminDashboardScreen } from "@ui/admin-dashboard-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"

/** The numbers, read from `GET /api/admin/stats` each time the page opens. */
function DashboardView({ context }: { context: AdminContext }): JSX.Element {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    setError(null)
    const result = await context.request<AdminStats>(`/api/admin/stats`)
    if (result.ok) setStats(result.data)
    else setError(result.error.message)
  }

  useEffect(() => {
    load()
  }, [context])

  return <AdminDashboardScreen stats={stats} error={error} onRetry={load} />
}

/** The operator area's first page (#424): stat cards and two 30-day charts. */
export const dashboardModule: AdminModule = {
  id: `dashboard`,
  nav: { name: `AdminNav.dashboard`, href: ADMIN_PATHS.dashboard, Icon: IconHome },
  routes: [{ path: ADMIN_PATHS.dashboard, View: DashboardView }],
}
