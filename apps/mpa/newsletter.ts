import { isRecord } from "@spy4x/platform/universal/is-record"

/** How long an answer about the newsletter is used before the API is asked again. */
export const NEWSLETTER_STATUS_TTL_MS = 60_000

/** How long the API may take to say whether the newsletter is on. */
export const NEWSLETTER_STATUS_TIMEOUT_MS = 2_000

/** What the website knows about the newsletter. */
export interface NewsletterStatus {
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

/**
 * Whether the API takes newsletter subscriptions (`GET /api/subscribers`), so that no page offers
 * a form the API would refuse. The API is asked at most once per `ttlMs`.
 *
 * When the API cannot be reached, or answers something else, the last answer stands. Before any
 * answer the newsletter counts as on: the form then shows the API's own refusal.
 */
export function createNewsletterStatus(
  {
    apiUrl,
    fetch = globalThis.fetch,
    now = Date.now,
    ttlMs = NEWSLETTER_STATUS_TTL_MS,
    timeoutMs = NEWSLETTER_STATUS_TIMEOUT_MS,
  }: {
    apiUrl: string
    fetch?: typeof globalThis.fetch
    now?: () => number
    ttlMs?: number
    timeoutMs?: number
  },
): NewsletterStatus {
  let enabled = true
  let askedAt = -Infinity
  let pending: Promise<void> | null = null

  const ask = async () => {
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), timeoutMs)
    try {
      const response = await fetch(new URL("/api/subscribers", apiUrl), { signal: abort.signal })
      const body: unknown = await response.json()
      if (response.ok && isRecord(body) && typeof body.enabled === "boolean") enabled = body.enabled
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
      return enabled
    },
    refresh,
  }
}
