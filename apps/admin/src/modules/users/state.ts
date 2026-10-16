import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import {
  type AdminUserDetail,
  type AdminUserFilter,
  adminUserFilterQuery,
  type AdminUserListResponse,
  type AdminUserRow,
} from "@domain/identity"
import type { AdminAction } from "@ui/admin-user-screen.tsx"
import { adminUserName } from "@ui/admin-users-screen.tsx"
import { type AdminFetch, post } from "../../state.ts"

/** Each action's path under `/api/admin/users/:id/`. */
const ACTION_PATHS: Record<AdminAction, string> = {
  block: "block",
  unblock: "unblock",
  "end-sessions": "sessions/end",
}

/** What the toast says after each action went through. */
const ACTION_DONE: Record<AdminAction, (name: string) => string> = {
  block: (name) => `${name} is blocked and signed out everywhere.`,
  unblock: (name) => `${name} can sign in again.`,
  "end-sessions": (name) => `Every session of ${name} has ended.`,
}

export interface UsersListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminUserFilter | null
  list: AdminUserListResponse | null
  pending: boolean
  error: string | null
}

export interface UsersPersonState {
  userId: number | null
  detail: AdminUserDetail | null
  error: string | null
}

export interface UsersDialogState {
  action: AdminAction | null
  /** Why the API refused the action, or `null`. */
  error: string | null
  pending: boolean
}

const NO_DIALOG: UsersDialogState = { action: null, error: null, pending: false }

/**
 * The users module's state: the list, the open person and the action dialog. Every call goes
 * through the app's `request`, which signs the app out on a 401, so this state never handles one.
 */
export function createUsersState(request: AdminFetch, toasts: ToastStore) {
  const list = signal<UsersListState>({ filter: null, list: null, pending: false, error: null })
  const person = signal<UsersPersonState>({ userId: null, detail: null, error: null })
  const dialog = signal<UsersDialogState>(NO_DIALOG)

  const state = {
    list,
    person,
    dialog,

    async loadList(filter: AdminUserFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const query = adminUserFilterQuery(filter)
      const result = await request<AdminUserListResponse>(
        `/api/admin/users${query ? `?${query}` : ""}`,
      )
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      list.value = result.ok
        ? { filter, list: result.data, pending: false, error: null }
        : { ...list.value, pending: false, error: result.error.message }
    },

    async loadPerson(userId: number): Promise<void> {
      if (person.value.userId !== userId) {
        person.value = { userId, detail: null, error: null }
      }
      const result = await request<AdminUserDetail>(`/api/admin/users/${userId}`)
      if (person.value.userId !== userId) return
      person.value = result.ok
        ? { userId, detail: result.data, error: null }
        : { userId, detail: null, error: result.error.message }
    },

    openDialog(action: AdminAction): void {
      dialog.value = { action, error: null, pending: false }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends the open dialog's action. It asks for no password: the API records the operator in the
     * audit trail. On success the dialog closes, a toast says what happened, and the person is read
     * again, so their sessions, status and activity show the change.
     */
    async act(): Promise<void> {
      const { action, pending } = dialog.value
      const { userId, detail } = person.value
      if (!action || pending || userId === null) return
      dialog.value = { action, error: null, pending: true }
      const result = await request<{ user: AdminUserRow }>(
        `/api/admin/users/${userId}/${ACTION_PATHS[action]}`,
        post(),
      )
      if (!result.ok) {
        dialog.value = { action, error: result.error.message, pending: false }
        return
      }
      dialog.value = NO_DIALOG
      const user = result.data?.user ?? detail?.user
      const name = user ? adminUserName(user) : "The person"
      toasts.success({ body: ACTION_DONE[action](name), dataE2E: "admin-action-toast" })
      await state.loadPerson(userId)
    },
  }
  return state
}

export type UsersState = ReturnType<typeof createUsersState>
