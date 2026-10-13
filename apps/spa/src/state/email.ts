import { signal } from "@preact/signals"
import type { ApiResult } from "@spy4x/platform/api"
import type { EmailStatus } from "@domain/identity"
import { apiFetch } from "./api.ts"

/** The outcome of an e-mail call: done with the API's message, or its error for the form. */
export type EmailOutcome = { ok: true; message: string } | { ok: false; error: string }

/** `apiFetch`, or a test's stand-in for it. */
export type EmailFetch = <T>(url: string, init?: RequestInit) => Promise<ApiResult<T>>

/**
 * Where the signed-in person's address stands, and the calls that prove or change it. `status` is
 * `null` until it is read, and again after sign-out. A call that proves or changes the address
 * reads the status again, so the banner follows.
 */
export function createEmailStore(request: EmailFetch = apiFetch) {
  const status = signal<EmailStatus | null>(null)
  /** The last read failed. The page shows it, with a retry, while it has no status to show. */
  const loadFailed = signal(false)

  /** Reads the status again. Keeps the last one when the API cannot answer. */
  async function refresh(): Promise<void> {
    loadFailed.value = false
    try {
      const result = await request<EmailStatus>("/api/auth/email")
      if (result.ok) status.value = result.data
      else loadFailed.value = true
    } catch (_unreachable) {
      // Offline: the banner keeps what it showed.
      loadFailed.value = true
    }
  }

  /** Posts `body` to `path`. The message is empty when the API was out of reach. */
  async function post(path: string, body?: unknown): Promise<EmailOutcome> {
    let result: ApiResult<{ message?: string }>
    try {
      result = await request(path, {
        method: "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (_unreachable) {
      return { ok: false, error: "" }
    }
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, message: result.data.message ?? "" }
  }

  /** Checks the code from the mail. */
  async function verify(code: string): Promise<EmailOutcome> {
    const outcome = await post("/api/auth/email/verify", { code })
    // A wrong code changes nothing; a taken address drops the waiting change.
    await refresh()
    return outcome
  }

  /** Asks for a new code for the address waiting for one. */
  function send(): Promise<EmailOutcome> {
    return post("/api/auth/email/send")
  }

  /**
   * Asks to move to `email`; the current address stays until the new one's code is entered. An
   * account with no password sends none: its sign-in with a provider a moment ago confirms it.
   */
  async function change(email: string, password?: string): Promise<EmailOutcome> {
    // `JSON.stringify` leaves out an undefined password.
    const outcome = await post("/api/auth/email/change", { email, password })
    if (outcome.ok) await refresh()
    return outcome
  }

  function reset(): void {
    status.value = null
    loadFailed.value = false
  }

  return { status, loadFailed, refresh, verify, send, change, reset }
}

/** The app's e-mail store. */
export const emailStore = createEmailStore()
