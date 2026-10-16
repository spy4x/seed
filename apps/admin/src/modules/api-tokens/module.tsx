import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconKey } from "@spy4x/preact-icons"
import {
  type AdminApiTokenFilter,
  adminApiTokenFilterQuery,
  parseAdminApiTokenFilter,
} from "@domain/api-tokens"
import { ADMIN_API_TOKENS_PATH, AdminApiTokensScreen } from "@ui/admin-api-tokens-screen.tsx"
import {
  AdminPersonDevicesPanel,
  AdminPersonNotificationsPanel,
  AdminPersonTokensPanel,
} from "@ui/admin-api-tokens-tabs.tsx"
import type { AdminContext, AdminModule } from "../types.ts"
import { type ApiTokensState, createApiTokensState } from "./state.ts"

/** One state per signed-in session: a new session starts with nothing read. */
const states = new WeakMap<AdminContext, ApiTokensState>()

function apiTokensState(context: AdminContext): ApiTokensState {
  let state = states.get(context)
  if (!state) {
    state = createApiTokensState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

/** The confirm dialog's props, wired to the state; the same for the page and every tab. */
function confirmProps(context: AdminContext, state: ApiTokensState) {
  return {
    operatorId: context.operator.id,
    confirm: state.confirm.value,
    onAsk: state.ask,
    onCloseConfirm: state.closeConfirm,
    onConfirm: () => state.confirmAction(),
  }
}

/** The page. Its state filter and page live in the address, so back and forward step through. */
function ApiTokensView({ context }: { context: AdminContext }): JSX.Element {
  const state = apiTokensState(context)
  const search = useSearch()
  const filter = useMemo(() => parseAdminApiTokenFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  useEffect(() => () => state.closeConfirm(), [])
  const list = state.list.value
  const go = (next: AdminApiTokenFilter) => {
    const query = adminApiTokenFilterQuery(next)
    context.navigate(query ? `${ADMIN_API_TOKENS_PATH}?${query}` : ADMIN_API_TOKENS_PATH)
  }
  return (
    <AdminApiTokensScreen
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onFilter={go}
      onPage={(page) => go({ ...filter, page })}
      navigate={context.navigate}
      {...confirmProps(context, state)}
    />
  )
}

function TokensTab({ context, userId }: { context: AdminContext; userId: number }): JSX.Element {
  const state = apiTokensState(context)
  useEffect(() => {
    state.loadTokens(userId)
    return () => state.closeConfirm()
  }, [userId])
  const panel = state.tokens.value
  const current = panel.userId === userId
  return (
    <AdminPersonTokensPanel
      data={current ? panel.data : null}
      error={current ? panel.error : null}
      userId={userId}
      {...confirmProps(context, state)}
    />
  )
}

function DevicesTab({ context, userId }: { context: AdminContext; userId: number }): JSX.Element {
  const state = apiTokensState(context)
  useEffect(() => {
    state.loadDevices(userId)
    return () => state.closeConfirm()
  }, [userId])
  const panel = state.devices.value
  const current = panel.userId === userId
  return (
    <AdminPersonDevicesPanel
      data={current ? panel.data : null}
      error={current ? panel.error : null}
      userId={userId}
      {...confirmProps(context, state)}
    />
  )
}

function NotificationsTab(
  { context, userId }: { context: AdminContext; userId: number },
): JSX.Element {
  const state = apiTokensState(context)
  useEffect(() => {
    state.loadNotifications(userId)
  }, [userId])
  const panel = state.notifications.value
  const current = panel.userId === userId
  return (
    <AdminPersonNotificationsPanel
      data={current ? panel.data : null}
      error={current ? panel.error : null}
    />
  )
}

/** API tokens across people, and a person's tokens, push devices and notifications (#427). */
export const apiTokensModule: AdminModule = {
  id: `api-tokens`,
  nav: { name: `API tokens`, href: ADMIN_API_TOKENS_PATH, Icon: IconKey },
  routes: [{ path: ADMIN_API_TOKENS_PATH, View: ApiTokensView }],
  personTabs: [
    {
      id: `api-tokens`,
      label: `API tokens`,
      render: ({ context, userId }) => <TokensTab context={context} userId={userId} />,
    },
    {
      id: `devices`,
      label: `Devices`,
      render: ({ context, userId }) => <DevicesTab context={context} userId={userId} />,
    },
    {
      id: `notifications`,
      label: `Notifications`,
      render: ({ context, userId }) => <NotificationsTab context={context} userId={userId} />,
    },
  ],
}
