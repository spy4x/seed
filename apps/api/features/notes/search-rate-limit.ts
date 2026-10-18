import { type Clock, createStoreLimiter, type RateLimitStore } from "@spy4x/platform/rate-limit"

/** Note searches one person may run per {@link NOTE_SEARCH_WINDOW_MS}, from every device. */
export const NOTE_SEARCHES_PER_USER = 120

/** The window of the note search limit: one minute. */
export const NOTE_SEARCH_WINDOW_MS = 60_000

/** What the search limit is built from. */
export interface NoteSearchLimitSettings {
  /** Builds the store of one limiter; `name` is its key prefix. */
  store: (name: string) => RateLimitStore
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Builds the per-person search budget: `true` while the person may search again. The palette
 * searches as a person types, so the budget is generous; it stops a script, not a fast typist.
 *
 * It fails open: when the store is down the search runs. A search reads only the person's own
 * notes, so a missing limit costs database time, never someone else's data, and an outage of the
 * store must not take search away from everyone.
 */
export function createNoteSearchLimit(
  settings: NoteSearchLimitSettings,
): (userId: number) => Promise<boolean> {
  const limiter = createStoreLimiter(settings.store(`ratelimit-note-search`), {
    windowMs: NOTE_SEARCH_WINDOW_MS,
    limit: NOTE_SEARCHES_PER_USER,
    clock: settings.clock,
  })
  return async (userId) => {
    try {
      return (await limiter.check(`user:${userId}`)).allowed
    } catch {
      return true
    }
  }
}
