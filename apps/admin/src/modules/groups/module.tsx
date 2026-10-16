import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { IconFolder } from "@spy4x/preact-icons"
import { type AdminGroupFilter, adminGroupFilterQuery, parseAdminGroupFilter } from "@domain/groups"
import { ADMIN_GROUP_PATHS, AdminGroupsListScreen } from "@ui/admin-groups-list.tsx"
import { AdminGroupScreen } from "@ui/admin-groups-detail.tsx"
import { operatorOf } from "../../state.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { createGroupsState, type GroupsState } from "./state.ts"

/** One groups state per signed-in session: a new session starts with an empty list. */
const states = new WeakMap<AdminContext, GroupsState>()

function groupsState(context: AdminContext): GroupsState {
  let state = states.get(context)
  if (!state) {
    state = createGroupsState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The list. Its search, filter and sort live in the address, so back and forward step through. */
function GroupsView({ context }: { context: AdminContext }): JSX.Element {
  const state = groupsState(context)
  const search = useSearch()
  const filter = useMemo(() => parseAdminGroupFilter(new URLSearchParams(search)), [search])
  useEffect(() => {
    state.loadList(filter)
  }, [filter])
  const list = state.list.value
  const go = (next: AdminGroupFilter) => {
    const query = adminGroupFilterQuery(next)
    context.navigate(query ? `${ADMIN_GROUP_PATHS.list}?${query}` : ADMIN_GROUP_PATHS.list)
  }
  return (
    <AdminGroupsListScreen
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      navigate={context.navigate}
    />
  )
}

/** One group, its tabs and the action dialog. The open tab lives in the address as `?tab=`. */
function GroupView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const state = groupsState(context)
  const [path] = useLocation()
  const search = useSearch()
  const id = params.id ?? ``
  const groupId = UUID.test(id) ? id.toLowerCase() : null
  useEffect(() => {
    state.closeDialog()
    if (groupId !== null) state.loadGroup(groupId)
  }, [groupId])
  const group = state.group.value
  const dialog = state.dialog.value
  const current = group.groupId === groupId
  const tab = new URLSearchParams(search).get(`tab`) ?? `members`
  return (
    <AdminGroupScreen
      detail={current ? group.detail : null}
      error={groupId === null ? `Group not found` : current ? group.error : null}
      operator={operatorOf(context.operator)}
      tab={tab}
      onTab={(next) =>
        context.navigate(next === `members` ? path : `${path}?tab=${encodeURIComponent(next)}`, {
          replace: true,
        })}
      dialog={dialog.dialog}
      onOpenDialog={state.openDialog}
      onCloseDialog={state.closeDialog}
      actionError={dialog.error}
      pending={dialog.pending}
      onAction={(action) => state.act(action)}
      navigate={context.navigate}
    />
  )
}

/** Every group, and one group's page with its members, invitations and activity (#426). */
export const groupsModule: AdminModule = {
  id: `groups`,
  nav: { name: `Groups`, href: ADMIN_GROUP_PATHS.list, Icon: IconFolder },
  routes: [
    { path: ADMIN_GROUP_PATHS.list, View: GroupsView },
    { path: `/groups/:id`, View: GroupView },
  ],
}
