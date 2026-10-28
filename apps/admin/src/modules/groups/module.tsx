import type { JSX } from "preact"
import { useEffect, useMemo, useState } from "preact/hooks"
import { useLocation, useSearch } from "wouter-preact"
import { IconFolder } from "@spy4x/preact-icons"
import {
  type AdminGroupFileFilter,
  adminGroupFileFilterQuery,
  type AdminGroupFilter,
  adminGroupFilterQuery,
  parseAdminGroupFileFilter,
  parseAdminGroupFilter,
} from "@domain/groups"
import { ADMIN_GROUP_PATHS, AdminGroupsListScreen } from "@ui/admin-groups-list.tsx"
import { AdminGroupScreen } from "@ui/admin-groups-detail.tsx"
import { AdminGroupOverview } from "@ui/admin-group-overview.tsx"
import { OVERVIEW_DEFAULT_PRESET } from "@ui/overview-screen.tsx"
import { OVERVIEW_VIEWS, OVERVIEW_WIDGETS } from "@ui/overview-widgets.ts"
import type { DateRangeChoice } from "@spy4x/preact-ui/date-range-search"
import { rangeForPreset } from "@spy4x/preact-ui/date-range"
import { useFormat } from "@spy4x/preact-ui/format"
import { createAdminOverviewState } from "./overview.ts"
import { operatorOf } from "../../state.ts"
import { useAdminText } from "@ui/i18n.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { createGroupsState, type GroupsState } from "./state.ts"

/** One groups state per signed-in session: a new session starts with an empty list. */
const states = new WeakMap<AdminContext, GroupsState>()
const overviews = new WeakMap<AdminContext, ReturnType<typeof createAdminOverviewState>>()

function overviewState(context: AdminContext) {
  let state = overviews.get(context)
  if (!state) {
    state = createAdminOverviewState(context.request)
    overviews.set(context, state)
  }
  return state
}

function groupsState(context: AdminContext): GroupsState {
  let state = states.get(context)
  if (!state) {
    state = createGroupsState(context.request, context.toasts, context.signedOut)
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
  const t = useAdminText()
  const state = groupsState(context)
  const [path] = useLocation()
  const search = useSearch()
  const id = params.id ?? ``
  const groupId = UUID.test(id) ? id.toLowerCase() : null
  useEffect(() => {
    state.closeDialog()
    if (groupId !== null) state.loadGroup(groupId)
  }, [groupId])
  const query = new URLSearchParams(search)
  const tab = query.get(`tab`) ?? `members`
  // The Files tab's search and page live in the address too, so Back steps through searches.
  const fileQuery = tab === `files`
    ? adminGroupFileFilterQuery(parseAdminGroupFileFilter(query))
    : ``
  const fileFilter = useMemo(
    () => parseAdminGroupFileFilter(new URLSearchParams(fileQuery)),
    [fileQuery],
  )
  useEffect(() => {
    if (groupId !== null) state.loadFiles(groupId, fileFilter)
  }, [groupId, fileFilter])
  const group = state.group.value
  const dialog = state.dialog.value
  const files = state.files.value
  const current = group.groupId === groupId
  const shownFiles = files.groupId === groupId && files.filter === fileFilter ? files : null
  const goFiles = (next: AdminGroupFileFilter, replace = false) => {
    const query = adminGroupFileFilterQuery(next)
    context.navigate(`${path}?tab=files${query ? `&${query}` : ``}`, { replace })
  }
  // A page past the last one, such as after the last file of a page was removed, shows the last.
  const page = shownFiles?.files
  useEffect(() => {
    if (!page || page.files.length > 0 || page.page <= 1 || page.total === 0) return
    goFiles({ query: page.query, page: Math.ceil(page.total / page.pageSize) }, true)
  }, [page])
  const overview = overviewState(context)
  const timeZone = useFormat().timeZone
  const now = useMemo(() => new Date(), [groupId])
  const [range, setRange] = useState<DateRangeChoice>(() => ({
    preset: OVERVIEW_DEFAULT_PRESET,
    range: rangeForPreset(OVERVIEW_DEFAULT_PRESET, { now, timeZone }),
  }))
  useEffect(() => {
    if (groupId !== null) overview.open({ groupId, range: range.range, timeZone })
  }, [groupId, range.range.from, range.range.to, timeZone])
  const loads = overview.loads.value
  return (
    <AdminGroupScreen
      detail={current ? group.detail : null}
      error={groupId === null ? t.t(`AdminGroup.notFound`) : current ? group.error : null}
      operator={operatorOf(context.operator)}
      files={shownFiles?.files ?? null}
      filesError={shownFiles?.error ?? null}
      fileFilter={fileFilter}
      onFileFilter={(next) => goFiles(next)}
      onRetryFiles={() => {
        if (groupId !== null) state.loadFiles(groupId, fileFilter)
      }}
      onDownloadFile={(file) => {
        if (groupId !== null) state.downloadFile(groupId, file)
      }}
      fileNotice={shownFiles?.notice ?? null}
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
      overview={current && group.detail && (
        <AdminGroupOverview
          groupName={group.detail.group.name}
          range={range}
          timeZone={timeZone}
          now={now}
          onRangeChange={setRange}
          widgets={OVERVIEW_WIDGETS.map((widget) => ({
            id: widget.id,
            titleKey: widget.titleKey,
            size: widget.size,
            load: loads[widget.id] ?? { status: `loading` },
          }))}
          views={OVERVIEW_VIEWS}
          onRetry={overview.retry}
        />
      )}
      navigate={context.navigate}
    />
  )
}

/** Every group, and one group's page with its members, invitations, files and activity (#426). */
export const groupsModule: AdminModule = {
  id: `groups`,
  nav: { name: `AdminNav.groups`, href: ADMIN_GROUP_PATHS.list, Icon: IconFolder },
  routes: [
    { path: ADMIN_GROUP_PATHS.list, View: GroupsView },
    { path: `/groups/:id`, View: GroupView },
  ],
}
