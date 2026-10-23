import { signal } from "@preact/signals"
import type { AdminSystemSnapshot } from "@domain/identity"
import type { AdminFetch } from "../../state.ts"

export interface SystemReadState {
  snapshot: AdminSystemSnapshot | null
  pending: boolean
  error: string | null
}

/**
 * The System module's state: the last reading of the stack. Every call goes through the app's
 * `request`, which signs the app out on a 401.
 */
export function createSystemState(request: AdminFetch) {
  const read = signal<SystemReadState>({ snapshot: null, pending: false, error: null })

  const state = {
    read,

    /** Reads the stack again. The last reading stays on screen until the new one arrives. */
    async refresh(): Promise<void> {
      if (read.value.pending) return
      read.value = { ...read.value, pending: true, error: null }
      const result = await request<AdminSystemSnapshot>(`/api/admin/system`)
      read.value = result.ok
        ? { snapshot: result.data, pending: false, error: null }
        : { ...read.value, pending: false, error: result.error.message }
    },
  }
  return state
}

export type SystemState = ReturnType<typeof createSystemState>
