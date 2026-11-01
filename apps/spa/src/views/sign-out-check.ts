import type { UnsentWait } from "../modules.ts"

/** What {@link createSignOutCheck} needs from the page. */
export interface SignOutCheckOptions {
  /** Reads the offline queue: what waits, or `null` when nothing does (`watchUnsentChanges`). */
  watch(): Promise<UnsentWait | null>
  /** Shows the question about the writes that wait. */
  ask(wait: UnsentWait): void
  /** Signs out at once. */
  signOutNow(): void
  /** Whether the page that asked is still shown. */
  mounted(): boolean
}

/**
 * The person's sign-out press: reads the queue, then asks about what waits or signs out at once. A
 * press while the queue is being read starts no second read, so a double press asks once. A page
 * gone before the read ends shows nothing and stops the wait.
 */
export function createSignOutCheck(
  { watch, ask, signOutNow, mounted }: SignOutCheckOptions,
): () => Promise<void> {
  let checking = false
  return async () => {
    if (checking) return
    checking = true
    try {
      const watched = await watch()
      if (!mounted()) watched?.dispose()
      else if (watched) ask(watched)
      else signOutNow()
    } finally {
      checking = false
    }
  }
}
