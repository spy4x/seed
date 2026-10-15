import { signal } from "@preact/signals"
import type {
  ApiSuccessResponse,
  OAuthProviderId,
  OAuthProvidersResponse,
  PendingSignUp,
  PendingSignUpResponse,
  SignInMethod,
  SignInMethodsResponse,
} from "@domain/identity"
import { apiFetch } from "./api.ts"

/** An answer that worked, with what it carried, or one that did not, with the server's reason. */
type Answer<T> = ({ ok: true } & T) | { ok: false; error: string }

/** The providers a person can sign in with; none when the read fails, so no dead button shows. */
export async function listProviders(): Promise<OAuthProviderId[]> {
  try {
    const result = await apiFetch<OAuthProvidersResponse>("/api/auth/providers")
    return result.ok && Array.isArray(result.data?.providers) ? result.data.providers : []
  } catch (_unreachable) {
    return []
  }
}

/** The provider sign-up that waits for this browser's answer, or `null` when none does. */
export async function readPendingSignUp(): Promise<PendingSignUp | null> {
  try {
    const result = await apiFetch<PendingSignUpResponse>("/api/auth/sign-up/pending")
    return result.ok ? result.data?.pending ?? null : null
  } catch (_unreachable) {
    return null
  }
}

/** "I already have an account": forgets the waiting sign-up. Nothing was created. */
export async function cancelSignUp(): Promise<void> {
  // Best effort: an answer that never arrives leaves a token that expires by itself.
  await apiFetch<ApiSuccessResponse>("/api/auth/sign-up/cancel", { method: "POST" })
    .catch(() => {})
}

/** The calls the sign-in methods card makes. The store takes them, so a test passes its own. */
export interface SignInMethodsHttp {
  list(): Promise<Answer<SignInMethodsResponse>>
  /**
   * Starts linking `provider`: answers the provider's page to send the browser to. `password` is
   * the account's, when it has one.
   */
  link(provider: OAuthProviderId, password?: string): Promise<Answer<{ url: string }>>
  /**
   * Unlinks one method. `password` is the account's, when it has one. `signedOut` when it was the
   * one this device signed in with.
   */
  unlink(methodId: number, password?: string): Promise<Answer<{ signedOut: boolean }>>
}

export const signInMethodsHttp: SignInMethodsHttp = {
  async list() {
    const result = await apiFetch<SignInMethodsResponse>("/api/auth/methods")
    if (!result.ok) return { ok: false, error: result.error.message }
    return {
      ok: true,
      methods: result.data.methods,
      available: result.data.available,
      providerProofUntil: result.data.providerProofUntil ?? null,
    }
  },
  async link(provider, password) {
    const result = await apiFetch<{ url: string }>(`/api/auth/methods/${provider}/link`, {
      method: "POST",
      body: JSON.stringify(password === undefined ? {} : { password }),
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, url: result.data.url }
  },
  async unlink(methodId, password) {
    const result = await apiFetch<{ signedOut: boolean }>(`/api/auth/methods/${methodId}`, {
      method: "DELETE",
      body: JSON.stringify(password === undefined ? {} : { password }),
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, signedOut: result.data.signedOut === true }
  },
}

/** What {@link createSignInMethodsStore} did with an unlink. */
export type UnlinkResult = "unlinked" | "signed-out" | "failed"

/**
 * The account's sign-in methods, for the profile page: the list, linking a provider and unlinking
 * one. `leave` sends the browser to the provider; a test passes its own.
 */
export function createSignInMethodsStore(
  http: SignInMethodsHttp = signInMethodsHttp,
  leave: (url: string) => void = (url) => location.assign(url),
) {
  /** `null` until the first read answers. */
  const methods = signal<readonly SignInMethod[] | null>(null)
  const available = signal<readonly OAuthProviderId[]>([])
  /**
   * Until when this device's sign-in with a provider confirms what an account with no password
   * cannot give a password for; `null` when it does not.
   */
  const providerProofUntil = signal<string | null>(null)
  /** Why the last read or change failed; empty when the server gave no reason. */
  const error = signal<string | null>(null)
  const pending = signal(false)

  /** One call: a thrown request counts as a failure without a reason. */
  async function attempt<T>(call: () => Promise<Answer<T>>): Promise<Answer<T>> {
    try {
      return await call()
    } catch (_unreachable) {
      return { ok: false, error: "" }
    }
  }

  /** Reads the list again; a failure sets `error` and keeps the list shown. */
  async function load(): Promise<void> {
    const answer = await attempt(http.list)
    if (!answer.ok) {
      error.value = answer.error
      return
    }
    methods.value = answer.methods
    available.value = answer.available
    providerProofUntil.value = answer.providerProofUntil
    error.value = null
  }

  /**
   * Sends the browser to `provider` to link it, with the account's `password` when it has one. A
   * refusal sets `error` and stays on the page.
   */
  async function link(provider: OAuthProviderId, password?: string): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    const answer = await attempt(() => http.link(provider, password))
    if (!answer.ok) {
      // A refusal may mean the provider sign-in is no longer recent: read until when it is, and
      // keep the refusal shown.
      const list = await attempt(http.list)
      if (list.ok) providerProofUntil.value = list.providerProofUntil
      pending.value = false
      error.value = answer.error
      return
    }
    // Still pending: the page is about to be left.
    leave(answer.url)
  }

  /**
   * Unlinks one method, with the account's `password` when it has one, then reads the list again
   * unless this device was signed out with it.
   */
  async function unlink(methodId: number, password?: string): Promise<UnlinkResult> {
    if (pending.value) return "failed"
    pending.value = true
    error.value = null
    const answer = await attempt(() => http.unlink(methodId, password))
    if (!answer.ok) {
      // As for a link: the provider sign-in may no longer be recent.
      const list = await attempt(http.list)
      if (list.ok) providerProofUntil.value = list.providerProofUntil
      pending.value = false
      error.value = answer.error
      return "failed"
    }
    pending.value = false
    if (answer.signedOut) return "signed-out"
    await load()
    return "unlinked"
  }

  return { methods, available, providerProofUntil, error, pending, load, link, unlink }
}

export type SignInMethodsStore = ReturnType<typeof createSignInMethodsStore>
