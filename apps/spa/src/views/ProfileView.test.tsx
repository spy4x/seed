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
import {
  type OnboardingStatus,
  type SignInMethodsResponse,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import { emailStore } from "../state/email.ts"
import { onboardingStore } from "../state/onboarding.ts"
import { sessionState } from "../state/session.ts"
import { toasts } from "../state/toasts.ts"
import { ProfileView } from "./ProfileView.tsx"
import { configureModules } from "../modules.ts"

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
  "FormData",
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
  toasts.clear()
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

/** The API's refusal of a first password on an account with no address. */
const PASSWORD_NEEDS_ADDRESS = `Add an email address first: you sign in with it.`

/** Lets the page's refused reads settle. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)))

/** Types `value` into the field with this `data-e2e` hook, as a person would. */
const typeInto = (hook: string, value: string) =>
  act(() => {
    const input = root!.querySelector<HTMLInputElement>(`[data-e2e=${hook}]`)!
    input.value = value
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })

/** Submits the form holding this hook; happy-dom sends no submit for a button's click. */
const submitAt = (hook: string) =>
  act(() => {
    root!.querySelector(`[data-e2e=${hook}]`)!.closest("form")!.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })

/** The sign-in methods of an account kept with a passkey, signed in with it a moment ago. */
const PASSKEY_ONLY: SignInMethodsResponse = {
  methods: [{ id: 7, kind: "passkey", email: null, current: true, canUnlink: false }],
  available: [],
  providerProofUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
  emailLink: false,
}

/**
 * Answers the reads and calls this test names, by the end of their path, and refuses the rest as
 * the suite does. Returns the old `fetch`, for the test to put back.
 */
function answer(routes: Record<string, () => Response>): typeof fetch {
  const refuse = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = String(input)
    const route = Object.keys(routes).find((path) => url.endsWith(path))
    return route ? Promise.resolve(routes[route]()) : refuse(input, init)
  }
  return refuse
}

/** Opens `/profile/account?verify` and confirms the mailed code, with `routes` answering. */
async function confirmCode(routes: Record<string, () => Response>) {
  emailStore.status.value = { email: "ada@example.com", proven: false, pending: null }
  const refuse = answer({
    "/api/auth/email/verify": () => Response.json({ message: "ok" }),
    "/api/auth/email": () =>
      Response.json({ email: "ada@example.com", proven: true, pending: null }),
    ...routes,
  })
  try {
    const opened = await open("/profile/account?verify", ROUTED)
    await settle()
    await typeInto("email-code", "Ab3_x-9Q")
    await submitAt("email-code")
    await settle()
    return opened
  } finally {
    globalThis.fetch = refuse
  }
}

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

  it("drops ?verify from the address, replacing it, once the code dialog has opened", async () => {
    emailStore.status.value = { email: "ada@example.com", proven: false, pending: null }
    const { history } = await open("/profile/account?verify", ROUTED)

    expect(root!.querySelector<HTMLDialogElement>("dialog[data-e2e=email-change-dialog]")?.open)
      .toBe(true)
    expect(history).toEqual(["/profile/account"])
  })

  it("keeps ?verify while the address is unread, and drops it once the dialog opens", async () => {
    const { history } = await open("/profile/account?verify", ROUTED)
    expect(history).toEqual(["/profile/account?verify"])

    await act(() => {
      emailStore.status.value = { email: "ada@example.com", proven: false, pending: null }
    })

    expect(root!.querySelector<HTMLDialogElement>("dialog[data-e2e=email-change-dialog]")?.open)
      .toBe(true)
    expect(history).toEqual(["/profile/account"])
  })

  it("leaves the address alone and the dialog shut when no link asks for it", async () => {
    const unproven = { email: "ada@example.com", proven: false, pending: null }
    emailStore.status.value = unproven
    const refuse = answer({ "/api/auth/email": () => Response.json(unproven) })
    try {
      const { history } = await open("/profile/account", ROUTED)
      await settle()

      // The row is drawn, so the dialog could open; it is not there while it is shut.
      expect(root!.querySelector("[data-e2e=email-code-open]")).not.toBe(null)
      const dialog = root!.querySelector<HTMLDialogElement>("dialog[data-e2e=email-change-dialog]")
      expect(dialog?.open ?? false).toBe(false)
      expect(history).toEqual(["/profile/account"])
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("offers Set password on the confirmed-email toast of an account with no password, back on Sign-in and security", async () => {
    const { history } = await confirmCode({
      "/api/auth/methods": () => Response.json(PASSKEY_ONLY),
    })

    const toast = toasts.list.value.find((entry) => entry.dataE2E === "email-verified")
    expect(toast?.action?.label).toBe("Set password")
    await act(() => toast!.action!.onAction())
    expect(history.at(-1)).toBe("/profile/security")
  })

  it("offers nothing more on the confirmed-email toast of an account with a password", async () => {
    await confirmCode({})

    const toast = toasts.list.value.find((entry) => entry.dataE2E === "email-verified")
    expect(toast).not.toBe(undefined)
    expect(toast?.action).toBe(undefined)
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
        .toBe("Could not load your email")
      const before = reads.filter((url) => url.endsWith("/api/auth/email")).length
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=email-retry]")!.click())
      expect(reads.filter((url) => url.endsWith("/api/auth/email")).length).toBe(before + 1)
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("shows a failed read of the sign-in methods with a retry that is busy while it reads them again", async () => {
    const reads: string[] = []
    const refuse = globalThis.fetch
    // The read the retry starts answers only when the test lets it, so the busy retry is drawn.
    let answerRetry = () => {}
    const retried = new Promise<void>((done) => answerRetry = done)
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      reads.push(url)
      const methodReads = reads.filter((read) => read.endsWith("/api/auth/methods")).length
      if (url.endsWith("/api/auth/methods") && methodReads > 1) await retried
      return refuse(input, init)
    }
    try {
      await open("/profile/security", <ProfileView section="security" />)
      await settle()
      const methodReads = () => reads.filter((url) => url.endsWith("/api/auth/methods")).length
      const retry = () => root!.querySelector<HTMLElement>("[data-e2e=sign-in-methods-retry]")
      expect(methodReads()).toBe(1)
      expect(retry()?.parentElement?.querySelector("[role=alert]")).not.toBe(null)
      expect(retry()?.textContent).not.toContain("Loading sign-in methods")

      await act(() => retry()!.click())
      await settle()

      expect(methodReads()).toBe(2)
      expect(retry()?.textContent).toContain("Loading sign-in methods")
      await act(() => answerRetry())
      await settle()
      expect(retry()?.textContent).not.toContain("Loading sign-in methods")
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("keeps the first-password dialog open with the server's refusal in it (#463)", async () => {
    // An account kept with a passkey, two-factor on, no password and no address: the server
    // refuses the password, and the dialog must say why instead of closing as if it worked.
    const signedIn = sessionState.value
    sessionState.value = {
      ...signedIn,
      user: { ...signedIn.user!, mfa: UserMFAStatus.CONFIGURED },
    }
    const refuse = globalThis.fetch
    const methods: SignInMethodsResponse = {
      methods: [{ id: 7, kind: "passkey", email: null, current: true, canUnlink: false }],
      available: [],
      providerProofUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
      emailLink: false,
    }
    // The list read after the refusal answers only when the test lets it, as a network would
    // take its time: the page draws in between.
    let refused = false
    let answerList = () => {}
    const listAfterRefusal = new Promise<void>((done) => answerList = done)
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/auth/methods")) {
        if (refused) await listAfterRefusal
        return Response.json(methods)
      }
      if (url.endsWith("/api/auth/password/set")) {
        refused = true
        const error = { code: "bad_request", message: PASSWORD_NEEDS_ADDRESS }
        return Response.json({ error }, { status: 400 })
      }
      return refuse(input, init)
    }
    try {
      await open("/profile/security", <ProfileView section="security" />)
      await settle()
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=password-open]")!.click())
      const type = (hook: string, value: string) => {
        const input = root!.querySelector<HTMLInputElement>(`[data-e2e=${hook}]`)!
        input.value = value
        input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
      }
      await act(() => type("password-new", "a long new password"))
      await act(() => type("password-otp", "123456"))
      // happy-dom sends no submit for a button's click: the event is dispatched as a browser would.
      const form = root!.querySelector("[data-e2e=password-new]")!.closest("form")!
      await act(() => {
        form.dispatchEvent(
          new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
        )
      })
      await settle()
      const dialog = () =>
        root!.querySelector<HTMLDialogElement>("dialog[data-e2e=password-dialog]")
      const alert = () => dialog()?.querySelector("[role=alert]")?.textContent
      expect(dialog()?.open).toBe(true)
      expect(alert()).toBe(PASSWORD_NEEDS_ADDRESS)
      await act(() => answerList())
      await settle()

      expect(dialog()?.open).toBe(true)
      expect(alert()).toBe(PASSWORD_NEEDS_ADDRESS)
    } finally {
      globalThis.fetch = refuse
      sessionState.value = signedIn
    }
  })

  it("sends an account with no address from the password dialog to add one first (#463)", async () => {
    emailStore.status.value = { email: null, proven: false, pending: null }
    const refuse = globalThis.fetch
    const methods: SignInMethodsResponse = {
      methods: [{ id: 7, kind: "passkey", email: null, current: true, canUnlink: false }],
      available: [],
      providerProofUntil: new Date(Date.now() + 4 * 60_000).toISOString(),
      emailLink: false,
    }
    globalThis.fetch = (input, init) =>
      String(input).endsWith("/api/auth/methods")
        ? Promise.resolve(Response.json(methods))
        : refuse(input, init)
    try {
      const { history } = await open("/profile/security", ROUTED)
      await settle()
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=password-open]")!.click())

      expect(root!.querySelectorAll("[data-e2e=password-new]").length).toBe(0)
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=password-add-email]")!.click())
      await settle()

      // The ask is dropped once the dialog is open, so a reload does not open it again.
      expect(history).toEqual(["/profile/security", "/profile/account"])
      expect(root!.querySelector<HTMLDialogElement>("dialog[data-e2e=email-change-dialog]")?.open)
        .toBe(true)
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("shows why the other devices could not be signed out, above the list it keeps", async () => {
    const device = {
      id: 7,
      deviceName: "Firefox on Linux",
      ipHint: "203.0.113.*",
      createdAt: "2026-10-01T08:00:00.000Z",
      lastUsedAt: "2026-10-04T08:00:00.000Z",
      current: true,
    }
    const phone = { ...device, id: 9, deviceName: "Safari on iPhone", current: false }
    const refuse = answer({
      "/api/auth/sessions": () => Response.json({ sessions: [device, phone] }),
      "/api/auth/sessions/others": () =>
        Response.json({ error: { code: "NO", message: "Try again later" } }, { status: 503 }),
    })
    try {
      await open("/profile/security", <ProfileView section="security" />)
      await settle()
      await act(() => root!.querySelector<HTMLElement>("[data-e2e=sessions-end-others]")!.click())
      const confirm = [
        ...root!.querySelectorAll<HTMLElement>("[data-e2e=sessions-end-others-confirm] button"),
      ].find((button) => button.textContent === "Sign out")!
      await act(() => confirm.click())
      await settle()

      const section = root!.querySelector("[data-e2e=sessions]")!
      expect(section.querySelector("[role=alert]")?.textContent).toBe("Try again later")
      expect(section.textContent).toContain("Safari on iPhone")
      expect(toasts.list.value.some((toast) => toast.dataE2E === "sessions-ended")).toBe(false)
    } finally {
      globalThis.fetch = refuse
    }
  })

  it("sends an address with no such section back to /profile", async () => {
    const { history } = await open("/profile/billing", <ProfileView section="billing" />)

    expect(history.at(-1)).toBe("/profile")
  })

  it("hides the API tokens section, its link and its read with the notes off, and keeps them on", async () => {
    const reads: string[] = []
    const refuse = globalThis.fetch
    globalThis.fetch = (input, init) => {
      reads.push(String(input))
      return refuse(input, init)
    }
    const visit = async () => {
      reads.length = 0
      const { history } = await open("/profile/api-tokens", ROUTED)
      await settle()
      const seen = {
        at: history.at(-1),
        link: root!.querySelector(`[data-e2e=settings-nav] a[href="/profile/api-tokens"]`) !== null,
        section: root!.querySelector("[data-e2e=api-tokens]") !== null,
        read: reads.some((url) => url.endsWith("/api/tokens")),
      }
      await act(() => render(null, root!))
      root!.remove()
      root = null
      return seen
    }

    try {
      const on = await visit()
      configureModules({ notes: false })
      const off = await visit()

      expect(on).toEqual({ at: "/profile/api-tokens", link: true, section: true, read: true })
      expect(off).toEqual({ at: "/profile", link: false, section: false, read: false })
    } finally {
      globalThis.fetch = refuse
      configureModules({})
    }
  })

  it("says the data file holds the profile and groups, without notes, with the notes off", async () => {
    const state = () => root!.querySelector("[data-e2e=data-export-state]")?.textContent ?? ""
    await open("/profile/account", <ProfileView section="account" />)
    await settle()
    const on = state()
    await act(() => render(null, root!))
    root!.remove()
    configureModules({ notes: false })

    try {
      await open("/profile/account", <ProfileView section="account" />)
      await settle()

      expect(on).toMatch(/^A ZIP of your profile, groups and notes as JSON and CSV files\./)
      expect(state()).toMatch(/^A ZIP of your profile and groups as JSON and CSV files\./)
    } finally {
      configureModules({})
    }
  })
})
