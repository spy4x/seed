/** How long an answer is used before the API is asked again. */
export const API_FLAG_TTL_MS = 60_000

/** How long the API may take to answer. */
export const API_FLAG_TIMEOUT_MS = 2_000

/** One yes-or-no fact the website keeps from the API, such as whether the newsletter is on. */
export interface ApiFlag {
  /**
   * The API's last answer, at once: no page waits for the API. An answer older than the ttl starts
   * a new question in the background, and the page that started it still gets the old answer. So
   * after a change the old state is shown until the first page view after the ttl, however long
   * the website stood idle.
   */
  isOn(): boolean
  /** Asks the API now and resolves when its answer is in. The website does this once at start. */
  refresh(): Promise<void>
}

/** What {@link createApiFlag} asks, and how it reads the answer. */
export interface ApiFlagOptions {
  apiUrl: string
  /** The API's `GET` address that answers the fact, such as `/api/subscribers`. */
  path: `/api/${string}`
  /** The flag before the API has answered at all. */
  initial: boolean
  /** The flag in a successful answer's JSON body, or `undefined` when the body does not say. */
  read: (body: unknown) => boolean | undefined
  fetch?: typeof globalThis.fetch
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
}

/**
 * A fact the website asks the API at most once per `ttlMs`. When the API cannot be reached, or
 * answers something `read` does not understand, the last answer stands; before any answer the
 * flag is `initial`.
 */
export function createApiFlag(
  {
    apiUrl,
    path,
    initial,
    read,
    fetch = globalThis.fetch,
    now = Date.now,
    ttlMs = API_FLAG_TTL_MS,
    timeoutMs = API_FLAG_TIMEOUT_MS,
  }: ApiFlagOptions,
): ApiFlag {
  let on = initial
  let askedAt = -Infinity
  let pending: Promise<void> | null = null

  const ask = async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      const response = await fetch(new URL(path, apiUrl), { signal: abort.signal })
      const answer = response.ok ? read(await response.json()) : undefined
      if (answer !== undefined) on = answer
    } catch {
      // The last answer stands.
    } finally {
      clearTimeout(timer)
      askedAt = now()
    }
  }
  const refresh = () => {
    pending ??= ask().finally(() => {
      pending = null
    })
    return pending
  }

  return {
    isOn() {
      if (now() - askedAt >= ttlMs) void refresh()
      return on
    },
    refresh,
  }
}
