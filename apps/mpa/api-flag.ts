/** How long an answer is used before the API is asked again. */
export const API_FLAG_TTL_MS = 60_000

/** How long the API may take to answer. */
export const API_FLAG_TIMEOUT_MS = 2_000

/** One fact the website keeps from the API, such as the contact links; asked at most once a ttl. */
export interface ApiValue<T> {
  /**
   * The API's last answer, at once: no page waits for the API. An answer older than the ttl starts
   * a new question in the background, and the page that started it still gets the old answer. So
   * after a change the old state is shown until the first page view after the ttl, however long
   * the website stood idle.
   */
  current(): T
  /** Asks the API now and resolves when its answer is in. The website does this once at start. */
  refresh(): Promise<void>
}

/** One yes-or-no fact the website keeps from the API, such as whether the newsletter is on. */
export interface ApiFlag {
  /** {@link ApiValue.current} of a yes-or-no fact. */
  isOn(): boolean
  refresh(): Promise<void>
}

/** What {@link createApiValue} asks, and how it reads the answer. */
export interface ApiValueOptions<T> {
  apiUrl: string
  /** The API's `GET` address that answers the fact, such as `/api/subscribers`. */
  path: `/api/${string}`
  /** The value before the API has answered at all. */
  initial: T
  /** The value in a successful answer's JSON body, or `undefined` when the body does not say. */
  read: (body: unknown) => T | undefined
  fetch?: typeof globalThis.fetch
  now?: () => number
  ttlMs?: number
  timeoutMs?: number
}

/** What {@link createApiFlag} asks, and how it reads the answer. */
export type ApiFlagOptions = ApiValueOptions<boolean>

/**
 * A fact the website asks the API at most once per `ttlMs`. When the API cannot be reached, or
 * answers something `read` does not understand, the last answer stands; before any answer the
 * value is `initial`.
 */
export function createApiValue<T>(
  {
    apiUrl,
    path,
    initial,
    read,
    fetch = globalThis.fetch,
    now = Date.now,
    ttlMs = API_FLAG_TTL_MS,
    timeoutMs = API_FLAG_TIMEOUT_MS,
  }: ApiValueOptions<T>,
): ApiValue<T> {
  let value = initial
  let askedAt = -Infinity
  let pending: Promise<void> | null = null

  const ask = async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      const response = await fetch(new URL(path, apiUrl), { signal: abort.signal })
      const answer = response.ok ? read(await response.json()) : undefined
      if (answer !== undefined) value = answer
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
    current() {
      if (now() - askedAt >= ttlMs) void refresh()
      return value
    },
    refresh,
  }
}

/** {@link createApiValue} of a yes-or-no fact. */
export function createApiFlag(options: ApiFlagOptions): ApiFlag {
  const value = createApiValue(options)
  return { isOn: value.current, refresh: value.refresh }
}
