import "./app.css"
import type { JSX } from "preact"
import { useEffect, useMemo, useState } from "preact/hooks"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Toastr } from "@spy4x/preact-ui/toastr"
import { createLeaveGuard } from "@spy4x/preact-ui/unsaved-guard"
import type { createThemeStore } from "@spy4x/preact-signals/theme"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import { Redirect, Route, Switch, useLocation } from "wouter-preact"
import { useRouteAnnouncer } from "@spy4x/preact-system/route-announcer"
import {
  ADMIN_PATHS,
  ADMIN_PRODUCT,
  AdminFrame,
  AdminNoAccess,
  adminPageTitle,
  AdminShell,
  AdminSignInScreen,
} from "@ui/admin-frame.tsx"
import { type AdminStore, hasAdminAccess, operatorName, readOperatorEmail } from "./state.ts"
import { ADMIN_MODULES, adminPersonTabs } from "./modules/registry.ts"
import type { AdminContext, AdminModule } from "./modules/types.ts"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createOperatorFormat, type OperatorFormat } from "./preferences.ts"
import { adminShortcutRows, focusListFilter } from "./shortcuts.ts"
import { guardNavigate } from "./leave.ts"
import {
  type createSingleKeysSetting,
  hasFinePointer,
  singleKeys as deviceSingleKeys,
  useShortcuts,
} from "@platform/shortcuts.ts"

export interface AppProps {
  store: AdminStore
  theme: ReturnType<typeof createThemeStore>
  toasts: ToastStore
  /** The modules to show; the registry's by default. Tests pass their own. */
  modules?: readonly AdminModule[]
  /** The operator's own date format; one over `store.request` by default. Tests pass their own. */
  operatorFormat?: OperatorFormat
  /** The single-key shortcuts' switch; this device's by default. Tests pass their own. */
  singleKeys?: ReturnType<typeof createSingleKeysSetting>
}

/**
 * The admin app (#146, #424): the operator area. It runs on its own host, signs in with a password
 * (and code) against the same API, and holds no code of the SPA. Signed in, it shows the shell with
 * one sidebar entry per module (`modules/registry.ts`) and the pages each module registers.
 */
export function App(
  { store, theme, toasts, modules = ADMIN_MODULES, operatorFormat, singleKeys = deviceSingleKeys }:
    AppProps,
): JSX.Element {
  const own = useMemo(() => operatorFormat ?? createOperatorFormat(store.request), [store])
  const session = store.session.value
  const [path, navigate] = useLocation()
  // Shortcuts, the sidebar and modules navigate through this one, so a page with unsaved changes
  // asks before any of them leaves it (`leave.ts`).
  const leaveGuard = useMemo(createLeaveGuard, [])
  const leave = useMemo(() => guardNavigate(leaveGuard, navigate), [leaveGuard, navigate])
  const user = session.step === "signed-in" ? session.user : null
  // The tab says "Users · Admin · Seed", so an operator never mistakes it for the product's.
  const title = user && hasAdminAccess(user)
    ? adminPageTitle(modules.map((module) => module.nav), path)
    : `Admin · ${ADMIN_PRODUCT}`
  useRouteAnnouncer({ path, title })
  // A new page starts at its top; the router keeps the old page's scroll, so a person opened from
  // far down the list would show with their header under the top bar. A tab change (`?tab=`) keeps
  // the path and so the scroll.
  useEffect(() => globalThis.scrollTo?.(0, 0), [path])
  // The operator's own region format, zone and clock, read again for each signed-in session.
  useEffect(() => {
    if (user) void own.load()
    else own.reset()
  }, [user?.id])
  // The operator's address, the account cell's name when they have none (#172).
  const [email, setEmail] = useState<string | null>(null)
  useEffect(() => {
    setEmail(null)
    if (!user) return
    let current = true
    void readOperatorEmail(store.request).then((address) => current && setEmail(address))
    return () => {
      current = false
    }
  }, [user?.id])

  // One context per signed-in session, so a module's state starts empty for the next one.
  const context = useMemo<AdminContext | null>(
    () =>
      user && {
        request: store.request,
        toasts,
        operator: user,
        navigate: leave,
        leaveGuard,
        personTabs: adminPersonTabs(modules),
        format: () => own.format.value,
      },
    [user?.id, modules],
  )
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutRows = adminShortcutRows({
    modules,
    path,
    navigate: leave,
    openShortcuts: () => setShortcutsOpen(true),
    focusListFilter,
  })
  // Bound only in the signed-in shell, which draws the list too.
  useShortcuts(user && hasAdminAccess(user) ? shortcutRows : [], singleKeys.on.value)
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
      <AdminFrame operatorName={operatorName(user, email)} canSignOut onSignOut={store.signOut}>
        <AdminNoAccess />
      </AdminFrame>
    )
  }

  return (
    <FormatContext.Provider value={own.format.value}>
      <AdminShell
        navItems={modules.map((module) => module.nav)}
        currentPath={path}
        operator={{ name: operatorName(user, email), email }}
        theme={theme}
        onSignOut={store.signOut}
        navigate={leave}
        shortcuts={{
          rows: shortcutRows,
          open: shortcutsOpen,
          onOpen: () => setShortcutsOpen(true),
          onClose: () => setShortcutsOpen(false),
          singleKeys: singleKeys.on.value,
          onSingleKeys: singleKeys.set,
          inMenu: hasFinePointer(),
        }}
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
    </FormatContext.Provider>
  )
}
