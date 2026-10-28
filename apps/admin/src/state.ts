import { signal } from "@preact/signals"
import { apiFetch } from "@spy4x/platform/api"
import { canOpenAdmin, type EmailStatus, type User } from "@domain/identity"
import type { AuthCredentials } from "@spy4x/preact-system/auth-form"
import type { AdminOperator } from "@ui/admin-user-screen.tsx"
import { adminText } from "./i18n.ts"

/** One answer of the API: the data, or its status and message. */
export type AdminApiResult<T> = Awaited<ReturnType<typeof apiFetch<T>>>

/** What the API answers (202) while the session still owes its one-time code. */
type PendingSecondFactor = { secondFactor: "Pending" }

/** One call to the API: a path on the app's own origin and its request. */
export type AdminFetch = <T>(path: string, init?: RequestInit) => Promise<AdminApiResult<T>>

/**
 * The session calls the admin app makes, plus {@link AdminApi.fetch} for every module's own. Injected,
 * so the store's tests need no network.
 */
export interface AdminApi {
  me(): Promise<AdminApiResult<User | PendingSecondFactor>>
  signIn(credentials: AuthCredentials): Promise<AdminApiResult<User | PendingSecondFactor>>
  oneTimeCode(otp: string): Promise<AdminApiResult<User>>
  signOut(): Promise<AdminApiResult<unknown>>
  fetch: AdminFetch
}

/** A `POST` with `body` as JSON, or with no body. */
export const post = (body?: unknown): RequestInit => ({
  method: "POST",
  body: body === undefined ? undefined : JSON.stringify(body),
})

/** The calls to the API on the admin app's own origin, where the proxy sends `/api`. */
export const adminHttp: AdminApi = {
  me: () => apiFetch("/api/auth/me", {}),
  signIn: (credentials) => apiFetch("/api/auth/password/check", post(credentials)),
  oneTimeCode: (otp) => apiFetch("/api/auth/totp/check", post({ otp })),
  signOut: () => apiFetch("/api/auth/sign-out", post()),
  fetch: (path, init = {}) => apiFetch(path, init),
}

/** The message when a call failed without one of its own, as when the network is down. */
export function adminFailure(): string {
  return adminText().t(`AdminApp.failure`)
}

/** Where the session stands: being read, signed out, owing its code, or signed in. */
export type AdminSessionStep = "loading" | "credentials" | "one-time-code" | "signed-in"

export interface AdminSessionState {
  step: AdminSessionStep
  /** The signed-in person, below operator too: the app then says they have no access. */
  user: User | null
  busy: boolean
  error: string | null
}

/** The operator the person page needs: who they are and their role. */
export function operatorOf(user: User): AdminOperator {
  return { id: user.id, role: user.role }
}

/** Whether the signed-in person may use the app. The API decides on its own; this only says it. */
export function hasAdminAccess(user: User | null): boolean {
  return user !== null && canOpenAdmin(user.role)
}

/**
 * The display name of the signed-in operator: their name, else their address, as the product's
 * app shows a person with no name. "Operator" only for an account with neither.
 */
export function operatorName(user: User, email: string | null = null): string {
  return `${user.firstName} ${user.lastName}`.trim() || email || "Operator"
}

/** The signed-in operator's address, or `null` for an account without one or a failed read. */
export async function readOperatorEmail(request: AdminFetch): Promise<string | null> {
  const answer = await attempt(() => request<EmailStatus>(`/api/auth/email`))
  return answer.ok ? answer.data.email : null
}

/** Runs `call`, turning a thrown error (the network is down) into a failed answer. */
export async function attempt<T>(
  call: () => Promise<AdminApiResult<T>>,
): Promise<AdminApiResult<T>> {
  try {
    return await call()
  } catch {
    return { ok: false, status: 0, error: { message: adminFailure() } } as AdminApiResult<T>
  }
}

/**
 * The admin app's session: being read, signed out, owing its code, or signed in. Every module
 * calls the API through {@link request}: a 401 from any call means the session is gone (it ended
 * or the operator was blocked), and the app goes back to the sign-in.
 */
export function createAdminStore(api: AdminApi) {
  const session = signal<AdminSessionState>({
    step: "loading",
    user: null,
    busy: false,
    error: null,
  })

  function signedOut(error: string | null = null): void {
    session.value = { step: "credentials", user: null, busy: false, error }
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

  /** One call to the API for a module. A failed call answers its message; a 401 signs out. */
  const request: AdminFetch = async <T>(path: string, init?: RequestInit) => {
    const result = await attempt(() => api.fetch<T>(path, init))
    if (!result.ok && result.status === 401) signedOut()
    return result
  }

  return {
    session,
    request,
    /** Signs the app out after a 401 to a call that did not go through `request`. */
    signedOut: () => signedOut(),

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
        signedOut(adminText().t(`AdminApp.signInExpired`))
      } else {
        session.value = { ...session.value, busy: false, error: result.error.message }
      }
    },

    /** Ends the session. The page signs out even when the server cannot be reached. */
    async signOut(): Promise<void> {
      await attempt(() => api.signOut())
      signedOut()
    },
  }
}

export type AdminStore = ReturnType<typeof createAdminStore>
