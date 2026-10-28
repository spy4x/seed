import { RealtimeRequestError } from "@spy4x/realtime"
import { REALTIME_USER_HEADER } from "@spy4x/realtime/operations"
import {
  type AvailableCallPort,
  type CallPort,
  createComposedCallPort,
  createHttpCallPort,
  withUnauthorizedHook,
} from "@spy4x/realtime/calls"
import { apiFetch as send } from "@spy4x/platform/api"
import { errorText, translatedError } from "@ui/message.ts"
import { languages } from "../i18n.ts"
import { sessionState } from "./session.ts"

/**
 * What is this app's about the calls port (ADR 003): where the call route is, which user a call is
 * sent as, and what an `unauthorized` answer does to the page. The port itself, its retries and its
 * errors are the library's (`@spy4x/realtime/calls`).
 */

/** Where the API serves `POST <base>/<name>` (`apps/api/routes/call.ts`). */
export const CALL_BASE_URL = "/api/call"

/**
 * Signs the page out, as an answer of `unauthorized` must: the session ended, or the cookie now
 * belongs to somebody else. The app then drops the socket, the cursors and the data it holds.
 */
export function signOutPage(): void {
  if (sessionState.value.user === null && !sessionState.value.isMfaRequired) return
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false }
}

/** What {@link createAppCallPort} is built from. */
export interface AppCallPortOptions {
  /** The user the page was started for; every call names them. */
  userId: number
  /** The socket module's port, when the product has one: preferred while its socket is open. */
  socket?: AvailableCallPort
  /**
   * The socket's first open while it is pending, or `null`. A call made meanwhile waits for it
   * (the library's `firstOpenWait`), so the page's first reads do not go over HTTP beside a
   * socket that is about to open.
   */
  socketFirstOpen?: () => Promise<void> | null
  /** Defaults to {@link signOutPage}. */
  onUnauthorized?: () => void
  /** Defaults to the global `fetch`; a test passes its own. */
  fetch?: typeof fetch
}

/**
 * The calls port of one signed-in user: HTTP always, the socket in front of it when there is one.
 * An `unauthorized` answer over either signs the page out, which is how a page with no socket
 * learns that its session ended.
 */
export function createAppCallPort(options: AppCallPortOptions): CallPort {
  const http = createHttpCallPort({
    baseUrl: CALL_BASE_URL,
    userId: String(options.userId),
    fetch: options.fetch,
  })
  const { socket, socketFirstOpen } = options
  const port = socket
    ? createComposedCallPort({
      socket,
      http,
      firstOpenWait: socketFirstOpen && { pending: socketFirstOpen },
    })
    : http
  return withTranslatedErrors(withUnauthorizedHook(port, options.onUnauthorized ?? signOutPage))
}

/**
 * `port` whose refusals say their `message` in the page's language, translated by their code
 * through the `errors` catalog (#275). Code, reason, fields and details stay as the server sent
 * them, so a store still branches on them; anything else a call rejects with passes through.
 */
export function withTranslatedErrors<P extends CallPort>(port: P): P {
  const translate = async (call: () => Promise<unknown>): Promise<unknown> => {
    try {
      return await call()
    } catch (error) {
      if (!(error instanceof RealtimeRequestError)) throw error
      const message = errorText(languages.translator.peek(), error)
      throw new RealtimeRequestError(error.code, message, error.details, {
        ...(error.reason !== undefined ? { reason: error.reason } : {}),
        ...(error.fields !== undefined ? { fields: error.fields } : {}),
      })
    }
  }
  return {
    ...port,
    command: (name, payload, options) => translate(() => port.command(name, payload, options)),
    query: (name, payload, options) => translate(() => port.query(name, payload, options)),
  }
}

/**
 * Whether a call made now reaches the server as `userId`: the page is still signed in as them and
 * the browser has a network. The outbox sends only while this holds (`canSend`), so one person's
 * queue is never sent as another, over the socket or over HTTP.
 */
export function canCallAs(
  userId: number,
  isOnline: () => boolean = () => globalThis.navigator?.onLine !== false,
): boolean {
  return sessionState.value.user?.id === userId && !sessionState.value.isMfaRequired && isOnline()
}

/**
 * A request to a REST route, a read or a write. It names the user the page was started for, as a
 * call does, and an `unauthorized` answer signs the page out: the session ended, or the cookie now
 * belongs to somebody else. A refused read leaves a device copy alone; a refused write changes
 * nothing on the other user's account, because the server refuses it before the route runs.
 *
 * A page with nobody signed in names nobody and is never signed out by an answer: the start-up
 * read of `/api/auth/me`, the second-factor step and sign-in itself work as they always did.
 *
 * A refusal's `message` comes back in the page's language, translated by its code through the
 * `errors` catalog (#275), so a store shows it as it is.
 */
export async function apiAsUser<T>(path: string, init?: RequestInit, fetcher: typeof send = send) {
  const userId = sessionState.value.user?.id
  const result = userId === undefined
    ? await fetcher<T>(path, init)
    : await fetcher<T>(path, { ...init, headers: asUser(userId, init?.headers) })
  if (result.ok) return result
  if (userId !== undefined && result.status === 401) signOutPage()
  return { ...result, error: translatedError(languages.translator.peek(), result.error) }
}

/**
 * {@link apiAsUser} for a store that reads the answer itself, such as the invitations store, which
 * needs more of a refusal than `apiFetch` keeps. Same rule: the request names the page's user, and
 * a 401 signs the page out.
 */
export async function fetchAsUser(
  url: string,
  init?: RequestInit,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = globalThis.fetch,
): Promise<Response> {
  const userId = sessionState.value.user?.id
  if (userId === undefined) return await fetcher(url, init)
  const response = await fetcher(url, { ...init, headers: asUser(userId, init?.headers) })
  if (response.status === 401) signOutPage()
  return response
}

/** The caller's headers with the page's user named beside them. */
function asUser(userId: number, given?: HeadersInit): Record<string, string> {
  return { ...Object.fromEntries(new Headers(given)), [REALTIME_USER_HEADER]: String(userId) }
}
