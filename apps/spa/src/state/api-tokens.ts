import { signal } from "@preact/signals"
import {
  API_TOKEN_DEFAULT_EXPIRY_DAYS,
  type ApiToken,
  ApiTokenAccess,
  type ApiTokenCreateRequest,
  type ApiTokenCreateResponse,
  ApiTokenError,
  type ApiTokenListResponse,
  parseApiTokenCreateRequest,
} from "@domain/api-tokens"
import type { ApiTokenFormValues } from "@ui/api-token-new-screen.tsx"
import { API_TOKEN_MESSAGES } from "@ui/api-tokens.tsx"
import { apiFetch } from "./api.ts"
import { type LocalReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"

/** The message shown when reading or revoking failed without a message of its own, by its key. */
export const API_TOKENS_FAILURE = API_TOKEN_MESSAGES.failed

/** The message under the form when a create failed without a message of its own, by its key. */
export const CREATE_FAILURE = API_TOKEN_MESSAGES.createFailed

/** The message under the name when the form is sent without one, by its key. */
export const NAME_MISSING = API_TOKEN_MESSAGES.nameMissing

/** The message under the password when the form is sent without one, by its key. */
export const PASSWORD_MISSING = API_TOKEN_MESSAGES.passwordMissing

/** One call's outcome: the data, or the message to show (the API's, or a catalog key). */
export type ApiTokensResult<T> = { ok: true; data: T } | {
  ok: false
  error: string
  status?: number
  /** The API's error code; absent when the answer carried none, as a proxy's does. */
  code?: string
}

/** What the store calls. Injected so tests need no network. */
export interface ApiTokensDependencies {
  list(): Promise<ApiTokensResult<ApiTokenListResponse>>
  create(request: ApiTokenCreateRequest): Promise<ApiTokensResult<ApiTokenCreateResponse>>
  revoke(tokenId: string): Promise<ApiTokensResult<unknown>>
}

/** The calls to `/api/tokens`, the session's own routes. */
export const apiTokensHttp: ApiTokensDependencies = {
  list: () => call(apiFetch<ApiTokenListResponse>("/api/tokens", {})),
  create: (request) =>
    call(
      apiFetch<ApiTokenCreateResponse>("/api/tokens", {
        method: "POST",
        body: JSON.stringify(request),
      }),
    ),
  revoke: (tokenId) =>
    call(apiFetch(`/api/tokens/${encodeURIComponent(tokenId)}`, { method: "DELETE" })),
}

async function call<T>(
  request: ReturnType<typeof apiFetch<T>>,
): Promise<ApiTokensResult<T>> {
  const result = await request
  return result.ok
    ? { ok: true, data: result.data }
    : { ok: false, error: result.error.message, status: result.status, code: result.error.reason }
}

/** The create form as it opens: the first group, read only, the default lifetime. */
export function emptyApiTokenForm(groupId: string): ApiTokenFormValues {
  return {
    name: "",
    password: "",
    groupId,
    access: ApiTokenAccess.READ,
    expiresInDays: API_TOKEN_DEFAULT_EXPIRY_DAYS,
  }
}

/**
 * The person's API tokens: the list and revoke for the profile, the form for the create page, what
 * is in flight and what failed. Each page makes its own store, so the secret of a new token lives
 * in the create page's `created` until the person presses Done or the page closes, and nowhere
 * else.
 */
export function createApiTokensStore(
  dependencies: ApiTokensDependencies,
  device: LocalReads = noLocalReads,
) {
  const tokens = signal<readonly ApiToken[] | null>(null)
  const values = signal<ApiTokenFormValues>(emptyApiTokenForm(""))
  const errors = signal<
    { list: string | null; name: string | null; password: string | null; form: string | null }
  >({
    list: null,
    name: null,
    password: null,
    form: null,
  })
  const pending = signal({ create: false, revoke: false })
  const created = signal<ApiTokenCreateResponse | null>(null)
  /**
   * When the list shown was taken from the server, in epoch milliseconds, while it is the device's
   * copy; `null` while it is the server's answer. A token revoked since may still be listed, so
   * the screen says how old the list is.
   */
  const savedAt = signal<number | null>(null)
  let reads = 0

  /**
   * Reads the list again; a refusal shows above the list and keeps the old one. When the server
   * is unreachable the device's copy answers, marked with its time.
   */
  async function load(): Promise<void> {
    const read = ++reads
    const show = (list: readonly ApiToken[], copyTakenAt: number | null) => {
      tokens.value = list
      savedAt.value = copyTakenAt
    }
    try {
      const answer = await device.through(
        READ_KEYS.apiTokens,
        async () => {
          const result = await dependencies.list()
          if (!result.ok) throw new ReadRefused(result.error, result.status ?? 0, result.code)
          return result.data.tokens
        },
        (copy) => {
          if (read !== reads) return false
          if (copy && tokens.value !== null) return false
          if (copy) return show(copy.value, copy.savedAt)
          tokens.value = null
          savedAt.value = null
        },
      )
      if (read !== reads) return
      show(answer.value, answer.fresh ? null : answer.savedAt)
      errors.value = { ...errors.value, list: null }
    } catch (cause) {
      if (!(cause instanceof ReadRefused)) throw cause
      if (read !== reads) return
      errors.value = { ...errors.value, list: String(cause.failure) || API_TOKENS_FAILURE }
    }
  }

  return {
    tokens,
    values,
    errors,
    pending,
    created,
    savedAt,
    load,

    /** Opens the form empty, for `groupId` first. */
    startCreate(groupId: string): void {
      values.value = emptyApiTokenForm(groupId)
      errors.value = { ...errors.value, name: null, password: null, form: null }
    },

    setValue<K extends keyof ApiTokenFormValues>(field: K, value: ApiTokenFormValues[K]): void {
      values.value = { ...values.value, [field]: value }
    },

    /**
     * Checks the form, then creates the token. A bad name or a missing password stays on the page
     * with its message and sends nothing. The API's refusal of the password shows on that field;
     * any other refusal shows under the form. The password leaves the form once the token exists.
     */
    async create(): Promise<void> {
      if (pending.value.create) return
      // Both fields are checked before anything shows, so an empty form names both at once.
      const password = values.value.password === "" ? PASSWORD_MISSING : null
      let request: ApiTokenCreateRequest | null = null
      let name: string | null = values.value.name.trim() === "" ? NAME_MISSING : null
      if (name === null) {
        try {
          // The parser wants a password; a stand-in lets it judge the name of a form without one.
          request = parseApiTokenCreateRequest(
            password === null ? values.value : { ...values.value, password: "-" },
          )
        } catch (error) {
          if (!(error instanceof ApiTokenError)) throw error
          // An error is a sentence, so it ends with a full stop; the parser's message has none.
          name = /[.!?]$/.test(error.message) ? error.message : `${error.message}.`
        }
      }
      if (request === null || password !== null) {
        errors.value = { ...errors.value, name, password, form: null }
        return
      }
      errors.value = { ...errors.value, name: null, password: null, form: null }
      pending.value = { ...pending.value, create: true }
      const result = await dependencies.create(request)
      pending.value = { ...pending.value, create: false }
      if (!result.ok) {
        errors.value = result.code === "PASSWORD_INVALID"
          ? { ...errors.value, password: result.error || CREATE_FAILURE }
          : { ...errors.value, form: result.error || CREATE_FAILURE }
        return
      }
      values.value = { ...values.value, password: "" }
      created.value = result.data
      tokens.value = [result.data.token, ...(tokens.value ?? [])]
      // The server answered, so the list is no longer the device's copy alone.
      savedAt.value = null
    },

    /** Forgets the secret of the token just created. */
    dismissSecret(): void {
      created.value = null
    },

    /** Revokes one token, then reads the list again. `true` when the token was revoked. */
    async revoke(tokenId: string): Promise<boolean> {
      errors.value = { ...errors.value, list: null }
      pending.value = { ...pending.value, revoke: true }
      const result = await dependencies.revoke(tokenId)
      await load()
      pending.value = { ...pending.value, revoke: false }
      if (!result.ok) {
        errors.value = { ...errors.value, list: result.error || API_TOKENS_FAILURE }
      }
      return result.ok
    },
  }
}

export type ApiTokensStore = ReturnType<typeof createApiTokensStore>
