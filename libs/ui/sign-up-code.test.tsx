/**
 * The sign-up's code step (#142), driven in a browser DOM (happy-dom): "Check your inbox", "You
 * already have an account" and "This sign-up expired". What each shows, what the app receives and
 * where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { ExistingAccountAnswer } from "@domain/identity"
import { SignUpCodeScreen, type SignUpCodeScreenProps } from "./sign-up-code-screen.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** Submits the form around `selector`, as pressing its button does. */
async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")
  if (!form) throw new Error(`${selector} is in no form`)
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** What has focus: its `data-e2e`, or its tag name when it has none. */
function focused(): string {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName ?? "nothing"
}

const PASSWORD_ACCOUNT: ExistingAccountAnswer = {
  email: "ada@example.com",
  password: true,
  providers: [],
}

/** The code step with a sign-up waiting, recording what the app received in `heard`. */
function props(heard: string[], overrides: Partial<SignUpCodeScreenProps> = {}) {
  return {
    isSignedIn: false,
    pending: { email: "ada@example.com", expiresAt: "2026-10-17T10:10:00.000Z" },
    exists: null,
    minutes: 10,
    busy: false,
    error: null,
    resending: false,
    resendError: null,
    onSubmit: (code: string) => void heard.push(`code ${code}`),
    onResend: () => void heard.push("resend"),
    onDifferentAddress: () => void heard.push("different address"),
    onSignInInstead: () => void heard.push("sign in"),
    onForgotPassword: () => void heard.push("forgot"),
    ...overrides,
  } satisfies SignUpCodeScreenProps
}

describe("SignUpCodeScreen", () => {
  it("names the address the code went to and how long it works, on the shared code step", async () => {
    await mount(<SignUpCodeScreen {...props([])} />)

    expect(find("h1").textContent).toBe("Check your inbox")
    expect(find("[data-e2e=sign-up-code] [data-e2e=mailed-code-step]").textContent)
      .toContain("We sent a code to ada@example.com. The code works for 10 minutes.")
  })

  it("focuses the code field when the step opens, and hands the typed code to the app", async () => {
    const heard: string[] = []
    await mount(<SignUpCodeScreen {...props(heard)} />)

    expect(focused()).toBe("mailed-code-step-code")
    find<HTMLInputElement>("[data-e2e=mailed-code-step-code]").value = "abcd1234"
    await submit("[data-e2e=mailed-code-step-submit]")

    expect(heard).toEqual(["code abcd1234"])
  })

  it("focuses the code field again after a wrong code, its text selected, the error tied to it", async () => {
    const mounted = await mount(<SignUpCodeScreen {...props([])} />)
    const field = find<HTMLInputElement>("[data-e2e=mailed-code-step-code]")
    field.value = "wrong-00"
    field.blur()
    expect(focused()).not.toBe("mailed-code-step-code")

    const refused = "This code is wrong or has expired. Ask for a new one."
    await act(() => render(<SignUpCodeScreen {...props([], { error: refused })} />, mounted))

    expect(focused()).toBe("mailed-code-step-code")
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, "wrong-00".length])
    const described = field.getAttribute("aria-describedby")!
    expect(document.getElementById(described)?.textContent).toBe(refused)
  })

  it("takes no second code while one is being checked", async () => {
    const heard: string[] = []
    await mount(<SignUpCodeScreen {...props(heard, { busy: true })} />)

    find<HTMLInputElement>("[data-e2e=mailed-code-step-code]").value = "abcd1234"
    await submit("[data-e2e=mailed-code-step-submit]")

    expect(heard).toEqual([])
  })

  it("asks for a new code, says it is on its way, and waits before offering another", async () => {
    const heard: string[] = []
    const mounted = await mount(<SignUpCodeScreen {...props(heard)} />)

    await click("[data-e2e=resend-button-send]")
    await act(() =>
      render(<SignUpCodeScreen {...props(heard, { readyAt: Date.now() + 60_000 })} />, mounted)
    )

    expect(heard).toEqual(["resend"])
    expect(find("[data-e2e=resend-button-sent]").textContent).toBe("A new code is on its way.")
    expect(document.querySelector("[data-e2e=resend-button-send]")).toBe(null)
  })

  it("shows why a new code was refused under the code field", async () => {
    await mount(<SignUpCodeScreen {...props([], { resendError: "Too many codes. Wait a bit." })} />)

    const field = find<HTMLInputElement>("[data-e2e=mailed-code-step-code]")
    const described = field.getAttribute("aria-describedby")!
    expect(document.getElementById(described)?.textContent).toBe("Too many codes. Wait a bit.")
  })

  it("goes back to another address on the app's call", async () => {
    const heard: string[] = []
    await mount(<SignUpCodeScreen {...props(heard)} />)

    await click("[data-e2e=mailed-code-step-change-email]")

    expect(heard).toEqual(["different address"])
  })

  it("hands an account with a password over to sign-in, with the reset page beside it", async () => {
    const heard: string[] = []
    await mount(<SignUpCodeScreen {...props(heard, { exists: PASSWORD_ACCOUNT })} />)

    expect(find("h1").textContent).toBe("You already have an account")
    expect(find("[data-e2e=sign-up-exists]").textContent)
      .toContain("ada@example.com already has an account here. Nothing new was created.")
    expect(focused()).toBe("sign-up-exists-sign-in")
    expect(find("[data-e2e=sign-up-exists-sign-in]").textContent).toBe("Sign in instead")
    await click("[data-e2e=sign-up-exists-sign-in]")
    await click("[data-e2e=sign-up-exists-forgot]")

    expect(heard).toEqual(["sign in", "forgot"])
  })

  it("hands an account with no password over to its provider, the first linked first", async () => {
    await mount(
      <SignUpCodeScreen
        {...props([], {
          exists: { ...PASSWORD_ACCOUNT, password: false, providers: ["google", "github"] },
          next: "/notes",
        })}
      />,
    )

    expect(find("[data-e2e=sign-up-exists]").textContent)
      .toContain(
        "already has an account here that signs in with Google or GitHub. Nothing new was created.",
      )
    const google = find<HTMLAnchorElement>("[data-e2e=sign-up-exists-google]")
    expect(google.textContent).toBe("Continue with Google")
    expect(google.getAttribute("href")).toBe("/api/auth/google/start?next=%2Fnotes")
    expect(focused()).toBe("sign-up-exists-google")
    expect(document.querySelector("[data-e2e=sign-up-exists-sign-in]")).toBe(null)
    expect(document.querySelector("[data-e2e=sign-up-exists-forgot]")).toBe(null)
  })

  it("says the sign-up expired when none waits, and starts again from the form", async () => {
    await mount(<SignUpCodeScreen {...props([], { pending: null, next: "/notes" })} />)

    expect(find("h1").textContent).toBe("This sign-up expired")
    expect(find("[data-e2e=sign-up-expired]").textContent)
      .toContain("It took longer than 10 minutes, or the code was entered wrong too many times.")
    const start = find<HTMLAnchorElement>("[data-e2e=sign-up-expired] a")
    expect(start.getAttribute("href")).toBe("/sign-up?next=%2Fnotes")
    expect(document.activeElement === start).toBe(true)
  })
})
