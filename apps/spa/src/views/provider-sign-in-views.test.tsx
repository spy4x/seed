/**
 * The three pages of sign-in with a provider, drawn by the real views over a fake API in a
 * browser DOM (happy-dom): what each asks the API for, and what it shows for the answer. The
 * screens' own tests cannot show that a view makes its request at all.
 */

import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { OAUTH_NOTICES, type SignInMethod, UserMFAStatus } from "@domain/identity"
import { memoryStorage } from "@spy4x/platform/browser/storage"
import { lastSignIn } from "../state/last-sign-in.ts"
import { sessionState } from "../state/session.ts"
import { toasts } from "../state/toasts.ts"
import { AuthView } from "./AuthView.tsx"
import { ConfirmSignUpView } from "./ConfirmSignUpView.tsx"
import { ProfileView } from "./ProfileView.tsx"
import { emailStore } from "../state/email.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  CSS: globalThis.CSS,
  location: globalThis.location,
  fetch: globalThis.fetch,
  localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
}
/** What the browser keeps: memory, never the real `localStorage`, which lasts between runs. */
let kept = memoryStorage()
const signedOut = sessionState.value

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    CSS: window.CSS,
    location: window.location,
  })
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => kept })
})

afterAll(async () => {
  const { localStorage, ...rest } = own
  Object.assign(globalThis, rest)
  if (localStorage) Object.defineProperty(globalThis, "localStorage", localStorage)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
  sessionState.value = signedOut
  globalThis.fetch = own.fetch
  kept = memoryStorage()
  toasts.clear()
})

/** Lets the pending requests answer and the page draw what they changed. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250))

/**
 * An API that answers each `METHOD /path` in `routes` with its status and body, and anything else
 * with `other` (an empty 200 unless given). Returns the calls it received, in order.
 */
function api(
  routes: Record<string, [number, unknown]>,
  other: [number, unknown] = [200, {}],
  /** Receives the JSON body of each call that sent one, by the call's name. */
  bodies: Record<string, unknown> = {},
): string[] {
  const calls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input, "http://app.localhost")
    const call = `${init?.method ?? "GET"} ${url.pathname}`
    calls.push(call)
    if (typeof init?.body === "string") bodies[call] = JSON.parse(init.body)
    const [status, body] = routes[call] ?? other
    return Promise.resolve(Response.json(body, { status }))
  }) as typeof fetch
  return calls
}

/** The view at `path`, with a router that records where the app went. */
async function open(path: string, view: VNode) {
  // The query string comes with the hook: the router takes its search hook from it.
  const { hook, history } = memoryLocation({ path, record: true })
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(<Router hook={hook}>{view}</Router>, root!))
  await settle()
  return history
}

function text(selector: string): string {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element.textContent ?? ""
}

async function press(selector: string): Promise<void> {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  element.dispatchEvent(
    new window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }) as unknown as Event,
  )
  await settle()
}

/** Types `value` into the field, as a person does. */
async function type(selector: string, value: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>(selector)
  if (!field) throw new Error(`nothing matches ${selector}`)
  field.value = value
  field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  await settle()
}

/** Submits the form around `selector`, as pressing its button does. */
async function submit(selector: string): Promise<void> {
  const form = document.querySelector(selector)?.closest("form")
  if (!form) throw new Error(`${selector} is in no form`)
  form.dispatchEvent(
    new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
  )
  await settle()
}

const waiting = {
  provider: "google",
  email: "ada@example.com",
  expiresAt: "2026-11-04T08:10:00.000Z",
  unconfirmedAccount: true,
}

describe("the sign-in page", () => {
  it("offers the providers the API says are on", async () => {
    const calls = api({ "GET /api/auth/providers": [200, { providers: ["github"] }] })

    await open("/sign-in", <AuthView screen="sign-in" />)

    expect(calls).toContain("GET /api/auth/providers")
    expect(text("[data-e2e=provider-github]")).toBe("Continue with GitHub")
    expect(document.querySelectorAll("[data-e2e=provider-google]").length).toBe(0)
  })

  it("says how the person last signed in here, and forgets it on request", async () => {
    api({})
    lastSignIn.remember("github", "ada@example.com")

    await open("/sign-in", <AuthView screen="sign-in" />)
    expect(text("[data-e2e=last-sign-in] span"))
      .toBe("Last time you signed in with GitHub (a***@example.com).")

    await press("[data-e2e=last-sign-in-forget]")

    expect(lastSignIn.read()).toBe(null)
    expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)
    // Opened again, the page has nothing to say.
    await act(() => render(null, root!))
    await open("/sign-in", <AuthView screen="sign-in" />)
    expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)
    expect(document.querySelectorAll("[data-e2e=last-sign-in-forgotten]").length).toBe(0)
  })

  it("says nothing about a last sign-in on a browser that remembers none", async () => {
    api({})

    await open("/sign-in", <AuthView screen="sign-in" />)

    expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)
  })

  it("says why a provider sign-in that came back with a notice did not work", async () => {
    api({})

    await open("/sign-in?oauth=failed", <AuthView screen="sign-in" />)
    expect(document.body.textContent).toContain(OAUTH_NOTICES.failed)
  })

  it("says to wait when the provider sign-in was sent back by the rate limit", async () => {
    api({})

    await open("/sign-in?oauth=busy", <AuthView screen="sign-in" />)
    expect(document.body.textContent).toContain(OAUTH_NOTICES.busy)
  })
})

describe("the question before a provider creates an account", () => {
  it("shows the sign-up the API holds, with its warning", async () => {
    const calls = api({ "GET /api/auth/sign-up/pending": [200, { pending: waiting }] })

    await open("/sign-up/confirm", <ConfirmSignUpView />)

    expect(calls).toEqual(["GET /api/auth/sign-up/pending"])
    expect(text("[data-e2e=confirm-sign-up-email]")).toBe("ada@example.com")
    expect(text("[data-e2e=confirm-sign-up-unconfirmed]")).toContain("never confirmed it")
  })

  it("says there is nothing to confirm when the API holds no sign-up", async () => {
    api({ "GET /api/auth/sign-up/pending": [200, { pending: null }] })

    await open("/sign-up/confirm", <ConfirmSignUpView />)

    expect(text("[data-e2e=confirm-sign-up-gone]")).toContain("Nothing to confirm")
  })

  it("tells the API when the person goes back, then opens the sign-in page", async () => {
    const calls = api({ "GET /api/auth/sign-up/pending": [200, { pending: waiting }] })
    const history = await open("/sign-up/confirm", <ConfirmSignUpView />)

    await press("[data-e2e=confirm-sign-up-back]")

    expect(calls.slice(1)).toEqual(["POST /api/auth/sign-up/cancel"])
    expect(history.at(-1)).toBe("/sign-in")
  })

  it("asks the API to create the account, and shows its reason when it refuses", async () => {
    const calls = api({
      "GET /api/auth/sign-up/pending": [200, { pending: waiting }],
      "POST /api/auth/sign-up/confirm": [400, { error: "This took too long." }],
    })
    const history = await open("/sign-up/confirm", <ConfirmSignUpView />)

    await press("[data-e2e=confirm-sign-up-create]")

    expect(calls.slice(1)).toEqual(["POST /api/auth/sign-up/confirm"])
    expect(text("[data-e2e=confirm-sign-up-error]")).toContain("This took too long.")
    expect(history.at(-1)).toBe("/sign-up/confirm")
  })
})

describe("the profile page", () => {
  const google: SignInMethod = {
    id: 8,
    kind: "google",
    email: "gia@example.com",
    current: true,
    canUnlink: false,
  }

  it("reads the account's sign-in methods and lists them", async () => {
    // Every other read of the page fails, which each of its sections must survive anyway.
    const calls = api(
      {
        "GET /api/auth/methods": [200, {
          methods: [google],
          available: ["github"],
          providerProofUntil: null,
        }],
      },
      [503, { error: "down" }],
    )
    sessionState.value = {
      ...signedOut,
      isReady: true,
      user: {
        id: 1,
        firstName: "Gia",
        lastName: "",
        mfa: UserMFAStatus.NOT_CONFIGURED,
      } as NonNullable<typeof signedOut.user>,
    }

    await open("/profile/security", <ProfileView section="security" />)

    expect(calls).toContain("GET /api/auth/methods")
    expect(text("[data-e2e=sign-in-method-google]")).toContain("gia@example.com")
    expect(text("[data-e2e=sign-in-method-link-github]")).toBe("Link GitHub")
    // An account without a password is offered a first one.
    expect(text("[data-e2e=password-none]")).toBe("None. You sign in with Google.")
    expect(text("[data-e2e=password-open]")).toBe("Set password")
  })

  /** Signed in as an account made with Google, whose sign-in confirms until `proofUntil`. */
  const signedInWithGoogle = (proofUntil: string | null): Record<string, [number, unknown]> => {
    sessionState.value = {
      ...signedOut,
      isReady: true,
      user: {
        id: 1,
        firstName: "Gia",
        lastName: "",
        mfa: UserMFAStatus.NOT_CONFIGURED,
      } as NonNullable<typeof signedOut.user>,
    }
    return {
      "GET /api/auth/methods": [200, {
        methods: [google],
        available: [],
        providerProofUntil: proofUntil,
      }],
      "GET /api/auth/email": [200, { email: "gia@example.com", proven: true, pending: null }],
      "GET /api/auth/account/deletion": [200, { blockers: [] }],
    }
  }
  const SOON = "2999-01-01T00:00:00.000Z"
  const LONG_AGO = "2020-01-01T00:00:00.000Z"

  it("deletes an account with no password without sending one, after a Google sign-in a moment ago", async () => {
    const bodies: Record<string, unknown> = {}
    const calls = api(
      {
        ...signedInWithGoogle(SOON),
        "POST /api/auth/account/delete": [200, { deleteAfter: "2026-11-12T00:00:00.000Z" }],
      },
      [503, { error: "down" }],
      bodies,
    )
    await open("/profile/danger-zone", <ProfileView section="danger-zone" />)

    await press("[data-e2e=account-delete-open]")
    await submit("[data-e2e=account-delete-submit]")

    expect(calls).toContain("POST /api/auth/account/delete")
    expect(bodies["POST /api/auth/account/delete"]).toEqual({})
  })

  it("sets the first password of an account with none and reads its sign-in methods again", async () => {
    const bodies: Record<string, unknown> = {}
    const calls = api(
      { ...signedInWithGoogle(SOON), "POST /api/auth/password/set": [200, { success: true }] },
      [503, { error: "down" }],
      bodies,
    )
    await open("/profile/security", <ProfileView section="security" />)

    await press("[data-e2e=password-open]")
    await type("[data-e2e=password-new]", "battery-staple")
    await submit("[data-e2e=password-new]")

    expect(bodies["POST /api/auth/password/set"]).toEqual({ newPassword: "battery-staple" })
    expect(calls.filter((call) => call === "GET /api/auth/methods").length).toBe(2)
    expect(calls).not.toContain("POST /api/auth/password/change")
  })

  it("sends the authenticator code with a first password while two-factor is on", async () => {
    const bodies: Record<string, unknown> = {}
    const routes = signedInWithGoogle(SOON)
    sessionState.value = {
      ...sessionState.value,
      user: { ...sessionState.value.user!, mfa: UserMFAStatus.CONFIGURED },
    }
    const calls = api(
      { ...routes, "POST /api/auth/password/set": [200, { success: true }] },
      [503, { error: "down" }],
      bodies,
    )
    await open("/profile/security", <ProfileView section="security" />)
    await press("[data-e2e=password-open]")
    await type("[data-e2e=password-new]", "battery-staple")

    // Without the code nothing is sent, and the field says why.
    await submit("[data-e2e=password-new]")
    expect(calls).not.toContain("POST /api/auth/password/set")
    expect(text("[data-e2e=password-dialog]")).toContain(
      "Enter the code from your authenticator app",
    )

    await type("[data-e2e=password-otp]", "123456")
    await submit("[data-e2e=password-new]")
    expect(bodies["POST /api/auth/password/set"]).toEqual({
      newPassword: "battery-staple",
      otp: "123456",
    })
  })

  it("links a provider with the password typed in the dialog", async () => {
    const bodies: Record<string, unknown> = {}
    signedInWithGoogle(null)
    const password: SignInMethod = { ...google, id: 3, kind: "password" }
    api(
      {
        "GET /api/auth/methods": [200, {
          methods: [password],
          available: ["github"],
          providerProofUntil: null,
        }],
        // Refused, so the page is not left and the body can be read.
        "POST /api/auth/methods/github/link": [400, { error: "Invalid password" }],
      },
      [503, { error: "down" }],
      bodies,
    )
    await open("/profile/security", <ProfileView section="security" />)

    await press("[data-e2e=sign-in-method-link-github]")
    await type("[data-e2e=sign-in-method-link-password]", "Passw0rd!")
    await submit("[data-e2e=sign-in-method-link-password]")

    expect(bodies["POST /api/auth/methods/github/link"]).toEqual({ password: "Passw0rd!" })
    expect(text("[data-e2e=sign-in-method-link-dialog]")).toContain("Invalid password")
  })

  it("offers the way back to Google, and no form, once the sign-in is no longer recent", async () => {
    const calls = api(signedInWithGoogle(LONG_AGO), [503, { error: "down" }])
    await open("/profile/danger-zone", <ProfileView section="danger-zone" />)

    await press("[data-e2e=account-delete-open]")

    expect(text("[data-e2e=provider-proof-google]")).toBe("Sign in with Google again")
    expect(document.querySelectorAll("[data-e2e=account-delete-submit]").length).toBe(0)
    expect(calls).not.toContain("POST /api/auth/account/delete")
  })

  it("changes the address of an account with no password without sending one", async () => {
    const bodies: Record<string, unknown> = {}
    api(
      {
        ...signedInWithGoogle(SOON),
        "POST /api/auth/email/change": [200, { success: true, message: "A code is on its way." }],
      },
      [503, { error: "down" }],
      bodies,
    )
    emailStore.reset()
    await open("/profile/account", <ProfileView section="account" />)

    await press("[data-e2e=email-change-open]")
    expect(document.querySelectorAll("[data-e2e=email-password]").length).toBe(0)
    await type("[data-e2e=email-new]", "gia@new.example")
    await submit("[data-e2e=email-new]")

    expect(bodies["POST /api/auth/email/change"]).toEqual({ email: "gia@new.example" })
  })

  it("asks for no sign-in methods while nobody is signed in", async () => {
    const calls = api({})

    await open("/profile/security", <ProfileView section="security" />)

    expect(calls).not.toContain("GET /api/auth/methods")
  })

  it("says that a provider account linked a second time was linked already, not that it failed", async () => {
    api({})

    const history = await open(
      "/profile/security?oauth=link-exists",
      <ProfileView section="security" />,
    )

    expect(toasts.list.value.map((toast) => [toast.title, toast.body])).toEqual([
      ["Sign-in method already linked", OAUTH_NOTICES["link-exists"]],
    ])
    // Said once: the notice leaves the address, so a reload does not say it again.
    expect(history.at(-1)).toBe("/profile/security")
  })
})
