import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { OnboardingStatus } from "@domain/identity"
import { createOnboardingStore } from "./onboarding.ts"

const fresh: OnboardingStatus = {
  steps: {
    emailVerified: false,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  },
  dismissed: false,
  tourSeen: false,
}

const allDone: OnboardingStatus = {
  ...fresh,
  steps: {
    emailVerified: true,
    noteCreated: true,
    memberInvited: true,
    notificationsOn: true,
    twoFactorOn: true,
  },
}

/**
 * A fake server holding one person's onboarding. A command waits until `accept` or `refuse` is
 * called. A read answers at once, unless `slowRead` was called: then the next read holds what the
 * server had when it was sent, and answers when the returned function is called.
 */
function harness(start: OnboardingStatus = fresh) {
  let server = start
  const commands: string[] = []
  const reads = { count: 0 }
  let waiting: { resolve(): void; reject(cause: unknown): void } | null = null
  let held: ((answer: () => void) => void) | null = null
  const store = createOnboardingStore({
    query: () => {
      reads.count++
      const sent = server
      if (held === null) return Promise.resolve(sent) as Promise<never>
      const hold = held
      held = null
      return new Promise<never>((resolve) => hold(() => resolve(sent as never)))
    },
    command: (name) => {
      commands.push(name)
      return new Promise<never>((resolve, reject) => {
        waiting = {
          resolve: () => {
            server = name === "onboarding.dismiss"
              ? { ...server, dismissed: true }
              : { ...server, tourSeen: true }
            resolve(server as never)
          },
          reject,
        }
      })
    },
  })
  return {
    store,
    commands,
    reads,
    /** Makes the next read slow; the returned function lets it answer. */
    slowRead: (): () => void => {
      let answer = () => {}
      held = (release) => answer = release
      return () => answer()
    },
    /** What another tab or a finished step changed on the server. */
    change: (next: Partial<OnboardingStatus>) => server = { ...server, ...next },
    accept: () => waiting!.resolve(),
    refuse: (cause: unknown) => waiting!.reject(cause),
  }
}

describe("onboarding store", () => {
  it("shows nothing until the server has answered, then the checklist of a new account", async () => {
    const { store } = harness()
    expect(store.visible.value).toBe(false)
    expect(store.tourOffered.value).toBe(false)

    await store.refresh()

    expect(store.visible.value).toBe(true)
    expect(store.tourOffered.value).toBe(true)
    expect(store.status.value?.steps.noteCreated).toBe(false)
  })

  it("ticks a step when the next read says it is done", async () => {
    const { store, change } = harness()
    await store.refresh()

    change({ steps: { ...fresh.steps, noteCreated: true } })
    await store.refresh()

    expect(store.status.value?.steps.noteCreated).toBe(true)
  })

  it("stays hidden for a person who dismissed it on another device", async () => {
    const { store } = harness({ ...fresh, dismissed: true })

    await store.refresh()

    expect(store.visible.value).toBe(false)
  })

  it("hides the checklist at once on dismiss and saves it as onboarding.dismiss", async () => {
    const { store, commands, accept } = harness()
    await store.refresh()

    const saving = store.dismiss()
    expect(store.visible.value).toBe(false)
    accept()
    await saving

    expect(commands).toEqual(["onboarding.dismiss"])
    expect(store.visible.value).toBe(false)
    expect(store.status.value?.dismissed).toBe(true)
    expect(store.error.value).toBe(null)
  })

  it("brings the checklist back with the server's message when the dismiss is refused", async () => {
    const { store, refuse } = harness()
    await store.refresh()

    const saving = store.dismiss()
    refuse(new RealtimeRequestError("rate_limited", "Try again later"))
    await saving

    expect(store.visible.value).toBe(true)
    expect(store.error.value).toBe("Try again later")
  })

  it("hides the checklist when a hint's read says another tab dismissed it", async () => {
    const { store, change } = harness()
    await store.refresh()

    change({ dismissed: true })
    await store.refresh()

    expect(store.visible.value).toBe(false)
  })

  it("starts the tour at its first step", async () => {
    const { store } = harness()
    await store.refresh()
    store.tourIndex.value = 2

    store.startTour()

    expect(store.tourOpen.value).toBe(true)
    expect(store.tourIndex.value).toBe(0)
  })

  it("closes the tour, stops offering it at once and saves it as onboarding.tour-seen", async () => {
    const { store, commands, accept } = harness()
    await store.refresh()
    store.startTour()

    const saving = store.endTour()
    expect(store.tourOpen.value).toBe(false)
    expect(store.tourOffered.value).toBe(false)
    accept()
    await saving

    expect(commands).toEqual(["onboarding.tour-seen"])
    expect(store.tourOffered.value).toBe(false)
  })

  it("offers the tour again, with an empty message, when saving its end never got an answer", async () => {
    const { store, refuse } = harness()
    await store.refresh()

    const saving = store.endTour()
    refuse(new Error("offline"))
    await saving

    expect(store.tourOffered.value).toBe(true)
    expect(store.tourOpen.value).toBe(false)
    expect(store.error.value).toBe("")
  })

  it("closes an open tour on dismiss", async () => {
    const { store, accept } = harness()
    await store.refresh()
    store.startTour()

    const saving = store.dismiss()
    expect(store.tourOpen.value).toBe(false)
    accept()
    await saving
  })

  it("does not ask the server again once the checklist is dismissed", async () => {
    const { store, reads, accept } = harness()
    await store.open()
    const saving = store.dismiss()
    accept()
    await saving
    expect(reads.count).toBe(1)

    await store.open()
    await store.hint()
    await store.refresh()

    expect(reads.count).toBe(1)
  })

  it("reads on a hint only while the page that draws the card is open", async () => {
    const { store, reads } = harness()
    await store.hint()
    expect(reads.count).toBe(0)

    await store.open()
    await store.hint()
    expect(reads.count).toBe(2)

    store.close()
    await store.hint()
    expect(reads.count).toBe(2)
  })

  it("closes an open tour when the card's page closes, and still offers it", async () => {
    const { store, commands } = harness()
    await store.open()
    store.startTour()

    store.close()

    expect(store.tourOpen.value).toBe(false)
    expect(store.tourOffered.value).toBe(true)
    expect(commands).toEqual([])
  })

  it("keeps the checklist hidden when a read sent before Dismiss answers during the save", async () => {
    const { store, slowRead, accept } = harness()
    await store.refresh()
    const answerRead = slowRead()
    const early = store.refresh()

    const saving = store.dismiss()
    answerRead()
    await early
    expect(store.visible.value).toBe(false)
    accept()
    await saving

    expect(store.visible.value).toBe(false)
    expect(store.status.value?.dismissed).toBe(true)
  })

  it("keeps the checklist hidden when a read sent during the save of Dismiss answers first", async () => {
    const { store, accept } = harness()
    await store.refresh()

    const saving = store.dismiss()
    await store.refresh()
    expect(store.visible.value).toBe(false)
    accept()
    await saving

    expect(store.visible.value).toBe(false)
  })

  it("does not offer the tour again when a read sent before its end answers afterwards", async () => {
    const { store, slowRead, accept } = harness()
    await store.refresh()
    const answerRead = slowRead()
    const early = store.refresh()

    const saving = store.endTour()
    accept()
    await saving
    answerRead()
    await early

    expect(store.tourOffered.value).toBe(false)
  })

  for (
    const [way, name] of [["tour end", "endTour"], ["dismiss", "dismiss"]] as const
  ) {
    it(`leaves the next person's checklist alone when the last person's ${way} fails after sign-out`, async () => {
      const { store, change, refuse } = harness(allDone)
      await store.refresh()
      const saving = store[name]()

      store.reset()
      change(fresh)
      await store.refresh()
      refuse(new RealtimeRequestError("rate_limited", "Try again later"))
      await saving

      expect(store.status.value).toEqual(fresh)
      expect(store.visible.value).toBe(true)
      expect(store.error.value).toBe(null)
    })

    it(`leaves the next person's checklist alone when the last person's ${way} is saved after sign-out`, async () => {
      const { store, change, accept } = harness(allDone)
      await store.refresh()
      const saving = store[name]()

      store.reset()
      change(fresh)
      await store.refresh()
      const next = store.status.value
      accept()
      await saving

      expect(store.status.value).toBe(next)
      expect(store.visible.value).toBe(true)
      expect(store.tourOffered.value).toBe(true)
    })

    it(`reads for the next person although the last person's ${way} never settled`, async () => {
      const { store, change } = harness(allDone)
      await store.refresh()
      void store[name]()

      store.reset()
      change(fresh)
      await store.refresh()

      expect(store.status.value).toEqual(fresh)
    })
  }

  it("forgets the message and the open tour on reset", async () => {
    const { store, refuse } = harness()
    await store.refresh()
    const saving = store.endTour()
    refuse(new RealtimeRequestError("rate_limited", "Try again later"))
    await saving
    store.startTour()
    store.error.value = "Try again later"
    store.tourIndex.value = 2

    store.reset()

    expect(store.error.value).toBe(null)
    expect(store.tourOpen.value).toBe(false)
    expect(store.tourIndex.value).toBe(0)
  })

  it("forgets everything on reset, and drops a read that was still on its way", async () => {
    const { store } = harness()
    await store.refresh()
    const late = store.refresh()

    store.reset()
    await late

    expect(store.status.value).toBe(null)
    expect(store.visible.value).toBe(false)
  })
})
