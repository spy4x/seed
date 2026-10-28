import { signal } from "@preact/signals"
import type { ToastStore } from "@spy4x/preact-signals/toast"
import {
  type AdminUserDetail,
  type AdminUserFilter,
  adminUserFilterQuery,
  type AdminUserListResponse,
  type AdminUserRow,
  type DataExportJson,
  USER_ROLE_NAMES,
} from "@domain/identity"
import type { AdminAction, AdminActionInput } from "@ui/admin-user-screen.tsx"
import { adminUserName } from "@ui/admin-users-screen.tsx"
import { type AdminFetch, post } from "../../state.ts"

/** Each action's path under `/api/admin/users/:id/`; ending one session names it. */
const ACTION_PATHS: Record<AdminAction, (input: AdminActionInput) => string> = {
  block: () => "block",
  unblock: () => "unblock",
  "end-sessions": () => "sessions/end",
  "end-session": (input) => `sessions/${input.sessionId}/end`,
  "change-role": () => "role",
  "password-reset": () => "password-reset",
  "delete-guest": () => "guest/delete",
  "unlink-telegram": () => "telegram/unlink",
  "remove-picture": () => "picture/remove",
}

/** What the toast says after each action went through. */
const ACTION_DONE: Record<AdminAction, (name: string, input: AdminActionInput) => string> = {
  block: (name) => `${name} is blocked and signed out everywhere.`,
  unblock: (name) => `${name} can sign in again.`,
  "end-sessions": (name) => `Every session of ${name} has ended.`,
  "end-session": (name) => `One session of ${name} has ended.`,
  "change-role": (name, input) =>
    `${name} is now ${input.role === undefined ? "on a new role" : USER_ROLE_NAMES[input.role]}.`,
  "password-reset": (name) => `A password-reset link is on its way to ${name}.`,
  "delete-guest": (name) => `The guest account ${name} is deleted.`,
  "unlink-telegram": (name) => `The Telegram account of ${name} is unlinked.`,
  "remove-picture": (name) => `The profile picture of ${name} is removed.`,
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
  /** The session an "end-session" dialog ends, or `null`. */
  sessionId: number | null
  /** Why the API refused the action, or `null`. */
  error: string | null
  pending: boolean
}

/** The person's "Data exports" tab: whose it is, what the API answered and why it failed. */
export interface UsersDataExportsState {
  userId: number | null
  exports: DataExportJson[] | null
  error: string | null
}

const NO_DIALOG: UsersDialogState = { action: null, sessionId: null, error: null, pending: false }

/**
 * The users module's state: the list, the open person and the action dialog. Every call goes
 * through the app's `request`, which signs the app out on a 401, so this state never handles one.
 */
export function createUsersState(request: AdminFetch, toasts: ToastStore) {
  const list = signal<UsersListState>({ filter: null, list: null, pending: false, error: null })
  const person = signal<UsersPersonState>({ userId: null, detail: null, error: null })
  const dialog = signal<UsersDialogState>(NO_DIALOG)
  const dataExports = signal<UsersDataExportsState>({ userId: null, exports: null, error: null })

  const state = {
    list,
    person,
    dialog,
    dataExports,

    /** Reads the person's data exports (#229), dropping an answer for a person the page has left. */
    async loadDataExports(userId: number): Promise<void> {
      if (dataExports.value.userId !== userId) {
        dataExports.value = { userId, exports: null, error: null }
      }
      const result = await request<{ exports: DataExportJson[] }>(
        `/api/admin/users/${userId}/data-exports`,
      )
      if (dataExports.value.userId !== userId) return
      dataExports.value = result.ok
        ? { userId, exports: result.data.exports, error: null }
        : { userId, exports: null, error: result.error.message }
    },

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

    openDialog(action: AdminAction, sessionId?: number): void {
      dialog.value = { action, sessionId: sessionId ?? null, error: null, pending: false }
    },

    closeDialog(): void {
      if (dialog.value.pending) return
      dialog.value = NO_DIALOG
    },

    /**
     * Sends the open dialog's action. It asks for no password: the API records the operator in the
     * audit trail. On success the dialog closes, a toast says what happened, and the person is read
     * again, so their sessions, status and activity show the change. A role change sends the role
     * picked in the dialog; ending one session sends the session the dialog was opened for. A
     * deleted guest is not read again: it answers `true`, and the page goes back to the list.
     */
    async act(picked: AdminActionInput = {}): Promise<boolean> {
      const { action, sessionId, pending } = dialog.value
      const { userId, detail } = person.value
      if (!action || pending || userId === null) return false
      if (action === "end-session" && sessionId === null) return false
      if (action === "change-role" && picked.role === undefined) return false
      const input: AdminActionInput = { ...picked, sessionId: sessionId ?? undefined }
      dialog.value = { action, sessionId, error: null, pending: true }
      const result = await request<{ user: AdminUserRow }>(
        `/api/admin/users/${userId}/${ACTION_PATHS[action](input)}`,
        post(action === "change-role" ? { role: picked.role } : undefined),
      )
      if (!result.ok) {
        dialog.value = { action, sessionId, error: result.error.message, pending: false }
        return false
      }
      dialog.value = NO_DIALOG
      const user = result.data?.user ?? detail?.user
      const name = user ? adminUserName(user) : "The person"
      toasts.success({ body: ACTION_DONE[action](name, input), dataE2E: "admin-action-toast" })
      if (action === "delete-guest") return true
      await state.loadPerson(userId)
      return false
    },
  }
  return state
}

export type UsersState = ReturnType<typeof createUsersState>
