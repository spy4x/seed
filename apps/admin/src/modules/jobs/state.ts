import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import {
  type AdminJobActionResponse,
  type AdminJobDetail,
  type AdminJobFilter,
  adminJobFilterQuery,
  type AdminJobListResponse,
  type AdminJobRetryAllResponse,
  type AdminRepeatingJob,
} from "@domain/identity"
import type { AdminJobAction, AdminJobsConfirm } from "@ui/admin-jobs-screen.tsx"
import { type AdminFetch, post } from "../../state.ts"

/** What the toast says when an action failed for no reason the API gave. */
export const JOB_ACTION_FAILED = `That did not work. Try again in a moment.`

export interface JobsListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminJobFilter | null
  list: AdminJobListResponse | null
  pending: boolean
  error: string | null
}

export interface JobsRepeatingState {
  jobs: AdminRepeatingJob[] | null
  error: string | null
  /** The kind whose "Run now" is in flight. */
  starting: string | null
}

export interface JobsConfirmState {
  confirm: AdminJobsConfirm | null
  pending: boolean
  error: string | null
}

export interface JobsJobState {
  id: string | null
  detail: AdminJobDetail | null
  error: string | null
}

export interface JobsDialogState {
  dialog: AdminJobAction | null
  pending: boolean
  error: string | null
}

const NO_CONFIRM: JobsConfirmState = { confirm: null, pending: false, error: null }
const NO_DIALOG: JobsDialogState = { dialog: null, pending: false, error: null }

/** The path of an action under `/api/admin/jobs/:id/`. */
const ACTION_PATHS: Record<AdminJobAction, string> = {
  retry: `retry`,
  runNow: `run-now`,
  cancel: `cancel`,
}

/**
 * The Jobs module's state: the runs, the repeating jobs, one run's page, and the actions with their
 * confirmations. Every call goes through the app's `request`, which signs the app out on a 401.
 *
 * An action the API refuses with 409 (the run finished, was cancelled or another run waits) closes
 * its dialog, says why in a toast and reads the run again, so the page shows its current state.
 */
export function createJobsState(request: AdminFetch, toasts: ToastStore) {
  const list = signal<JobsListState>({ filter: null, list: null, pending: false, error: null })
  const repeating = signal<JobsRepeatingState>({ jobs: null, error: null, starting: null })
  const confirm = signal<JobsConfirmState>(NO_CONFIRM)
  const job = signal<JobsJobState>({ id: null, detail: null, error: null })
  const dialog = signal<JobsDialogState>(NO_DIALOG)

  const state = {
    list,
    repeating,
    confirm,
    job,
    dialog,

    async loadList(filter: AdminJobFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminJobFilterQuery(filter)
      const result = await request<AdminJobListResponse>(
        `/api/admin/jobs${query ? `?${query}` : ``}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    async loadRepeating(): Promise<void> {
      repeating.value = { ...repeating.value, error: null }
      const result = await request<{ jobs: AdminRepeatingJob[] }>(`/api/admin/jobs/repeating`)
      repeating.value = result.ok
        ? { ...repeating.value, jobs: result.data.jobs, error: null }
        : { ...repeating.value, error: result.error.message }
    },

    async loadJob(id: string): Promise<void> {
      if (job.value.id !== id) job.value = { id, detail: null, error: null }
      const result = await request<AdminJobDetail>(`/api/admin/jobs/${encodeURIComponent(id)}`)
      if (job.value.id !== id) return
      job.value = result.ok
        ? { id, detail: result.data, error: null }
        : { id, detail: null, error: result.error.message }
    },

    /** Runs a repeating job now: its next run becomes due, or its chain starts again. */
    async runRepeating(target: AdminRepeatingJob): Promise<boolean> {
      if (repeating.value.starting) return false
      repeating.value = { ...repeating.value, starting: target.kind }
      const result = await request<AdminJobActionResponse>(
        `/api/admin/jobs/repeating/${encodeURIComponent(target.kind)}/run-now`,
        post(),
      )
      repeating.value = { ...repeating.value, starting: null }
      if (result.ok) {
        toasts.success({ body: `${target.label} started.`, dataE2E: `admin-job-toast` })
      } else {
        toasts.error({
          body: result.status === 409 ? result.error.message : JOB_ACTION_FAILED,
          dataE2E: `admin-job-toast`,
        })
      }
      await state.loadRepeating()
      return result.ok
    },

    openConfirm(next: AdminJobsConfirm): void {
      confirm.value = { confirm: next, pending: false, error: null }
    },

    closeConfirm(): void {
      if (confirm.value.pending) return
      confirm.value = NO_CONFIRM
    },

    /** Sends the confirmed list action; on success the dialog closes and the lists read again. */
    async confirmOpen(): Promise<void> {
      const open = confirm.value.confirm
      if (!open || confirm.value.pending) return
      confirm.value = { confirm: open, pending: true, error: null }
      if (open.kind === `runRepeating`) {
        await state.runRepeating(open.job)
        confirm.value = NO_CONFIRM
        return
      }
      const result = await request<AdminJobRetryAllResponse>(`/api/admin/jobs/retry-failed`, post())
      if (!result.ok) {
        confirm.value = { confirm: open, pending: false, error: JOB_ACTION_FAILED }
        return
      }
      confirm.value = NO_CONFIRM
      const count = result.data.retried
      toasts.success({
        body: `${count} failed ${count === 1 ? `job` : `jobs`} started again.`,
        dataE2E: `admin-job-toast`,
      })
      if (list.value.filter) await state.loadList(list.value.filter)
    },

    openDialog(next: AdminJobAction): void {
      dialog.value = { dialog: next, pending: false, error: null }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends an action on the open run, confirmed or not. It asks for no password: the API records
     * the operator in the audit log. On success a toast names the job and the page shows the run
     * as the API answered it.
     */
    async act(action: AdminJobAction): Promise<void> {
      const { id, detail } = job.value
      if (!id || !detail || dialog.value.pending) return
      dialog.value = { ...dialog.value, pending: true, error: null }
      const result = await request<AdminJobActionResponse>(
        `/api/admin/jobs/${encodeURIComponent(id)}/${ACTION_PATHS[action]}`,
        post(),
      )
      if (result.ok) {
        dialog.value = NO_DIALOG
        toasts.success({
          body: `${detail.label} ${action === `cancel` ? `cancelled` : `started`}.`,
          dataE2E: `admin-job-toast`,
        })
        if (job.value.id === id && result.data.job) {
          job.value = { id, detail: result.data.job, error: null }
        }
        return
      }
      if (result.status === 409 || result.status === 404) {
        dialog.value = NO_DIALOG
        toasts.warning({ body: result.error.message, dataE2E: `admin-job-toast` })
        await state.loadJob(id)
        return
      }
      if (dialog.value.dialog) {
        dialog.value = { ...dialog.value, pending: false, error: JOB_ACTION_FAILED }
        return
      }
      dialog.value = NO_DIALOG
      toasts.error({ body: JOB_ACTION_FAILED, dataE2E: `admin-job-toast` })
    },
  }
  return state
}

export type JobsState = ReturnType<typeof createJobsState>
