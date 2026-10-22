/**
 * The profile page wired to the app's stores, in a browser DOM (happy-dom): which section an
 * address opens, the e-mail code a link asks for, and that the first-steps card is not here but on
 * the notes list (`NotesView.test.tsx`). Every read the page starts gets a refusal, so the page
 * never reaches a server.
 */
import "@preact/signals"
import { signal } from "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { Route, Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { act } from "preact/test-utils"
import { type OnboardingStatus, UserMFAStatus, UserRole } from "@domain/identity"
import { emailStore } from "../state/email.ts"
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
  emailStore.reset()
})

/** The view at `path`, with a router that records where the app went and can move it. */
async function open(path: string, view: VNode) {
  const { hook, history, navigate } = memoryLocation({ path, record: true })
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() => render(<Router hook={hook}>{view}</Router>, root!))
  return { history, go: (to: string) => act(() => navigate(to)) }
}

/** The page as the app routes it, so a move between its addresses keeps it mounted. */
const ROUTED = (
  <Route path="/profile/:section?">
    {(params) => <ProfileView section={params.section} />}
  </Route>
)

/** Lets the page's refused reads settle. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)))

describe("ProfileView", () => {
  it("opens the section its address names, alone, and shows no first-steps card", async () => {
    await open("/profile/security", <ProfileView section="security" />)

    expect(root!.querySelector("[data-e2e=settings-heading]")?.textContent)
      .toBe("Sign-in and security")
    expect(root!.querySelector("[data-e2e=two-factor]")).not.toBe(null)
    expect(root!.querySelector("[data-e2e=danger-zone]")).toBe(null)
    expect(root!.querySelector("[data-e2e=onboarding]")).toBe(null)
  })

  it("lists the sections at /profile and draws Account in the column a phone hides", async () => {
    const { history } = await open("/profile", <ProfileView />)

    expect(root!.querySelector("[data-e2e=settings-nav]")).not.toBe(null)
    const column = root!.querySelector("[data-e2e=settings-section]")
    expect(column?.className).toContain("max-md:hidden")
    expect(column?.querySelector("[data-e2e=profile-name]")?.textContent).toBe("Ada Lovelace")
    expect(history.at(-1)).toBe("/profile")
  })

  it("opens the e-mail code when a link asks for it while Account stays on screen", async () => {
    emailStore.status.value = { email: "ada@example.com", proven: false, pending: null }
    const { go } = await open("/profile", ROUTED)
    const dialog = () =>
      root!.querySelector<HTMLDialogElement>("dialog[data-e2e=email-change-dialog]")
    expect(dialog()?.open ?? false).toBe(false)

    await go("/profile/account?verify")

    expect(dialog()?.open).toBe(true)
    expect(root!.querySelector("[data-e2e=email-code]")).not.toBe(null)
  })

  it("shows why the address is missing, with a retry, when it could not be read", async () => {
    const reads: string[] = []
    const refuse = globalThis.fetch
    globalThis.fetch = (input, init) => {
      reads.push(String(input))
      return refuse(input, init)
    }
    try {
      await open("/profile/account", <ProfileView section="account" />)
      await settle()

      expect(root!.querySelector("[data-e2e=email-unavailable] [role=alert]")?.textContent)
        .toBe("Your e-mail address could not be read.")
      const before = reads.filter((url) => url.endsWith("/api/auth/email")).length
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=email-retry]")!.click())
      expect(reads.filter((url) => url.endsWith("/api/auth/email")).length).toBe(before + 1)
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("sends an address with no such section back to /profile", async () => {
    const { history } = await open("/profile/billing", <ProfileView section="billing" />)

    expect(history.at(-1)).toBe("/profile")
  })
})
