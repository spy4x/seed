import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { IconUsers } from "@spy4x/preact-icons"
import {
  type AdminUserFilter,
  adminUserFilterQuery,
  adminUsersExportPath,
  parseAdminUserFilter,
} from "@domain/identity"
import { ADMIN_PATHS } from "@ui/admin-frame.tsx"
import { AdminUsersScreen } from "@ui/admin-users-screen.tsx"
import { AdminUserScreen } from "@ui/admin-user-screen.tsx"
import { AdminPersonDataExportsPanel } from "@ui/admin-person-data-exports.tsx"
import { operatorOf } from "../../state.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { createUsersState, type UsersState } from "./state.ts"

/** One users state per signed-in session: a new session starts with an empty list. */
const states = new WeakMap<AdminContext, UsersState>()

function usersState(context: AdminContext): UsersState {
  let state = states.get(context)
  if (!state) {
    state = createUsersState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

/** The list. Its filter and sort live in the address, so back and forward step through them. */
function UsersView({ context }: { context: AdminContext }): JSX.Element {
  const state = usersState(context)
  const search = useSearch()
  const filter = useMemo(() => parseAdminUserFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  const list = state.list.value
  const go = (next: AdminUserFilter) => {
    const query = adminUserFilterQuery(next)
    context.navigate(query ? `${ADMIN_PATHS.users}?${query}` : ADMIN_PATHS.users)
  }
  return (
    <AdminUsersScreen
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      operatorId={context.operator.id}
      exportHref={adminUsersExportPath(filter)}
      navigate={context.navigate}
    />
  )
}

/** One person, their tabs and the action dialog. The open tab lives in the address as `?tab=`. */
function UserView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = usersState(context)
  const [path] = useLocation()
  const search = useSearch()
  const id = params.id ?? ""
  const userId = /^[1-9]\d{0,9}$/.test(id) ? Number(id) : null
  useEffect(() => {
    state.closeDialog()
    if (userId !== null) state.loadPerson(userId)
  }, [userId])
  const person = state.person.value
  const dialog = state.dialog.value
  const current = person.userId === userId
  const tab = new URLSearchParams(search).get(`tab`) ?? `overview`
  const extraTabs = userId === null ? [] : context.personTabs.map((extra) => ({
    id: extra.id,
    label: extra.label,
    content: extra.render({ context, userId }),
  }))
  return (
    <AdminUserScreen
      detail={current ? person.detail : null}
      error={userId === null ? `User not found` : current ? person.error : null}
      operator={operatorOf(context.operator)}
      tab={tab}
      onTab={(next) =>
        context.navigate(next === `overview` ? path : `${path}?tab=${encodeURIComponent(next)}`, {
          replace: true,
        })}
      extraTabs={extraTabs}
      dialog={dialog.action}
      dialogSessionId={dialog.sessionId}
      onOpenDialog={state.openDialog}
      onCloseDialog={state.closeDialog}
      actionError={dialog.error}
      pending={dialog.pending}
      onAction={(_action, input) =>
        void state.act(input).then((gone) => gone && context.navigate(ADMIN_PATHS.users))}
      navigate={context.navigate}
    />
  )
}

/** The person's "Data exports" tab (#229): read when it opens. */
function DataExportsTab(
  { context, userId }: { context: AdminContext; userId: number },
): JSX.Element {
  const state = usersState(context)
  useEffect(() => {
    state.loadDataExports(userId)
  }, [userId])
  const panel = state.dataExports.value
  const current = panel.userId === userId
  return (
    <AdminPersonDataExportsPanel
      exports={current ? panel.exports : null}
      error={current ? panel.error : null}
    />
  )
}

/** Everyone with an account, and one person's page with its actions (#146, #424). */
export const usersModule: AdminModule = {
  id: `users`,
  nav: { name: `Users`, href: ADMIN_PATHS.users, Icon: IconUsers },
  routes: [
    { path: ADMIN_PATHS.users, View: UsersView },
    { path: `/users/:id`, View: UserView },
  ],
  personTabs: [
    {
      id: `data-exports`,
      label: `Data exports`,
      render: ({ context, userId }) => <DataExportsTab context={context} userId={userId} />,
    },
  ],
}
