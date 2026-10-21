/**
 * The first-steps card wired to its store, in a browser DOM (happy-dom): when the card is on the
 * page, and where keyboard focus is after Dismiss removes it.
 */
import "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import type { OnboardingStatus } from "@domain/identity"
import { createOnboardingStore } from "../state/onboarding.ts"
import { selectionStore } from "../state/selection.ts"
import { OnboardingView } from "./OnboardingView.tsx"

const window = new Window({ url: "http://app.localhost/" })
const NAMES = [
  "document",
  "location",
  "history",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "HTMLElement",
  "Element",
] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)

beforeAll(() => {
  // Preact draws into `document`, the router reads `location` and `history`, and the library's
  // tour needs the rest (see `libs/ui/onboarding.test.tsx`).
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
})

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

/** A store over a fake server that holds one person's onboarding and may refuse to save. */
function storeOver(start: OnboardingStatus, { refuse = false } = {}) {
  let server = start
  const commands: string[] = []
  const reads = { count: 0 }
  const store = createOnboardingStore({
    query: () => {
      reads.count++
      return Promise.resolve(server) as Promise<never>
    },
    command: (name) => {
      commands.push(name)
      if (refuse) return Promise.reject(new Error("offline"))
      server = name === "onboarding.dismiss"
        ? { ...server, dismissed: true }
        : { ...server, tourSeen: true }
      return Promise.resolve(server) as Promise<never>
    },
  })
  return { store, commands, reads }
}

/** The card above the home page's heading, as the app's frame draws it; waits for the first read. */
async function mount(store: ReturnType<typeof createOnboardingStore>): Promise<void> {
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(async () => {
    render(
      <main>
        <OnboardingView store={store} />
        <h1 tabIndex={-1}>Profile</h1>
      </main>,
      root!,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Focuses the button with this name and presses it, then lets the server's answer land. */
async function press(name: string): Promise<void> {
  const button = [...window.document.querySelectorAll("button")]
    .find((b) => b.textContent?.trim() === name) as unknown as HTMLButtonElement | undefined
  if (!button) throw new Error(`The page has no "${name}" button`)
  button.focus()
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const cardShown = () => root!.querySelector("[data-e2e=onboarding]") !== null
const offerShown = () => root!.querySelector("[data-e2e=onboarding-tour-offer]") !== null
const focused = () => window.document.activeElement as unknown as HTMLElement

describe("OnboardingView", () => {
  it("shows the checklist to a new account and nothing to a person who dismissed it", async () => {
    await mount(storeOver(fresh).store)
    expect(cardShown()).toBe(true)
    await act(() => render(null, root!))
    root?.remove()

    await mount(storeOver({ ...fresh, dismissed: true }).store)
    expect(cardShown()).toBe(false)
  })

  it("removes the card on Dismiss, saves it and moves focus to the page's heading", async () => {
    const { store, commands } = storeOver(fresh)
    await mount(store)

    await press("Dismiss")

    expect(cardShown()).toBe(false)
    expect(commands).toEqual(["onboarding.dismiss"])
    expect(focused().tagName).toBe("H1")
  })

  it("brings the card back with a message when the dismiss could not be saved", async () => {
    await mount(storeOver(fresh, { refuse: true }).store)

    await press("Dismiss")

    expect(cardShown()).toBe(true)
    expect(root!.querySelector("[data-e2e=onboarding-error]")?.textContent).toContain(
      "Could not save that. Try again.",
    )
  })

  it("stops offering the tour after Skip the tour and saves that", async () => {
    const { store, commands } = storeOver(fresh)
    await mount(store)
    expect(offerShown()).toBe(true)

    await press("Skip the tour")

    expect(offerShown()).toBe(false)
    expect(cardShown()).toBe(true)
    expect(commands).toEqual(["onboarding.tour-seen"])
    expect(focused().textContent).toBe("Get started")
  })

  it("opens the tour on Take the tour and stops offering it once it is finished", async () => {
    const { store, commands } = storeOver(fresh)
    await mount(store)

    await press("Take the tour")
    expect(store.tourOpen.value).toBe(true)
    expect(focused().textContent).toBe("Notes")
    await press("Skip tour")

    expect(store.tourOpen.value).toBe(false)
    expect(offerShown()).toBe(false)
    expect(commands).toEqual(["onboarding.tour-seen"])
    expect(focused().textContent).toBe("Get started")
  })

  it("moves the tour to the next step and back", async () => {
    const { store } = storeOver(fresh)
    await mount(store)
    await press("Take the tour")

    await press("Next")
    expect(store.tourIndex.value).toBe(1)
    expect(focused().textContent).toBe("Groups")

    await press("Back")
    expect(store.tourIndex.value).toBe(0)
  })

  it("reads again on a hint while the page is open, and neither reads nor keeps the tour open after it is left", async () => {
    const { store, reads } = storeOver(fresh)
    await mount(store)
    await press("Take the tour")
    await act(() => store.hint())
    expect(reads.count).toBe(2)

    await act(() => render(null, root!))
    await store.hint()

    expect(reads.count).toBe(2)
    expect(store.tourOpen.value).toBe(false)
    expect(store.tourOffered.value).toBe(true)
  })

  it("links the invitation step to the selected group's Members tab and opens a step through the router", async () => {
    selectionStore.groupId.value = "g-9"
    try {
      const steps = { ...fresh.steps, emailVerified: true, noteCreated: true }
      await mount(storeOver({ ...fresh, steps }).store)
      const link = root!.querySelector(`a[href="/groups/g-9/members"]`)
      expect(link).not.toBe(null)

      const click = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
      await act(() => void link!.dispatchEvent(click as never))

      expect(click.defaultPrevented).toBe(true)
      expect(window.location.pathname).toBe("/groups/g-9/members")
    } finally {
      selectionStore.groupId.value = null
      window.history.replaceState(null, "", "/")
    }
  })
})
