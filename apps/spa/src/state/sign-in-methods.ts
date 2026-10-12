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
  /** Starts linking `provider`: answers the provider's page to send the browser to. */
  link(provider: OAuthProviderId): Promise<Answer<{ url: string }>>
  /** Unlinks one method. `signedOut` when it was the one this device signed in with. */
  unlink(methodId: number): Promise<Answer<{ signedOut: boolean }>>
}

export const signInMethodsHttp: SignInMethodsHttp = {
  async list() {
    const result = await apiFetch<SignInMethodsResponse>("/api/auth/methods")
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, methods: result.data.methods, available: result.data.available }
  },
  async link(provider) {
    const result = await apiFetch<{ url: string }>(`/api/auth/methods/${provider}/link`, {
      method: "POST",
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, url: result.data.url }
  },
  async unlink(methodId) {
    const result = await apiFetch<{ signedOut: boolean }>(`/api/auth/methods/${methodId}`, {
      method: "DELETE",
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
    error.value = null
  }

  /** Sends the browser to `provider` to link it. A refusal sets `error` and stays on the page. */
  async function link(provider: OAuthProviderId): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    const answer = await attempt(() => http.link(provider))
    if (!answer.ok) {
      pending.value = false
      error.value = answer.error
      return
    }
    // Still pending: the page is about to be left.
    leave(answer.url)
  }

  /** Unlinks one method, then reads the list again unless this device was signed out with it. */
  async function unlink(methodId: number): Promise<UnlinkResult> {
    if (pending.value) return "failed"
    pending.value = true
    error.value = null
    const answer = await attempt(() => http.unlink(methodId))
    pending.value = false
    if (!answer.ok) {
      error.value = answer.error
      return "failed"
    }
    if (answer.signedOut) return "signed-out"
    await load()
    return "unlinked"
  }

  return { methods, available, error, pending, load, link, unlink }
}

export type SignInMethodsStore = ReturnType<typeof createSignInMethodsStore>
