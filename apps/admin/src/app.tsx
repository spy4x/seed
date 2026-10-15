import "./app.css"
import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { LoadingSpinner } from "@spy4x/preact-ui/loading-spinner"
import { Redirect, Route, Switch, useLocation, useSearch } from "wouter-preact"
import { useRouteAnnouncer } from "@spy4x/preact-system/route-announcer"
import { adminUserFilterQuery, parseAdminUserFilter } from "@domain/identity"
import { ADMIN_PATHS, AdminFrame, AdminNoAccess, AdminSignInScreen } from "@ui/admin-frame.tsx"
import { AdminUsersScreen } from "@ui/admin-users-screen.tsx"
import { AdminUserScreen } from "@ui/admin-user-screen.tsx"
import { type AdminStore, hasAdminAccess, operatorName, operatorOf } from "./state.ts"

/**
 * The admin app (#146): operators find people and block, unblock or sign them out. It runs on its
 * own host, signs in with a password (and code) against the same API, and holds no code of the
 * SPA. Every screen comes from `libs/ui`; this file only wires the store and the address to them.
 */
export function App({ store }: { store: AdminStore }): JSX.Element {
  const session = store.session.value
  const [path, navigate] = useLocation()
  useRouteAnnouncer({ path })

  if (session.step === "loading") {
    return <LoadingSpinner size="lg" label="Loading..." class="min-h-dvh bg-canvas" />
  }

  if (session.step !== "signed-in" || !session.user) {
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

  const user = session.user
  if (path === ADMIN_PATHS.signIn || path === ADMIN_PATHS.oneTimeCode) {
    return <Redirect to={ADMIN_PATHS.users} replace />
  }
  const access = hasAdminAccess(user)
  return (
    <AdminFrame
      operatorName={operatorName(user)}
      canSignOut
      onSignOut={store.signOut}
      navigate={navigate}
      wide={access}
    >
      {access
        ? (
          <Switch>
            <Route path={ADMIN_PATHS.users}>
              <UsersView store={store} />
            </Route>
            <Route path="/users/:id">
              {(params) => <UserView store={store} id={params.id} />}
            </Route>
            <Route>
              <Redirect to={ADMIN_PATHS.users} replace />
            </Route>
          </Switch>
        )
        : <AdminNoAccess />}
    </AdminFrame>
  )
}

/** The user list. Its filter lives in the address, so back and forward step through searches. */
function UsersView({ store }: { store: AdminStore }): JSX.Element {
  const search = useSearch()
  const [, navigate] = useLocation()
  const filter = useMemo(() => parseAdminUserFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    store.loadList(filter)
  }, [filter])
  const state = store.list.value
  const go = (next: typeof filter) => {
    const query = adminUserFilterQuery(next)
    navigate(query ? `${ADMIN_PATHS.users}?${query}` : ADMIN_PATHS.users)
  }
  return (
    <AdminUsersScreen
      filter={filter}
      list={state.list}
      pending={state.pending}
      error={state.error}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      navigate={navigate}
    />
  )
}

/** One person's page and the action dialog. */
function UserView({ store, id }: { store: AdminStore; id: string }): JSX.Element {
  const [, navigate] = useLocation()
  const userId = /^[1-9]\d{0,9}$/.test(id) ? Number(id) : null
  useEffect(() => {
    store.closeDialog()
    if (userId !== null) store.loadPerson(userId)
  }, [userId])
  const person = store.person.value
  const dialog = store.dialog.value
  const operator = operatorOf(store.session.value.user!)
  const current = person.userId === userId
  return (
    <AdminUserScreen
      detail={current ? person.detail : null}
      error={userId === null ? "User not found" : current ? person.error : null}
      operator={operator}
      dialog={dialog.action}
      onOpenDialog={store.openDialog}
      onCloseDialog={store.closeDialog}
      actionError={dialog.error}
      pending={dialog.pending}
      onAction={() => store.act()}
      navigate={navigate}
    />
  )
}
