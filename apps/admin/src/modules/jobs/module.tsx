import type { JSX } from "preact"
import { useEffect, useMemo } from "preact/hooks"
import { useSearch } from "wouter-preact"
import { IconClock } from "@spy4x/preact-icons"
import { type AdminJobFilter, adminJobFilterQuery, parseAdminJobFilter } from "@domain/identity"
import {
  ADMIN_JOB_PATHS,
  AdminJobScreen,
  AdminJobsScreen,
  type AdminJobsTab,
} from "@ui/admin-jobs-screen.tsx"
import { useAdminText } from "@ui/i18n.ts"
import type { AdminContext, AdminModule } from "../types.ts"
import { createJobsState, type JobsState } from "./state.ts"

/** One Jobs state per signed-in session: a new session starts with an empty list. */
const states = new WeakMap<AdminContext, JobsState>()

function jobsState(context: AdminContext): JobsState {
  let state = states.get(context)
  if (!state) {
    state = createJobsState(context.request, context.toasts)
    states.set(context, state)
  }
  return state
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The address of the list: the tab, and the Runs filter, each left out at its default. */
function listHref(tab: AdminJobsTab, filter: AdminJobFilter): string {
  if (tab === `repeating`) return ADMIN_JOB_PATHS.repeating
  const query = adminJobFilterQuery(filter)
  return query ? `${ADMIN_JOB_PATHS.list}?${query}` : ADMIN_JOB_PATHS.list
}

/** The Jobs page. Its tab, state filter, search and page live in the address. */
function JobsView({ context }: { context: AdminContext }): JSX.Element {
  const state = jobsState(context)
  const search = useSearch()
  const params = useMemo(() => new URLSearchParams(search), [search])
  const tab: AdminJobsTab = params.get(`tab`) === `repeating` ? `repeating` : `runs`
  const filter = useMemo(() => parseAdminJobFilter(params), [params])
  useEffect(() => {
    if (tab === `runs`) state.loadList(filter)
    else state.loadRepeating()
  }, [tab, filter])
  useEffect(() => () => state.closeConfirm(), [state])
  const list = state.list.value
  const repeating = state.repeating.value
  const confirm = state.confirm.value
  const go = (next: AdminJobFilter) => context.navigate(listHref(`runs`, next))
  return (
    <AdminJobsScreen
      tab={tab}
      onTab={(next) => context.navigate(listHref(next, filter), { replace: true })}
      filter={filter}
      list={list.list}
      pending={list.pending}
      error={list.error}
      onSearch={go}
      onPage={(page) => go({ ...filter, page })}
      onReload={() => state.loadList(filter)}
      repeating={repeating.jobs}
      repeatingError={repeating.error}
      onReloadRepeating={() => state.loadRepeating()}
      starting={repeating.starting}
      onRunRepeating={(job) => state.runRepeating(job)}
      confirm={confirm.confirm}
      confirmPending={confirm.pending}
      confirmError={confirm.error}
      onOpenConfirm={state.openConfirm}
      onCloseConfirm={state.closeConfirm}
      onConfirm={() => state.confirmOpen()}
      navigate={context.navigate}
    />
  )
}

/** One run of a job and the actions on it. */
function JobView(
  { context, params }: { context: AdminContext; params: Record<string, string> },
): JSX.Element {
  const t = useAdminText()
  const state = jobsState(context)
  const raw = params.id ?? ``
  const id = UUID.test(raw) ? raw.toLowerCase() : null
  useEffect(() => {
    state.closeDialog()
    if (id !== null) state.loadJob(id)
  }, [id])
  const job = state.job.value
  const dialog = state.dialog.value
  const current = job.id === id
  return (
    <AdminJobScreen
      job={current ? job.detail : null}
      error={id === null ? t.t(`AdminJobs.notFound`) : current ? job.error : null}
      onReload={() => id !== null && state.loadJob(id)}
      dialog={dialog.dialog}
      pending={dialog.pending}
      dialogError={dialog.error}
      onOpenDialog={state.openDialog}
      onCloseDialog={state.closeDialog}
      onAction={(action) => state.act(action)}
      onCopyId={async (jobId) => {
        try {
          await navigator.clipboard.writeText(jobId)
          context.toasts.success({ body: t.t(`AdminJobs.idCopied`), dataE2E: `admin-job-toast` })
        } catch {
          context.toasts.error({ body: t.t(`AdminJobs.idNotCopied`), dataE2E: `admin-job-toast` })
        }
      }}
      navigate={context.navigate}
    />
  )
}

/** Every background job's runs, the repeating jobs, and run again, run now and cancel (#394). */
export const jobsModule: AdminModule = {
  id: `jobs`,
  nav: { name: `AdminNav.jobs`, href: ADMIN_JOB_PATHS.list, Icon: IconClock },
  routes: [
    { path: ADMIN_JOB_PATHS.list, View: JobsView },
    { path: `/jobs/:id`, View: JobView },
  ],
}
