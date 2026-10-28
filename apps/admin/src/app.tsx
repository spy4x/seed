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
import { ADMIN_MODULES, adminPersonTabs, shownModules } from "./modules/registry.ts"
import type { AdminContext, AdminModule } from "./modules/types.ts"
import { FormatContext } from "@spy4x/preact-ui/format"
import { I18nContext, useT } from "@spy4x/preact-ui/i18n"
import { isLanguage, LANGUAGES } from "@domain/identity"
import { languageSetting, pickLanguage } from "@platform/i18n.ts"
import { kept, languages as pageLanguages } from "./i18n.ts"
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
  /** The page's languages; the build's by default. Tests pass their own. */
  languages?: Pick<
    typeof pageLanguages,
    "translator" | "use" | "setNumberLocale" | "loading" | "failed"
  >
}

/**
 * The admin app (#146, #424): the operator area. It runs on its own host, signs in with a password
 * (and code) against the same API, and holds no code of the SPA. Signed in, it shows the shell with
 * one sidebar entry per module (`modules/registry.ts`) and the pages each module registers.
 */
export function App(props: AppProps): JSX.Element {
  const languages = props.languages ?? pageLanguages
  // Every word in the operator's language: the one they chose, else this device's (#216).
  return (
    <I18nContext.Provider value={languages.translator.value}>
      <Operator {...props} languages={languages} />
    </I18nContext.Provider>
  )
}

function Operator(
  {
    store,
    theme,
    toasts,
    modules: allModules = ADMIN_MODULES,
    operatorFormat,
    singleKeys = deviceSingleKeys,
    languages = pageLanguages,
  }: AppProps,
): JSX.Element {
  const own = useMemo(() => operatorFormat ?? createOperatorFormat(store.request), [store])
  const session = store.session.value
  const [path, navigate] = useLocation()
  // Shortcuts, the sidebar and modules navigate through this one, so a page with unsaved changes
  // asks before any of them leaves it (`leave.ts`).
  const leaveGuard = useMemo(createLeaveGuard, [])
  const leave = useMemo(() => guardNavigate(leaveGuard, navigate), [leaveGuard, navigate])
  const user = session.step === "signed-in" ? session.user : null
  // The optional modules the API has on (`GET /api/admin/modules`), read once per session; `null`
  // until read. The rail shows an optional module only once it is listed.
  const [moduleIds, setModuleIds] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    setModuleIds(null)
    if (!user || !hasAdminAccess(user)) return
    let current = true
    void store.request<{ ids: string[] }>("/api/admin/modules").then((result) => {
      if (current) setModuleIds(new Set(result.ok ? result.data.ids : []))
    })
    return () => {
      current = false
    }
  }, [user?.id])
  const modules = useMemo(() => shownModules(allModules, moduleIds ?? new Set()), [
    allModules,
    moduleIds,
  ])
  // The tab says "Users · Admin · Seed", so an operator never mistakes it for the product's.
  const t = useT()
  const tag = t.t(`AdminFrame.tag`)
  // The modules name their rail entries by catalog key; the rail, the tab title and the shortcuts
  // show them in the page's language.
  const navItems = modules.map((module) => ({ ...module.nav, name: t.t(module.nav.name) }))
  const title = user && hasAdminAccess(user)
    ? adminPageTitle(navItems, path, tag)
    : `${tag} · ${ADMIN_PRODUCT}`
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
  // The operator's language: one chosen in this admin app on this device, else their account's,
  // else the browser's. The account's is set in the product's app; the admin app only reads it.
  const chosen = own.language.value
  const [deviceChoice, setDeviceChoice] = useState(() => {
    const value = kept.read()
    return isLanguage(value) ? value : null
  })
  const requested = globalThis.navigator?.languages
  useEffect(() => {
    void languages.use(pickLanguage(LANGUAGES, deviceChoice, chosen, requested))
  }, [chosen, deviceChoice])
  const language = languageSetting({
    languages: LANGUAGES,
    current: deviceChoice,
    // "Automatic" is what the account and the browser give without a choice here.
    automatic: pickLanguage(LANGUAGES, chosen, null, requested),
    loading: languages.loading.value,
    failed: languages.failed.value,
    choose: (tag) => {
      kept.write(tag)
      setDeviceChoice(tag)
    },
  })
  // Numbers inside messages follow the operator's region format.
  const numberLocale = own.format.value.locale
  useEffect(() => languages.setNumberLocale(numberLocale), [numberLocale])
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
        signedOut: () => store.signedOut(),
        toasts,
        operator: user,
        navigate: leave,
        leaveGuard,
        // An optional module adds no person tabs, so the context need not wait for the list.
        personTabs: adminPersonTabs(allModules.filter((module) => !module.optional)),
        format: () => own.format.value,
      },
    [user?.id, allModules],
  )
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutRows = adminShortcutRows({
    modules,
    t,
    path,
    navigate: leave,
    openShortcuts: () => setShortcutsOpen(true),
    focusListFilter,
  })
  // Bound only in the signed-in shell, which draws the list too.
  useShortcuts(user && hasAdminAccess(user) ? shortcutRows : [], singleKeys.on.value)
  const toastr = <Toastr toasts={toasts.list.value} onDismiss={toasts.remove} dataE2E="toasts" />

  if (session.step === "loading") {
    return <LoadingSpinner size="lg" label={t.t(`AdminApp.loading`)} class="min-h-dvh bg-canvas" />
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
        navItems={navItems}
        currentPath={path}
        operator={{ name: operatorName(user, email), email }}
        theme={theme}
        language={language}
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
          {/* Until the list is read, every module's pages answer, so a link to one never bounces. */}
          {(moduleIds === null ? allModules : modules).flatMap((module) =>
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
