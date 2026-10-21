/**
 * The profile page wired to the app's stores, in a browser DOM (happy-dom): which section an
 * address opens, on a phone and on a wide screen, and that the first-steps card is not here but on
 * the notes list (`NotesView.test.tsx`). Every read the page starts gets a refusal, so the page
 * never reaches a server.
 */
import "@preact/signals"
import { signal } from "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { act } from "preact/test-utils"
import { type OnboardingStatus, UserMFAStatus, UserRole } from "@domain/identity"
import { onboardingStore } from "../state/onboarding.ts"
import { sessionState } from "../state/session.ts"
import { ProfileView } from "./ProfileView.tsx"

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
  "fetch",
  "CSS",
  "matchMedia",
] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)
const signedOut = sessionState.value
const realStore = { ...onboardingStore }

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

beforeAll(() => {
  // Preact draws into `document`, the router reads `location` and `history`, the library's tour
  // needs the rest (see `libs/ui/onboarding.test.tsx`), and every read the page starts is refused.
  const refuse = () =>
    Promise.resolve(Response.json({ error: { code: "NO", message: "No" } }, { status: 503 }))
  Object.assign(
    globalThis,
    Object.fromEntries(NAMES.map((name) => {
      if (name === "fetch") return [name, refuse]
      // Deno has no media queries: each test that needs a wide screen sets its own answer.
      if (name === "matchMedia") return [name, undefined]
      const value = (window as unknown as Record<string, unknown>)[name]
      return [
        name,
        typeof value === "function" && !/^[A-Z]/.test(name) ? value.bind(window) : value,
      ]
    })),
  )
  // The card reads the server through the socket; here it gets the answer of a new account.
  Object.assign(onboardingStore, {
    status: signal(fresh),
    visible: signal(true),
    open: () => Promise.resolve(),
    close: () => {},
  })
  sessionState.value = {
    ...signedOut,
    isReady: true,
    user: {
      id: 1,
      firstName: "Ada",
      lastName: "Lovelace",
      mfa: UserMFAStatus.NOT_CONFIGURED,
      role: UserRole.VIEWER,
      createdAt: new Date("2026-10-01T00:00:00Z"),
      updatedAt: new Date("2026-10-01T00:00:00Z"),
      deletedAt: null,
      lastLoginAt: new Date("2026-10-01T00:00:00Z"),
    },
  }
})

afterAll(async () => {
  Object.assign(globalThis, own)
  Object.assign(onboardingStore, realStore)
  sessionState.value = signedOut
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
})

/** The view at `path`, with a router that records where the app went. */
async function open(path: string, view: VNode) {
  const { hook, history } = memoryLocation({ path, record: true })
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() => render(<Router hook={hook}>{view}</Router>, root!))
  return history
}

/** The media query the page reads, as a screen of that width answers it; `turn` changes the width. */
function screen(wide: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    matches: wide,
    addEventListener: (_: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => void listeners.delete(listener),
  }
  Object.assign(globalThis, { matchMedia: () => query })
  return {
    turn: async (to: boolean) => {
      query.matches = to
      await act(() => listeners.forEach((listener) => listener()))
    },
  }
}

describe("ProfileView", () => {
  afterEach(() => void Object.assign(globalThis, { matchMedia: undefined }))

  it("opens the section its address names, alone, and shows no first-steps card", async () => {
    await open("/profile/security", <ProfileView section="security" />)

    expect(root!.querySelector("[data-e2e=settings-heading]")?.textContent)
      .toBe("Sign-in and security")
    expect(root!.querySelector("[data-e2e=two-factor]")).not.toBe(null)
    expect(root!.querySelector("[data-e2e=danger-zone]")).toBe(null)
    expect(root!.querySelector("[data-e2e=onboarding]")).toBe(null)
  })

  it("lists the sections and opens none at /profile on a phone", async () => {
    screen(false)
    await open("/profile", <ProfileView />)

    expect(root!.querySelector("[data-e2e=settings-nav]")).not.toBe(null)
    expect(root!.querySelector("[data-e2e=settings-heading]")).toBe(null)
  })

  it("opens Account beside the list at /profile on a wide screen, without moving the address", async () => {
    screen(true)
    const history = await open("/profile", <ProfileView />)

    expect(root!.querySelector("[data-e2e=settings-heading]")?.textContent).toBe("Account")
    expect(history.at(-1)).toBe("/profile")
  })

  it("shows the list again at /profile when a wide screen turns narrow", async () => {
    const { turn } = screen(true)
    await open("/profile", <ProfileView />)

    await turn(false)

    expect(root!.querySelector("[data-e2e=settings-heading]")).toBe(null)
    expect(root!.querySelector("[data-e2e=settings-nav]")).not.toBe(null)
  })

  it("sends an address with no such section back to /profile", async () => {
    const history = await open("/profile/billing", <ProfileView section="billing" />)

    expect(history.at(-1)).toBe("/profile")
  })
})
