import {
  type AccountDeletionBlocker,
  type AccountDeletionStatus,
  type ApiSuccessResponse,
  type ExistingAccountAnswer,
  SIGN_IN_LINK_ASKED_ELSEWHERE_CODE,
  type SignedInDevice,
  type SignedInDevicesResponse,
  type SignInLinkRedeemed,
  type SignUpAccountExistsResponse,
  type SignUpGuestTakenResponse,
  type TotpConnectStartResponse,
  type User,
  UserMFAStatus,
  type WaitingPasswordSignUp,
  type WaitingPasswordSignUpResponse,
} from "@domain/identity"
import { browserStorage } from "@spy4x/platform/browser/storage"
import {
  getPasskey,
  type PasskeyBrowser,
  signalUnknownPasskey,
} from "@spy4x/platform/browser/passkey"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"
import { languages } from "../i18n.ts"
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

/** How a passkey sign-in ended, as the sign-in page and the proof dialogs tell it. */
export type PasskeySignInAnswer =
  | { ok: true; mfaRequired: boolean }
  /** The person closed the device's dialog, or the request was aborted: nothing to say. */
  | { ok: false; cancelled: true }
  /**
   * It failed. `picked` says whether the device gave a passkey and the server refused it; before
   * that, the server's options or the device itself failed.
   */
  | { ok: false; cancelled: false; picked: boolean; error: string }

/**
 * Signs in with a passkey (#222). Signed out, any passkey of the site will do, and `autofill`
 * waits for the person to pick one in the e-mail field. Signed in (`confirm`), only the person's
 * own passkeys count, and the new session confirms the steps an account without a password
 * confirms with a fresh sign-in. A passkey the server no longer knows is signalled to the device,
 * so it stops offering it.
 */
export async function signInWithPasskey(
  { autofill = false, confirm = false, signal, browser }: {
    autofill?: boolean
    confirm?: boolean
    signal?: AbortSignal
    browser?: PasskeyBrowser
  } = {},
): Promise<PasskeySignInAnswer> {
  const base = confirm ? "/api/auth/passkeys/confirm" : "/api/auth/passkeys/sign-in"
  const options = await apiFetch<Parameters<typeof getPasskey>[0]>(`${base}/options`, {
    method: "POST",
    signal,
  })
  if (!options.ok) {
    return { ok: false, cancelled: false, picked: false, error: options.error.message }
  }
  let credential
  try {
    credential = await getPasskey(options.data, { autofill, signal, browser })
  } catch (_failed) {
    // A device that refused for its own reason is told as "that did not work".
    return { ok: false, cancelled: false, picked: false, error: "" }
  }
  if (!credential) return { ok: false, cancelled: true }
  const result = await apiFetch<SessionUser | PendingSecondFactor>(base, {
    method: "POST",
    body: JSON.stringify(credential),
  })
  if (!result.ok && result.status === 404 && options.data.rpId) {
    await signalUnknownPasskey(options.data.rpId, credential.id, browser)
  }
  const answer = await handleAuthResponse(result)
  if (!answer.ok) return { ok: false, cancelled: false, picked: true, error: answer.error ?? "" }
  return { ok: true, mfaRequired: answer.mfaRequired }
}

/**
 * Answers "Create a new account" after a provider sign-in nobody here was known by: the server
 * creates the account the provider vouched for and signs it in.
 */
export async function confirmProviderSignUp(): Promise<{
  ok: boolean
  mfaRequired: boolean
  error?: string
}> {
  const result = await apiFetch<SessionUser | PendingSecondFactor>("/api/auth/sign-up/confirm", {
    method: "POST",
  })
  return handleAuthResponse(result)
}

/** What a request of the sign-up's code step answered (#142). */
export type SignUpStepAnswer =
  /** Done: a code is on its way, or the waiting sign-up was answered. */
  | { ok: true }
  /** No sign-up waits any more: the page shows "This sign-up expired". */
  | { ok: false; expired: true }
  /** Refused with a message to show; `offline` when the request never left the browser. */
  | { ok: false; expired?: false; error?: string; offline?: boolean }

/** The answer of a call that never reached the API, such as with the network off. */
const UNREACHED: SignUpStepAnswer = { ok: false, offline: true }

/**
 * Starts a sign-up with an address and a password. The API answers the same for every address and
 * mails a code to it; nobody is signed in yet. The code step (`verifySignUp`) comes next.
 */
export async function signUp(email: string, password: string): Promise<SignUpStepAnswer> {
  try {
    const result = await apiFetch<ApiSuccessResponse>("/api/auth/password/sign-up", {
      method: "POST",
      // The code mail is written in the language the page shows now (#277).
      body: JSON.stringify({ email, password, language: languages.translator.peek().language }),
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error.message }
  } catch (_unreachable) {
    return UNREACHED
  }
}

/**
 * The sign-up that waits for its code, `null` when none does, or `undefined` when the API could not
 * be reached and the page should keep asking.
 */
export async function readWaitingSignUp(): Promise<WaitingPasswordSignUp | null | undefined> {
  try {
    const result = await apiFetch<WaitingPasswordSignUpResponse>("/api/auth/password/sign-up")
    return result.ok ? result.data.pending : undefined
  } catch (_unreachable) {
    return undefined
  }
}

/** What the right code, or a wrong one, did to the waiting sign-up. */
export type SignUpVerifyAnswer =
  | SignUpStepAnswer
  /** An account already uses the address. Nothing was created; the sign-up is gone. */
  | { ok: false; accountExists: ExistingAccountAnswer }
  /** A guest's address belongs to another account: the choice waits on `/keep/taken` (#224). */
  | { ok: false; guestTaken: true }

/**
 * Enters the code of the waiting sign-up. The right one for a free address creates the account and
 * signs it in, as sign-in does; for an address an account uses it creates nothing and says so.
 */
export async function verifySignUp(code: string): Promise<SignUpVerifyAnswer> {
  let result
  try {
    result = await apiFetch<SessionUser | SignUpAccountExistsResponse | SignUpGuestTakenResponse>(
      "/api/auth/password/sign-up/verify",
      { method: "POST", body: JSON.stringify({ code }) },
    )
  } catch (_unreachable) {
    return UNREACHED
  }
  if (result.ok && "accountExists" in result.data) {
    return { ok: false, accountExists: result.data.accountExists }
  }
  if (result.ok && "guestTaken" in result.data) return { ok: false, guestTaken: true }
  if (!result.ok && result.status === 410) return { ok: false, expired: true }
  const signedIn = await handleAuthResponse(
    result as Awaited<ReturnType<typeof apiFetch<SessionUser | PendingSecondFactor>>>,
  )
  return signedIn.ok ? { ok: true } : { ok: false, error: signedIn.error }
}

/** Asks for a new code for the waiting sign-up. */
export async function resendSignUpCode(): Promise<SignUpStepAnswer> {
  try {
    const result = await apiFetch<ApiSuccessResponse>("/api/auth/password/sign-up/resend", {
      method: "POST",
    })
    if (result.ok) return { ok: true }
    return result.status === 410
      ? { ok: false, expired: true }
      : { ok: false, error: result.error.message }
  } catch (_unreachable) {
    return UNREACHED
  }
}

/** "Use a different address": forgets the waiting sign-up. Nothing was created. */
export async function cancelPasswordSignUp(): Promise<void> {
  // Best effort: a sign-up whose cancel never arrives expires by itself.
  await apiFetch<ApiSuccessResponse>("/api/auth/password/sign-up/cancel", { method: "POST" })
    .catch(() => {})
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

/**
 * The message of a refused request, or `undefined` when the server failed: a 5xx answer, such as a
 * proxy's page during a deploy, carries no message worth showing, so the screen says its own.
 */
function ownMessage(result: { status: number; error: { message: string } }): string | undefined {
  return result.status >= 500 ? undefined : result.error.message
}

/** How asking for a sign-in link ended (#391). */
export type SignInLinkRequestAnswer =
  | { ok: true }
  /** Refused: `field` when the address itself was, `offline` when the request never left. */
  | { ok: false; error?: string; field?: boolean; offline?: boolean }

/**
 * Asks for a sign-in link to `email`, opening `next` once used. The answer is the same whether or
 * not an account uses the address; the link signs in, or signs up when none does.
 */
export async function requestSignInLink(
  email: string,
  next: string | null,
): Promise<SignInLinkRequestAnswer> {
  try {
    const result = await apiFetch<ApiSuccessResponse>("/api/auth/link", {
      method: "POST",
      // The link's mail is written in the language the page shows now (#277).
      body: JSON.stringify({
        email,
        ...(next === null ? {} : { next }),
        language: languages.translator.peek().language,
      }),
    })
    if (result.ok) return { ok: true }
    return { ok: false, error: ownMessage(result), field: result.status === 400 }
  } catch (_unreachable) {
    return { ok: false, offline: true }
  }
}

/** How pressing Continue on a sign-in link's page ended (#391). */
export type SignInLinkRedeemAnswer =
  | { ok: true; answer: SignInLinkRedeemed }
  /** A guest's link reached an address another account uses: the choice waits on `/keep/taken`. */
  | { ok: false; guestTaken: true }
  /** The link was used, expired or never sent: a new one is the only way on. */
  | { ok: false; refused: true }
  /** A guest opened a link another browser asked for: it is spent, and the guest stays as before. */
  | { ok: false; askedElsewhere: true }
  /** Refused with a message; `offline` when the request never left, and the link is not spent. */
  | { ok: false; error?: string; offline?: boolean }

/** Spends the sign-in link `token`: signs in, or signs up when no account uses its address. */
export async function redeemSignInLink(token: string): Promise<SignInLinkRedeemAnswer> {
  let result
  try {
    result = await apiFetch<SignInLinkRedeemed | SignUpGuestTakenResponse>(
      "/api/auth/link/redeem",
      { method: "POST", body: JSON.stringify({ token }) },
    )
  } catch (_unreachable) {
    return { ok: false, offline: true }
  }
  if (!result.ok) {
    if (result.error.reason === SIGN_IN_LINK_ASKED_ELSEWHERE_CODE) {
      return { ok: false, askedElsewhere: true }
    }
    return result.status === 410
      ? { ok: false, refused: true }
      : { ok: false, error: ownMessage(result) }
  }
  if ("guestTaken" in result.data) return { ok: false, guestTaken: true }
  setSignOutOwed(false)
  return { ok: true, answer: result.data }
}

/**
 * Ends this browser's push subscription, so the account's notifications stop reaching it once
 * nobody is signed in here (#409). Never throws, and sign-out never waits for it: the browser
 * drops the subscription at once, also offline, and the server deletes its stored row the next
 * time the push service answers that the subscription is gone. `getRegistration` rather than
 * `ready`, which never settles in a browser without the service worker.
 */
async function dropPushSubscription(): Promise<void> {
  try {
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager?.getSubscription()
    await subscription?.unsubscribe()
  } catch (_error) {
    // A browser that refuses has nothing this page can do about it; the profile page's device
    // list still removes the stored subscription.
  }
}

export async function signOut(): Promise<void> {
  void dropPushSubscription()
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

/**
 * Sets the first password of an account that has none. The server takes it only after a sign-in
 * with a provider a moment ago.
 */
export async function setPassword(
  newPassword: string,
  otp?: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/password/set", {
    method: "POST",
    // With two-factor on, the authenticator code goes along.
    body: JSON.stringify(otp === undefined ? { newPassword } : { newPassword, otp }),
  })
  return result.ok ? { ok: true } : { ok: false, error: result.error.message }
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
      code: result.error.reason,
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

/**
 * Starts turning two-factor on. The API asks for proof that it is the account's owner (#406): the
 * password, or for an account without one, which sends none, a provider sign-in a moment ago.
 */
export async function totpConnectStart(password: string | undefined): Promise<
  | { ok: true; qrcode: string; secret: string }
  | { ok: false; error: string }
> {
  const result = await apiFetch<TotpConnectStartResponse>(
    "/api/auth/totp/connect/start",
    // `JSON.stringify` leaves out the password an account does not have.
    { method: "POST", body: JSON.stringify({ password }) },
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

/**
 * Turns two-factor off. The API asks for proof that it is the account's owner: the password, or a
 * current authenticator code for an account that has no password.
 */
export async function totpDisconnect(
  proof: { password: string } | { otp: string },
): Promise<{ ok: boolean; error?: string }> {
  const result = await apiFetch<ApiSuccessResponse>("/api/auth/totp/disconnect", {
    method: "POST",
    body: JSON.stringify(proof),
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
 * On success the server has ended every session of this person, so the page is signed out too,
 * after `leave` has moved it to a page open to anyone: signed out on a page for signed-in people,
 * the app would send it to sign-in with that page as next.
 * `blocked` means groups stop it: {@link readAccountDeletionBlockers} names them.
 */
export async function deleteAccount(
  password: string | undefined,
  otp?: string,
  leave?: () => void,
): Promise<
  | { ok: true; deleteAfter: Date }
  | { ok: false; blocked: boolean; error: string }
> {
  const result = await apiFetch<{ deleteAfter: string }>("/api/auth/account/delete", {
    method: "POST",
    // `JSON.stringify` leaves out an undefined code, and the password an account does not have.
    body: JSON.stringify({ password, otp }),
  })
  if (!result.ok) {
    return { ok: false, blocked: result.status === 409, error: result.error.message }
  }
  leave?.()
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
  return { ok: true, deleteAfter: new Date(result.data.deleteAfter) }
}

/** Records the signed-in user's new MFA status, so the profile page shows the right control. */
function setUserMfa(mfa: UserMFAStatus): void {
  const user = sessionState.value.user
  if (!user) return
  sessionState.value = { ...sessionState.value, user: { ...user, mfa } }
}
