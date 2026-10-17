import "./app.css"
import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import type { createThemeStore } from "@spy4x/preact-signals/theme"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { Redirect, Route, Switch, useLocation } from "wouter-preact"
import { useRouteAnnouncer } from "@spy4x/preact-system/route-announcer"
import {
  ADMIN_PATHS,
  AdminFrame,
  AdminNoAccess,
  AdminShell,
  AdminSignInScreen,
} from "@ui/admin-frame.tsx"
import { type AdminStore, hasAdminAccess, operatorName } from "./state.ts"
import { ADMIN_MODULES, adminPersonTabs } from "./modules/registry.ts"
import type { AdminContext, AdminModule } from "./modules/types.ts"

export interface AppProps {
  store: AdminStore
  theme: ReturnType<typeof createThemeStore>
  toasts: ToastStore
  /** The modules to show; the registry's by default. Tests pass their own. */
  modules?: readonly AdminModule[]
}

/**
 * The admin app (#146, #424): the operator area. It runs on its own host, signs in with a password
 * (and code) against the same API, and holds no code of the SPA. Signed in, it shows the shell with
 * one sidebar entry per module (`modules/registry.ts`) and the pages each module registers.
 */
export function App(
  { store, theme, toasts, modules = ADMIN_MODULES }: AppProps,
): JSX.Element {
  const session = store.session.value
  const [path, navigate] = useLocation()
  useRouteAnnouncer({ path })
  // A new page starts at its top; the router keeps the old page's scroll, so a person opened from
  // far down the list would show with their header under the top bar. A tab change (`?tab=`) keeps
  // the path and so the scroll.
  useEffect(() => globalThis.scrollTo?.(0, 0), [path])
  const user = session.step === "signed-in" ? session.user : null

  // One context per signed-in session, so a module's state starts empty for the next one.
  const context = useMemo<AdminContext | null>(
    () =>
      user && {
        request: store.request,
        toasts,
        operator: user,
        navigate,
        personTabs: adminPersonTabs(modules),
      },
    [user?.id, modules],
  )
  const toastr = <Toastr toasts={toasts.list.value} onDismiss={toasts.remove} dataE2E="toasts" />

  if (session.step === "loading") {
    return <LoadingSpinner size="lg" label="Loading…" class="min-h-dvh bg-canvas" />
  }

  if (!user || !context) {
    const step = session.step === "one-time-code" ? "one-time-code" : "credentials"
    const wanted = step === "one-time-code" ? ADMIN_PATHS.oneTimeCode : ADMIN_PATHS.signIn
    if (path !== wanted) return <Redirect to={wanted} replace />
    return (
      <AdminFrame
        operatorName={null}
        canSignOut={step === "one-time-code"}
        onSignOut={store.signOut}
        navigate={navigate}
        wide={false}
      >
        <AdminSignInScreen
          step={step}
          busy={session.busy}
          error={session.error}
          onSignIn={store.signIn}
          onOneTimeCode={store.oneTimeCode}
        />
      </AdminFrame>
    )
  }

  if (path === ADMIN_PATHS.signIn || path === ADMIN_PATHS.oneTimeCode) {
    return <Redirect to={ADMIN_PATHS.dashboard} replace />
  }
  if (!hasAdminAccess(user)) {
    return (
      <AdminFrame operatorName={operatorName(user)} canSignOut onSignOut={store.signOut}>
        <AdminNoAccess />
      </AdminFrame>
    )
  }

  return (
    <AdminShell
      navItems={modules.map((module) => module.nav)}
      currentPath={path}
      operator={{ name: operatorName(user), email: null }}
      theme={theme}
      onSignOut={store.signOut}
      navigate={navigate}
    >
      <Switch>
        {modules.flatMap((module) =>
          module.routes.map(({ path: pattern, View }) => (
            <Route key={`${module.id}:${pattern}`} path={pattern}>
              {(params) => <View context={context} params={params as Record<string, string>} />}
            </Route>
          ))
        )}
        <Route>
          <Redirect to={ADMIN_PATHS.dashboard} replace />
        </Route>
      </Switch>
      {toastr}
    </AdminShell>
  )
}
