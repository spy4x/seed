import { computed, signal } from "@preact/signals"
import { createOnboardingState, type OnboardingState } from "@spy4x/preact-signals/onboarding"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { OnboardingStatus } from "@domain/identity"
import { callCommand, callQuery } from "../modules.ts"

/** What the onboarding store needs from the outside. Injected so tests need no socket. */
export interface OnboardingDependencies {
  query<T>(name: string): Promise<T>
  command<T>(name: string): Promise<T>
}

/** The server's message for a refused call, or empty when the call never got an answer. */
function messageOf(cause: unknown): string {
  return cause instanceof RealtimeRequestError ? cause.message : ""
}

/**
 * The first-steps checklist and the tour: what the server says the person has done, and the two
 * answers it keeps for them, so both follow the person to every device. The steps are never ticked
 * here: the server is asked again when the home page opens and, while it is open, when a hint says
 * the person changed something in another tab.
 *
 * Whether the checklist shows is preact-components' `createOnboardingState`, with the server as
 * its port: Dismiss hides the card at once and brings it back if the server refused.
 */
export function createOnboardingStore(dependencies: OnboardingDependencies) {
  /** The last answer of the server; `null` until the first one, and after sign-out. */
  const status = signal<OnboardingStatus | null>(null)
  /** The library's store, made once the first answer says what is dismissed. */
  const shown = signal<OnboardingState | null>(null)
  /** Why the last Dismiss or tour answer was not saved: the server's message, or empty. */
  const error = signal<string | null>(null)
  const tourOpen = signal(false)
  const tourIndex = signal(0)

  const facts = computed(() =>
    Object.entries(status.value?.steps ?? {}).map(([id, done]) => ({ id, done }))
  )
  /** Whether the checklist is on the page: read, and not dismissed. */
  const visible = computed(() => shown.value?.visible.value ?? false)
  /** Whether the tour is still offered: the person has neither finished nor skipped it. */
  const tourOffered = computed(() => status.value !== null && !status.value.tourSeen)

  /** Counts the reads, so one that a later read or a save overtook is dropped. */
  let reads = 0
  /** Counts the sign-outs, so an answer for the person who left never reaches the next one. */
  let person = 0
  /** The saves still on their way. A read answered meanwhile is older than what the page shows. */
  let saving = 0
  /** Whether the page that draws the card is open. */
  let watching = false

  /** Takes the server's answer. The library reads its port once, so a flag that changed elsewhere
   * (another tab dismissed) needs a new library store. */
  function apply(answer: OnboardingStatus): void {
    status.value = answer
    if (shown.value !== null && shown.value.visible.value !== answer.dismissed) return
    const signedIn = person
    shown.value = createOnboardingState({
      steps: facts,
      dismissed: {
        read: () => answer.dismissed,
        write: async (value) => {
          // Nothing shows the checklist again, so only "dismissed" is ever written.
          if (!value) return
          const saved = await dependencies.command<OnboardingStatus>("onboarding.dismiss")
          if (signedIn === person) status.value = saved
        },
      },
    })
  }

  /**
   * Reads the steps and the two answers again. A read that a later read or a save overtook is
   * dropped. Once the checklist is dismissed nothing can show (the tour is offered on the card
   * only, and nothing brings the card back), so the server is not asked again.
   */
  async function refresh(): Promise<void> {
    if (status.value?.dismissed) return
    const read = ++reads
    const answer = await dependencies.query<OnboardingStatus>("onboarding.get")
    if (read !== reads || saving > 0) return
    apply(answer)
  }

  /** The page that draws the card opened: read, and follow hints until {@link close}. */
  function open(): Promise<void> {
    watching = true
    return refresh()
  }

  /** The page that draws the card closed. A tour left open is closed, and still offered. */
  function close(): void {
    watching = false
    tourOpen.value = false
  }

  /** A hint that the person changed something elsewhere: read again, if the card's page is open. */
  function hint(): Promise<void> {
    return watching ? refresh() : Promise.resolve()
  }

  /**
   * Runs one save. Reads already sent are dropped, and so is its own outcome when the person
   * signed out meanwhile: `failed` then never runs.
   */
  async function save(
    run: () => Promise<void>,
    failed: (cause: unknown) => void,
  ): Promise<void> {
    const signedIn = person
    reads++
    saving++
    try {
      await run()
    } catch (cause) {
      if (signedIn === person) failed(cause)
    } finally {
      if (signedIn === person) saving--
    }
  }

  /** Closes the checklist for good, on every device. It comes back if the server refuses. */
  async function dismiss(): Promise<void> {
    const state = shown.value
    if (state === null) return
    error.value = null
    tourOpen.value = false
    await save(async () => void await state.dismiss(), (cause) => error.value = messageOf(cause))
  }

  function startTour(): void {
    error.value = null
    tourIndex.value = 0
    tourOpen.value = true
  }

  /** Ends the tour and stops offering it, on every device. The offer returns if the save fails. */
  async function endTour(): Promise<void> {
    const before = status.value
    if (before === null) return
    const signedIn = person
    error.value = null
    tourOpen.value = false
    status.value = { ...before, tourSeen: true }
    await save(async () => {
      const saved = await dependencies.command<OnboardingStatus>("onboarding.tour-seen")
      if (signedIn === person) apply(saved)
    }, (cause) => {
      status.value = before
      error.value = messageOf(cause)
    })
  }

  /** Sign-out: forgets the person, and drops every read and save still on its way. */
  function reset(): void {
    reads++
    person++
    saving = 0
    status.value = null
    shown.value = null
    error.value = null
    tourOpen.value = false
    tourIndex.value = 0
  }

  return {
    status,
    visible,
    error,
    tourOffered,
    tourOpen,
    tourIndex,
    refresh,
    open,
    close,
    hint,
    dismiss,
    startTour,
    endTour,
    reset,
  }
}

/** The page's own store, over the socket. */
export const onboardingStore = createOnboardingStore({
  query: (name) => callQuery(name),
  command: (name) => callCommand(name, undefined),
})
