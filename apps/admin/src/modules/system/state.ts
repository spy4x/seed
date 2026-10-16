import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import type { AdminFailedJob, AdminSystemSnapshot } from "@domain/identity"
import { type AdminFetch, post } from "../../state.ts"

export interface SystemReadState {
  snapshot: AdminSystemSnapshot | null
  pending: boolean
  error: string | null
}

export interface SystemRetryState {
  job: AdminFailedJob | null
  pending: boolean
  error: string | null
}

const NO_RETRY: SystemRetryState = { job: null, pending: false, error: null }

/**
 * The System module's state: the last reading of the stack and the confirmation of running a
 * failed job again. Every call goes through the app's `request`, which signs the app out on a 401.
 */
export function createSystemState(request: AdminFetch, toasts: ToastStore) {
  const read = signal<SystemReadState>({ snapshot: null, pending: false, error: null })
  const retry = signal<SystemRetryState>(NO_RETRY)

  const state = {
    read,
    retry,

    /** Reads the stack again. The last reading stays on screen until the new one arrives. */
    async refresh(): Promise<void> {
      if (read.value.pending) return
      read.value = { ...read.value, pending: true, error: null }
      const result = await request<AdminSystemSnapshot>(`/api/admin/system`)
      read.value = result.ok
        ? { snapshot: result.data, pending: false, error: null }
        : { ...read.value, pending: false, error: result.error.message }
    },

    openRetry(job: AdminFailedJob): void {
      retry.value = { job, pending: false, error: null }
    },

    closeRetry(): void {
      if (retry.value.pending) return
      retry.value = NO_RETRY
    },

    /**
     * Runs the open job again. It asks for no password: the API records the operator in the audit
     * log. On success the dialog closes, a toast says so and the page reads the stack again, so the
     * job leaves the failed list.
     */
    async confirmRetry(): Promise<void> {
      const { job, pending } = retry.value
      if (!job || pending) return
      retry.value = { job, pending: true, error: null }
      const result = await request<{ retried: true }>(
        `/api/admin/system/jobs/${encodeURIComponent(job.id)}/retry`,
        post(),
      )
      if (!result.ok) {
        retry.value = { job, pending: false, error: result.error.message }
        return
      }
      retry.value = NO_RETRY
      toasts.success({ body: `${job.kind} runs again.`, dataE2E: "admin-retry-toast" })
      await state.refresh()
    },
  }
  return state
}

export type SystemState = ReturnType<typeof createSystemState>
