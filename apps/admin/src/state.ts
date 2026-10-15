import { signal } from "@preact/signals"
import { apiFetch } from "@spy4x/platform/api"
import {
  type AdminUserDetail,
  type AdminUserFilter,
  adminUserFilterQuery,
  type AdminUserListResponse,
  type AdminUserRow,
  canOpenAdmin,
  type User,
} from "@domain/identity"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import type { AdminAction, AdminOperator } from "@ui/admin-user-screen.tsx"

/** One answer of the API: the data, or its status and message. */
export type AdminApiResult<T> = Awaited<ReturnType<typeof apiFetch<T>>>

/** What the API answers (202) while the session still owes its one-time code. */
type PendingSecondFactor = { secondFactor: "Pending" }

/** Every call the admin app makes. Injected, so the store's tests need no network. */
export interface AdminApi {
  me(): Promise<AdminApiResult<User | PendingSecondFactor>>
  signIn(credentials: AuthCredentials): Promise<AdminApiResult<User | PendingSecondFactor>>
  oneTimeCode(otp: string): Promise<AdminApiResult<User>>
  signOut(): Promise<AdminApiResult<unknown>>
  list(filter: AdminUserFilter): Promise<AdminApiResult<AdminUserListResponse>>
  detail(userId: number): Promise<AdminApiResult<AdminUserDetail>>
  act(userId: number, action: AdminAction): Promise<AdminApiResult<{ user: AdminUserRow }>>
}

/** Each action's path under `/api/admin/users/:id/`. */
const ACTION_PATHS: Record<AdminAction, string> = {
  block: "block",
  unblock: "unblock",
  "end-sessions": "sessions/end",
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
})

/** The calls to the API on the admin app's own origin, where the proxy sends `/api`. */
export const adminHttp: AdminApi = {
  me: () => apiFetch("/api/auth/me", {}),
  signIn: (credentials) => apiFetch("/api/auth/password/check", post(credentials)),
  oneTimeCode: (otp) => apiFetch("/api/auth/totp/check", post({ otp })),
  signOut: () => apiFetch("/api/auth/sign-out", post()),
  list: (filter) => {
    const query = adminUserFilterQuery(filter)
    return apiFetch(`/api/admin/users${query ? `?${query}` : ""}`, {})
  },
  detail: (userId) => apiFetch(`/api/admin/users/${userId}`, {}),
  act: (userId, action) => apiFetch(`/api/admin/users/${userId}/${ACTION_PATHS[action]}`, post()),
}

/** The message when a call failed without one of its own, as when the network is down. */
export const ADMIN_FAILURE = "Something went wrong. Try again."

/** Where the session stands: being read, signed out, owing its code, or signed in. */
export type AdminSessionStep = "loading" | "credentials" | "one-time-code" | "signed-in"

export interface AdminSessionState {
  step: AdminSessionStep
  /** The signed-in person, below operator too: the app then says they have no access. */
  user: User | null
  busy: boolean
  error: string | null
}

export interface AdminListState {
  /** The filter of the page the list shows, or is loading. */
  filter: AdminUserFilter | null
  list: AdminUserListResponse | null
  pending: boolean
  error: string | null
}

export interface AdminPersonState {
  userId: number | null
  detail: AdminUserDetail | null
  error: string | null
}

export interface AdminDialogState {
  action: AdminAction | null
  /** Why the API refused the action, or `null`. */
  error: string | null
  pending: boolean
}

const NO_DIALOG: AdminDialogState = { action: null, error: null, pending: false }

/** The operator the person page needs: who they are and their role. */
export function operatorOf(user: User): AdminOperator {
  return { id: user.id, role: user.role }
}

/** Whether the signed-in person may use the app. The API decides on its own; this only says it. */
export function hasAdminAccess(user: User | null): boolean {
  return user !== null && canOpenAdmin(user.role)
}

/** The display name of the signed-in operator. */
export function operatorName(user: User): string {
  return `${user.firstName} ${user.lastName}`.trim() || "Operator"
}

async function attempt<T>(call: () => Promise<AdminApiResult<T>>): Promise<AdminApiResult<T>> {
  try {
    return await call()
  } catch {
    return { ok: false, status: 0, error: { message: ADMIN_FAILURE } } as AdminApiResult<T>
  }
}

/**
 * The admin app's state: the session, the user list, the open person and the action dialog. A 401
 * from any call means the session is gone (it ended or the person was blocked), and the app goes
 * back to the sign-in.
 */
export function createAdminStore(api: AdminApi) {
  const session = signal<AdminSessionState>({
    step: "loading",
    user: null,
    busy: false,
    error: null,
  })
  const list = signal<AdminListState>({ filter: null, list: null, pending: false, error: null })
  const person = signal<AdminPersonState>({ userId: null, detail: null, error: null })
  const dialog = signal<AdminDialogState>(NO_DIALOG)

  function signedOut(error: string | null = null): void {
    session.value = { step: "credentials", user: null, busy: false, error }
    list.value = { filter: null, list: null, pending: false, error: null }
    person.value = { userId: null, detail: null, error: null }
    dialog.value = NO_DIALOG
  }

  /** Applies a sign-in answer: a user signs in, a 202 asks for the code. */
  function applySignIn(result: AdminApiResult<User | PendingSecondFactor>): void {
    if (!result.ok) {
      session.value = { ...session.value, busy: false, error: result.error.message }
      return
    }
    if (result.status === 202) {
      session.value = { step: "one-time-code", user: null, busy: false, error: null }
      return
    }
    session.value = { step: "signed-in", user: result.data as User, busy: false, error: null }
  }

  const store = {
    session,
    list,
    person,
    dialog,

    /** Reads the session the cookie holds, if any. */
    async start(): Promise<void> {
      const result = await attempt(() => api.me())
      if (result.ok) return applySignIn(result)
      if (result.status === 401) return signedOut()
      session.value = { step: "credentials", user: null, busy: false, error: result.error.message }
    },

    async signIn(credentials: AuthCredentials): Promise<void> {
      if (session.value.busy) return
      session.value = { ...session.value, busy: true, error: null }
      applySignIn(await attempt(() => api.signIn(credentials)))
    },

    async oneTimeCode(otp: string): Promise<void> {
      if (session.value.busy) return
      session.value = { ...session.value, busy: true, error: null }
      const result = await attempt(() => api.oneTimeCode(otp))
      if (result.ok) {
        session.value = { step: "signed-in", user: result.data, busy: false, error: null }
      } else if (result.status === 401) {
        signedOut("The sign-in expired. Sign in again.")
      } else {
        session.value = { ...session.value, busy: false, error: result.error.message }
      }
    },

    /** Ends the session. The page signs out even when the server cannot be reached. */
    async signOut(): Promise<void> {
      await attempt(() => api.signOut())
      signedOut()
    },

    async loadList(filter: AdminUserFilter): Promise<void> {
      list.value = { ...list.value, filter, pending: true, error: null }
      const result = await attempt(() => api.list(filter))
      // An answer for a filter the page has left is dropped.
      if (list.value.filter !== filter) return
      if (result.ok) {
        list.value = { filter, list: result.data, pending: false, error: null }
      } else if (result.status === 401) {
        signedOut()
      } else {
        list.value = { ...list.value, pending: false, error: result.error.message }
      }
    },

    async loadPerson(userId: number): Promise<void> {
      if (person.value.userId !== userId) {
        person.value = { userId, detail: null, error: null }
      }
      const result = await attempt(() => api.detail(userId))
      if (person.value.userId !== userId) return
      if (result.ok) person.value = { userId, detail: result.data, error: null }
      else if (result.status === 401) signedOut()
      else person.value = { userId, detail: null, error: result.error.message }
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
     * audit trail. On success the dialog closes and the person is read again, so their sessions,
     * status and audit trail show what changed.
     */
    async act(): Promise<void> {
      const { action, pending } = dialog.value
      const userId = person.value.userId
      if (!action || pending || userId === null || !session.value.user) return
      dialog.value = { action, error: null, pending: true }
      const result = await attempt(() => api.act(userId, action))
      if (result.ok) {
        dialog.value = NO_DIALOG
        await store.loadPerson(userId)
        return
      }
      if (result.status === 401) return signedOut()
      dialog.value = { action, error: result.error.message, pending: false }
    },
  }
  return store
}

export type AdminStore = ReturnType<typeof createAdminStore>
