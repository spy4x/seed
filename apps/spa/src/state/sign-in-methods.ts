import { signal } from "@preact/signals"
import {
  createPasskey,
  type PasskeyBrowser,
  type PasskeyJSON,
} from "@spy4x/platform/browser/passkey"
import type {
  ApiSuccessResponse,
  OAuthProviderId,
  OAuthProvidersResponse,
  PasskeyAdded,
  PendingSignUp,
  PendingSignUpResponse,
  SignInMethod,
  SignInMethodsResponse,
} from "@domain/identity"
import type { Message } from "@ui/message.ts"
import type { PasskeyAddStatus } from "@ui/sign-in-methods.tsx"
import { apiFetch } from "./api.ts"
import { signInWithPasskey } from "./auth.ts"

/** What the card says when a passkey was refused by the server, or by the device for its reason. */
export const PASSKEY_NOT_SAVED: Message = { key: `SignInMethods.passkeyNotSaved` }
/** What the card says when the device already holds one of the person's passkeys. */
export const PASSKEY_ON_THIS_DEVICE: Message = { key: `SignInMethods.passkeyOnDevice` }

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
  /** The options for adding a passkey. `password` is the account's, when it has one. */
  passkeyOptions(password?: string): Promise<Answer<{ options: PasskeyCreationOptions }>>
  /** Stores the passkey the device made from those options. */
  addPasskey(credential: PasskeyJSON): Promise<Answer<PasskeyAdded>>
  /** Renames passkey `methodId`. */
  renamePasskey(methodId: number, name: string): Promise<Answer<{ name: string }>>
}

/** What `createPasskey` takes: the server's options for a new passkey. */
type PasskeyCreationOptions = Parameters<typeof createPasskey>[0]

export const signInMethodsHttp: SignInMethodsHttp = {
  async list() {
    const result = await apiFetch<SignInMethodsResponse>("/api/auth/methods")
    if (!result.ok) return { ok: false, error: result.error.message }
    return {
      ok: true,
      methods: result.data.methods,
      available: result.data.available,
      providerProofUntil: result.data.providerProofUntil ?? null,
      emailLink: result.data.emailLink ?? false,
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
  async passkeyOptions(password) {
    const result = await apiFetch<PasskeyCreationOptions>(`/api/auth/passkeys/add/options`, {
      method: "POST",
      body: JSON.stringify(password === undefined ? {} : { password }),
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, options: result.data }
  },
  async addPasskey(credential) {
    const result = await apiFetch<PasskeyAdded>(`/api/auth/passkeys`, {
      method: "POST",
      body: JSON.stringify(credential),
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, keyId: result.data.keyId, name: result.data.name }
  },
  async renamePasskey(methodId, name) {
    const result = await apiFetch<{ name: string }>(`/api/auth/passkeys/${methodId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    })
    if (!result.ok) return { ok: false, error: result.error.message }
    return { ok: true, name: result.data.name }
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
  passkeys: {
    browser?: PasskeyBrowser
    /** Signs in again with one of the person's passkeys; `auth.ts` by default. */
    confirm?: () => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>
  } = {},
) {
  /** `null` until the first read answers. */
  const methods = signal<readonly SignInMethod[] | null>(null)
  const available = signal<readonly OAuthProviderId[]>([])
  /**
   * Until when this device's sign-in with a provider confirms what an account with no password
   * cannot give a password for; `null` when it does not.
   */
  const providerProofUntil = signal<string | null>(null)
  /** The account has a proven address, so a sign-in link reaches it (#391). */
  const emailLink = signal(false)
  /** Why the last link or unlink failed; empty when the server gave no reason. */
  const error = signal<Message | null>(null)
  /**
   * Why the last read of the list failed; empty when the server gave no reason, as when it cannot
   * be reached. Kept apart from `error`, so a failed read is never told as a failed change.
   */
  const loadError = signal<string | null>(null)
  /** A read of the list is in flight. */
  const loading = signal(false)
  const pending = signal(false)
  /** The last passkey add: waiting for the device, cancelled there, or added. */
  const passkeyStatus = signal<PasskeyAddStatus | null>(null)

  /** One call: a thrown request counts as a failure without a reason. */
  async function attempt<T>(call: () => Promise<Answer<T>>): Promise<Answer<T>> {
    try {
      return await call()
    } catch (_unreachable) {
      return { ok: false, error: "" }
    }
  }

  /** Reads the list again; a failure sets `loadError` and keeps the list shown. */
  async function load(): Promise<void> {
    loading.value = true
    const answer = await attempt(http.list)
    loading.value = false
    if (!answer.ok) {
      loadError.value = answer.error
      return
    }
    methods.value = answer.methods
    available.value = answer.available
    providerProofUntil.value = answer.providerProofUntil
    emailLink.value = answer.emailLink
    loadError.value = null
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

  /**
   * Adds a passkey: the server's options, with the account's `password` when it has one, then the
   * device's dialog, then the server stores it and the list is read again.
   */
  async function addPasskey(password?: string): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    passkeyStatus.value = null
    const failed = async (message: Message) => {
      // As for a link: a refusal may mean the recent sign-in no longer counts.
      const list = await attempt(http.list)
      if (list.ok) providerProofUntil.value = list.providerProofUntil
      pending.value = false
      passkeyStatus.value = null
      error.value = message
    }
    const options = await attempt(() => http.passkeyOptions(password))
    if (!options.ok) return await failed(options.error)
    passkeyStatus.value = { kind: "waiting" }
    let credential: PasskeyJSON | null
    try {
      credential = await createPasskey(options.options, { browser: passkeys.browser })
    } catch (failure) {
      // The exclude list matched: this device holds one of the person's passkeys already.
      const already = failure instanceof Error && failure.name === "InvalidStateError"
      pending.value = false
      passkeyStatus.value = null
      error.value = already ? PASSKEY_ON_THIS_DEVICE : PASSKEY_NOT_SAVED
      return
    }
    if (!credential) {
      pending.value = false
      passkeyStatus.value = { kind: "cancelled" }
      return
    }
    const added = await attempt(() => http.addPasskey(credential))
    if (!added.ok) return await failed(added.error || PASSKEY_NOT_SAVED)
    await load()
    pending.value = false
    passkeyStatus.value = { kind: "added", keyId: added.keyId, name: added.name }
  }

  /** Renames a passkey; rejects with the server's reason, so the field stays open with the text. */
  async function renamePasskey(methodId: number, name: string): Promise<void> {
    const answer = await attempt(() => http.renamePasskey(methodId, name))
    if (!answer.ok) throw new Error(answer.error)
    // "Passkey added as …. Rename it if you like." is done once it has its new name.
    passkeyStatus.value = null
    methods.value =
      methods.value?.map((method) =>
        method.id === methodId && method.passkey
          ? { ...method, passkey: { ...method.passkey, name: answer.name } }
          : method
      ) ?? null
  }

  /**
   * Signs in again with one of the person's passkeys, which confirms a link, an unlink or a new
   * passkey for an account without a password. Reads the list again to learn until when.
   */
  async function confirmWithPasskey(): Promise<void> {
    if (pending.value) return
    pending.value = true
    error.value = null
    const confirm = passkeys.confirm ??
      (() => signInWithPasskey({ confirm: true, browser: passkeys.browser }))
    let answer
    try {
      answer = await confirm()
    } catch (_unreachable) {
      answer = { ok: false, error: "" }
    }
    pending.value = false
    if (!answer.ok) {
      if (!answer.cancelled) error.value = answer.error ?? ""
      return
    }
    await load()
  }

  return {
    methods,
    available,
    providerProofUntil,
    emailLink,
    error,
    loadError,
    loading,
    pending,
    passkeyStatus,
    load,
    link,
    unlink,
    addPasskey,
    renamePasskey,
    confirmWithPasskey,
  }
}

export type SignInMethodsStore = ReturnType<typeof createSignInMethodsStore>
