import {
  type AccountDeletionBlocker,
  type AccountDeletionStatus,
  type ApiSuccessResponse,
  type SignedInDevice,
  type SignedInDevicesResponse,
  type TotpConnectStartResponse,
  type User,
  UserMFAStatus,
} from "@domain/identity"
import { browserStorage } from "@spy4x/platform/browser/storage"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"
import { apiFetch } from "./api.ts"
import { PendingSecondFactor, sessionState, SessionUser } from "./session.ts"

const SIGN_OUT_OWED = "auth:sign-out-owed"

/**
 * The browser's storage for the flag. It never throws: while the browser blocks storage, the flag
 * is remembered until the page closes.
 */
const browserFlags = browserStorage()

let flagStorage: KeyValueStore | undefined

/** Where the "sign-out owed" flag lives. Tests pass their own; `undefined` means the browser's. */
export function useFlagStorage(storage: KeyValueStore | undefined): void {
  flagStorage = storage
}

function flags(): KeyValueStore {
  return flagStorage ?? browserFlags
}

function setSignOutOwed(owed: boolean): void {
  if (owed) flags().setItem(SIGN_OUT_OWED, "1")
  else flags().removeItem(SIGN_OUT_OWED)
}

function isSignOutOwed(): boolean {
  return flags().getItem(SIGN_OUT_OWED) === "1"
}

/**
 * Ends the server's session if an earlier sign-out could not reach it. The flag is cleared only
 * when the server answers with success; while it is unreachable or failing, the flag stays.
 * Resolves whether it is settled.
 */
export async function settleOwedSignOut(): Promise<boolean> {
  if (!isSignOutOwed()) return true
  try {
    const result = await apiFetch<ApiSuccessResponse>("/api/auth/sign-out", { method: "POST" })
    if (!result.ok) return false
    setSignOutOwed(false)
    return true
  } catch (_unreachable) {
    return false
  }
}

/**
 * Asks the server who is signed in. When the server cannot be reached at all, `recall` may name
 * the user this browser last saw signed in, so the app opens offline; without it, or with none
 * remembered, the person is signed out. An error answer other than 401 is read the same way: a
 * proxy's 502 during a deploy, a 500 or a 429 says nothing about the session.
 */
export async function bootstrapSession(
  recall?: () => SessionUser | null,
): Promise<void> {
  // A sign-out made offline is finished first, and the person stays signed out, even while the
  // server is still out of reach (`recall` is not used then).
  if (isSignOutOwed()) {
    await settleOwedSignOut()
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: null,
      isMfaRequired: false,
    }
    return
  }
  let me: Awaited<ReturnType<typeof apiFetch<User | PendingSecondFactor>>>
  try {
    me = await apiFetch<User | PendingSecondFactor>("/api/auth/me")
  } catch (_unreachable) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      user: recall?.() ?? null,
      isMfaRequired: false,
    }
    return
  }
  if (!me.ok) {
    sessionState.value = {
      ...sessionState.value,
      isReady: true,
      // Only a 401 is the server saying that nobody is signed in.
      user: me.status === 401 ? null : recall?.() ?? null,
      isMfaRequired: false,
    }
    return
  }
  // 202 carries no profile: the session owes its one-time code, so there is no user yet.
  const isMfaRequired = me.status === 202
  // A 2xx without a profile (a maintenance page, a captive portal, an empty body) is not the API's
  // answer and says nothing about the session either.
  const profile = me.data as Partial<User> | null
  const user = typeof profile?.id === "number" ? profile as User : recall?.() ?? null
  sessionState.value = {
    ...sessionState.value,
    user: isMfaRequired ? null : user,
    isMfaRequired,
    isReady: true,
  }
}

async function handleAuthResponse(
  result: Awaited<ReturnType<typeof apiFetch<SessionUser | PendingSecondFactor>>>,
): Promise<{ ok: boolean; mfaRequired: boolean; error?: string }> {
  if (!result.ok) {
    return { ok: false, mfaRequired: false, error: result.error.message }
  }
  const mfaRequired = result.status === 202
  setSignOutOwed(false)
  sessionState.value = {
    ...sessionState.value,
    user: mfaRequired ? null : result.data as User,
    isMfaRequired: mfaRequired,
    isReady: true,
  }
  return { ok: true, mfaRequired }
}

/** Signs in with an e-mail address, or the username of an account made before addresses. */
export async function signIn(login: string, password: string): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser | PendingSecondFactor>("/api/auth/password/check", {
    method: "POST",
    body: JSON.stringify({ login, password }),
  })
  return handleAuthResponse(result)
}

export async function signUp(email: string, password: string): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser | PendingSecondFactor>("/api/auth/password/sign-up", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  })
  return handleAuthResponse(result)
}

/**
 * Asks for a reset link to `email`. The answer is the same whether or not an account uses it;
 * `message` is the API's wording of it.
 */
export async function requestPasswordReset(
  email: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const result = await apiFetch<{ success: boolean; message: string }>(
    "/api/auth/password/forgot",
    { method: "POST", body: JSON.stringify({ email }) },
  )
  if (!result.ok) return { ok: false, error: result.error.message }
  return { ok: true, message: result.data.message }
}

/** Sets a new password with the address and code of a reset link. Signs nobody in. */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ email, code, newPassword }),
  })
  if (!result.ok) return { ok: false, error: result.error.message }
  return { ok: true }
}

export async function signOut(): Promise<void> {
  try {
    const result = await apiFetch<ApiSuccessResponse>("/api/auth/sign-out", { method: "POST" })
    // An error answer (a proxy's 502 during a deploy) has not ended the session either. A 401 is
    // different: the cookie is now another user's (or nobody's), so this page has no session to
    // end, and owing the sign-out would end the other user's session at the next start.
    setSignOutOwed(!result.ok && result.status !== 401)
  } catch (_unreachable) {
    // Offline: the page still signs out, and the sign-out is owed to the server. It is sent at
    // the next start and when the browser comes back online; until then the server's session
    // stays valid, so nobody else may be shown as this person.
    setSignOutOwed(true)
  }
  sessionState.value = {
    ...sessionState.value,
    user: null,
    isMfaRequired: false,
  }
}

export async function checkTotp(otp: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<SessionUser>("/api/auth/totp/check", {
    method: "POST",
    body: JSON.stringify({ otp }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  setSignOutOwed(false)
  sessionState.value = {
    ...sessionState.value,
    user: result.data,
    isMfaRequired: false,
  }
  return { ok: true }
}

/**
 * Changes the password; `signOutOthers` also ends every other session of the person. The change
 * revokes every API token of the person: `revokedTokens` says how many.
 */
export async function changePassword(
  password: string,
  newPassword: string,
  signOutOthers = true,
): Promise<{ ok: boolean; error?: string; revokedTokens?: number }> {
  const result = await apiFetch<
    ApiSuccessResponse & { revokedTokens?: number }
  >("/api/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ password, newPassword, signOutOthers }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true, revokedTokens: result.data.revokedTokens ?? 0 }
}

/** The devices the person is signed in on, this one first. */
export async function listSessions(): Promise<
  { ok: true; sessions: SignedInDevice[] } | {
    ok: false
    error: string
    status?: number
    code?: string
  }
> {
  const result = await apiFetch<SignedInDevicesResponse>("/api/auth/sessions")
  if (!result.ok) {
    return {
      ok: false,
      error: result.error.message,
      status: result.status,
      code: result.error.code,
    }
  }
  return { ok: true, sessions: result.data.sessions }
}

/** Signs one other device out. */
export async function endSession(sessionId: number): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>(`/api/auth/sessions/${sessionId}`, {
    method: "DELETE",
  })
  if (!result.ok) return { ok: false, error: result.error.message }
  return { ok: true }
}

/** Signs out every device but this one. */
export async function endOtherSessions(): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/sessions/others", {
    method: "DELETE",
  })
  if (!result.ok) return { ok: false, error: result.error.message }
  return { ok: true }
}

export async function totpConnectStart(): Promise<
  | { ok: true; qrcode: string; secret: string }
  | { ok: false; error: string }
> {
  const result = await apiFetch<TotpConnectStartResponse>(
    "/api/auth/totp/connect/start",
    { method: "POST" },
  )
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  return { ok: true, qrcode: result.data.qrcode, secret: result.data.secret }
}

export async function totpConnectFinish(otp: string): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/connect/finish", {
    method: "POST",
    body: JSON.stringify({ otp }),
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  setUserMfa(UserMFAStatus.CONFIGURED)
  return { ok: true }
}

export async function totpDisconnect(): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/disconnect", {
    method: "POST",
  })
  if (!result.ok) {
    return { ok: false, error: result.error.message }
  }
  setUserMfa(UserMFAStatus.NOT_CONFIGURED)
  return { ok: true }
}

/** The groups that stop the signed-in person from deleting their account. */
export async function readAccountDeletionBlockers(): Promise<
  | { ok: true; blockers: AccountDeletionBlocker[] }
  | { ok: false; error: string }
> {
  const result = await apiFetch<AccountDeletionStatus>("/api/auth/account/deletion")
  if (!result.ok) return { ok: false, error: result.error.message }
  return { ok: true, blockers: result.data.blockers }
}

/**
 * Asks the server to delete the account, with the password and, when two-factor is on, a code.
 * On success the server has ended every session of this person, so the page is signed out too.
 * `blocked` means groups stop it: {@link readAccountDeletionBlockers} names them.
 */
export async function deleteAccount(password: string, otp?: string): Promise<
  | { ok: true; deleteAfter: Date }
  | { ok: false; blocked: boolean; error: string }
> {
  const result = await apiFetch<{ deleteAfter: string }>("/api/auth/account/delete", {
    method: "POST",
    // `JSON.stringify` leaves out an undefined code.
    body: JSON.stringify({ password, otp }),
  })
  if (!result.ok) {
    return { ok: false, blocked: result.status === 409, error: result.error.message }
  }
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  return { ok: true, deleteAfter: new Date(result.data.deleteAfter) }
}

/** Records the signed-in user's new MFA status, so the profile page shows the right control. */
function setUserMfa(mfa: UserMFAStatus): void {
  const user = sessionState.value.user
  if (!user) return
  sessionState.value = { ...sessionState.value, user: { ...user, mfa } }
}
