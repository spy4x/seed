import { isRecord } from "@spy4x/platform/universal/is-record"

/**
 * The browser's request headers the API needs: the two headers the API's cross-site guard checks,
 * and what its rate limits record. The MPA has no session, so no cookie passes either way. All pass
 * on unchanged, except an `Origin` equal to the MPA's own when the MPA has its own domain (see
 * `createApi`). The MPA never adds `Origin` or `Sec-Fetch-Site` itself, so it cannot vouch for a
 * post the browser did not make.
 */
const FORWARDED_HEADERS = [
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-forwarded-for",
  "x-real-ip",
] as const

/** An API answer: its status and its parsed JSON body (`null` when it has none). */
export interface ApiAnswer {
  status: number
  body: unknown
  /** The API's `Retry-After`, sent with a 429, for the page to pass on. */
  retryAfter?: string
}

/** Calls the API on behalf of one browser request. */
export interface Api {
  /**
   * Never rejects. An API that cannot be reached answers as status 502, and one that takes longer
   * than the timeout as 504, both with a `null` body, so a page shows its own error.
   */
  call(method: string, path: `/api/${string}`, json?: unknown): Promise<ApiAnswer>
}

/** How long one API call may take before the page answers without it. */
export const API_TIMEOUT_MS = 10_000

/**
 * An API client bound to one browser request. Each call carries the request's
 * {@link FORWARDED_HEADERS}; a `Set-Cookie` the API answers with never reaches the browser.
 *
 * `remoteAddress` fills `X-Real-IP` when no proxy in front of the MPA set it, so the API's rate
 * limits count the browser, not the MPA.
 *
 * `origins` is set when the MPA has its own domain (`MPA_DOMAIN`). The API accepts posts only from
 * its own origin, so a browser `Origin` equal to `origins.page` reaches the API as `origins.api`.
 * That is safe because `pageMiddleware` has already refused every post whose `Origin` is not the
 * MPA's own; any other value, `null` included, passes on unchanged for the API to judge.
 *
 * A failed call is told to `log` as its method, its path without the query, and the kind of
 * failure. The error itself is never logged: it names the full address, and a newsletter call's
 * query holds the visitor's token.
 */
export function createApi(
  {
    apiUrl,
    request,
    remoteAddress,
    origins,
    fetch = globalThis.fetch,
    timeoutMs = API_TIMEOUT_MS,
    log = console.error,
  }: {
    apiUrl: string
    request: Request
    origins?: { page: string; api: string }
    remoteAddress: string
    fetch?: typeof globalThis.fetch
    timeoutMs?: number
    log?: (line: string) => void
  },
): Api {
  return {
    async call(method, path, json) {
      const headers = new Headers()
      for (const name of FORWARDED_HEADERS) {
        const value = request.headers.get(name)
        if (value !== null) headers.set(name, value)
      }
      if (origins && headers.get("origin") === origins.page) headers.set("origin", origins.api)
      if (!headers.has("x-real-ip") && remoteAddress) headers.set("x-real-ip", remoteAddress)
      if (json !== undefined) headers.set("content-type", "application/json")
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeoutMs)
      try {
        const response = await fetch(new URL(path, apiUrl), {
          method,
          headers,
          body: json === undefined ? undefined : JSON.stringify(json),
          redirect: "manual",
          signal: abort.signal,
        })
        const text = await response.text()
        let body: unknown = null
        try {
          body = text ? JSON.parse(text) : null
        } catch {
          body = null
        }
        const retryAfter = response.headers.get("retry-after")
        return retryAfter === null
          ? { status: response.status, body }
          : { status: response.status, body, retryAfter }
      } catch (error) {
        const timedOut = abort.signal.aborted
        const kind = timedOut ? "timeout" : error instanceof Error ? error.name : "error"
        log(`API call failed: ${method} ${path.split("?")[0]} (${kind})`)
        return { status: timedOut ? 504 : 502, body: null }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * The message of an API error, from the one shape the API answers with:
 * `{ error: { code, message, … } }` (docs/api-errors.md).
 */
export function errorMessage(answer: ApiAnswer, fallback: string): string {
  if (!isRecord(answer.body)) return fallback
  const { error } = answer.body
  if (isRecord(error) && typeof error.message === "string") return error.message
  return fallback
}
