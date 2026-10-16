import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { IconServer } from "@spy4x/preact-icons"
import { AdminSystemScreen } from "@ui/admin-system-screen.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { createSystemState, type SystemState } from "./state.ts"

/** The System page. */
export const SYSTEM_PATH = `/system`

/** One System state per signed-in session. */
const states = new WeakMap<AdminContext, SystemState>()

function systemState(context: AdminContext): SystemState {
  let state = states.get(context)
  if (!state) {
    state = createSystemState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

/** The stack's health, read each time the page opens and on "Check again". */
function SystemView({ context }: { context: AdminContext }): JSX.Element {
  const state = systemState(context)
  useEffect(() => {
    state.refresh()
    return () => state.closeRetry()
  }, [state])
  const read = state.read.value
  const retry = state.retry.value
  return (
    <AdminSystemScreen
      snapshot={read.snapshot}
      error={read.error}
      pending={read.pending}
      onRefresh={() => state.refresh()}
      retrying={retry.job}
      retryError={retry.error}
      retryPending={retry.pending}
      onOpenRetry={state.openRetry}
      onCloseRetry={state.closeRetry}
      onRetry={() => state.confirmRetry()}
    />
  )
}

/** The health of the services behind the product, and running a failed job again (#429). */
export const systemModule: AdminModule = {
  id: `system`,
  nav: { name: `System`, href: SYSTEM_PATH, Icon: IconServer },
  routes: [{ path: SYSTEM_PATH, View: SystemView }],
}
