/**
 * The guest-account screens (#224) driven in a browser DOM (happy-dom): `/try`, `/keep`,
 * `/keep/taken`, the sign-out question, the refusal of a limited action, the Profile's delete and
 * the first steps for a guest. What each shows, what the app receives and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { GuestSwitchState, OnboardingSteps } from "@domain/identity"
import {
  GuestSignOutDialog,
  GuestTakenScreen,
  type GuestTakenScreenProps,
  KeepScreen,
  type KeepScreenProps,
  TryScreen,
} from "./guest-screens.tsx"
import { GuestAccountDelete, GuestRefusalDialog } from "./guest-profile.tsx"
import { onboardingSteps } from "./onboarding-card.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with the DOM's own `FormData`.
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

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Picks the radio whose value is `value`, as a click on it does. */
async function pick(value: string): Promise<void> {
  const radio = find<HTMLInputElement>(`input[type=radio][value="${value}"]`)
  radio.checked = true
  await act(() => {
    radio.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
  })
}

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

function focused(): string {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName ?? "nothing"
}

describe("TryScreen", () => {
  it("gives the server's wait when one network made too many guests, with sign-up as the way on", async () => {
    await mount(
      <TryScreen
        state={{ kind: "rate-limited", message: "Try again in 12 minutes." }}
        onRetry={() => {}}
      />,
    )
    expect(find("[data-e2e=try-rate-limited]").textContent).toContain("Try again in 12 minutes.")
    expect(find("[data-e2e=try-sign-up]").getAttribute("href")).toBe("/sign-up")
  })

  it("retries a failed start from Try again", async () => {
    let retried = 0
    await mount(<TryScreen state={{ kind: "failed" }} onRetry={() => retried++} />)
    await click("[data-e2e=try-again]")
    expect(retried).toBe(1)
  })
})

function keepProps(over: Partial<KeepScreenProps> = {}) {
  const calls: unknown[][] = []
  const props: KeepScreenProps = {
    isGuest: true,
    providers: ["google", "github"],
    passkeys: true,
    busy: null,
    error: null,
    kept: null,
    onProvider: (provider) => calls.push(["provider", provider]),
    onPasskey: () => calls.push(["passkey"]),
    onEmail: (email, password) => calls.push(["email", email, password]),
    onDone: () => calls.push(["done"]),
    ...over,
  }
  return { props, calls }
}

describe("KeepScreen", () => {
  it("offers Google, GitHub and a passkey before the e-mail form, and hands each to the app", async () => {
    const { props, calls } = keepProps()
    await mount(<KeepScreen {...props} />)
    const order = [...document.querySelectorAll("[data-e2e^=keep-]")]
      .map((element) => element.getAttribute("data-e2e"))
      .filter((name) => name !== "keep-title")
    expect(order).toEqual([
      "keep-google",
      "keep-github",
      "keep-passkey",
      "keep-email",
      "keep-password",
      "keep-email-submit",
    ])
    await click("[data-e2e=keep-github]")
    await click("[data-e2e=keep-passkey]")
    await type("[data-e2e=keep-email]", "ada@example.com")
    await type("[data-e2e=keep-password]", "long enough")
    await submit("[data-e2e=keep-email-submit]")
    expect(calls).toEqual([
      ["provider", "github"],
      ["passkey"],
      ["email", "ada@example.com", "long enough"],
    ])
  })

  it("says which method kept the account and moves focus to that line", async () => {
    const { props } = keepProps({ kept: "google" })
    await mount(<KeepScreen {...props} />)
    expect(find("[data-e2e=keep-done]").textContent).toContain("sign in with Google")
    expect(focused()).toBe("keep-done")
  })
})

const TAKEN: GuestSwitchState = {
  method: "password",
  maskedEmail: "a***@example.com",
  needsPassword: true,
  needsCode: false,
  groups: [{ id: "g1", name: "Personal" }],
  notes: 3,
}

function takenProps(over: Partial<GuestTakenScreenProps> = {}) {
  const calls: unknown[][] = []
  const props: GuestTakenScreenProps = {
    state: TAKEN,
    busy: false,
    error: null,
    onSwitch: (choice, password, otp) => calls.push([choice, password, otp]),
    onKeep: () => calls.push(["keep"]),
    ...over,
  }
  return { props, calls }
}

describe("GuestTakenScreen", () => {
  it("selects no choice, and a submit without one asks for it and changes nothing", async () => {
    const { props, calls } = takenProps()
    await mount(<GuestTakenScreen {...props} />)
    const radios = [...document.querySelectorAll<HTMLInputElement>("input[type=radio]")]
    expect(radios.map((radio) => radio.checked)).toEqual([false, false, false])
    await submit("[data-e2e=taken-submit]")
    expect(find("[role=alert]").textContent).toContain("Choose what happens")
    expect(calls).toEqual([])
  })

  it("moves the groups only with the other account's password", async () => {
    const { props, calls } = takenProps()
    await mount(<GuestTakenScreen {...props} />)
    await pick("move")
    await type("[data-e2e=taken-password]", "their password")
    await submit("[data-e2e=taken-submit]")
    expect(calls).toEqual([["move", "their password", undefined]])
  })

  it("asks once more before deleting the guest's data, with what goes", async () => {
    const { props, calls } = takenProps()
    await mount(<GuestTakenScreen {...props} />)
    await pick("delete")
    await type("[data-e2e=taken-password]", "their password")
    await submit("[data-e2e=taken-submit]")
    expect(calls).toEqual([])
    expect(find("[data-e2e=taken-confirm]").textContent).toContain("3 notes and 1 group")
    await click("[data-e2e=taken-confirm] [data-e2e=confirm-dialog-confirm]")
    expect(calls).toEqual([["delete", "their password", undefined]])
  })

  it("keeps the guest account without asking for a password", async () => {
    const { props, calls } = takenProps()
    await mount(<GuestTakenScreen {...props} />)
    await pick("keep")
    expect(document.querySelector("[data-e2e=taken-password]")).toBeNull()
    await submit("[data-e2e=taken-submit]")
    expect(calls).toEqual([["keep"]])
  })
})

describe("GuestSignOutDialog", () => {
  it("offers keeping the account first, and signs out only from Sign out anyway", async () => {
    const calls: string[] = []
    await mount(
      <GuestSignOutDialog
        onKeep={() => calls.push("keep")}
        onSignOut={() => calls.push("sign-out")}
        onCancel={() => calls.push("cancel")}
      />,
    )
    await click("[data-e2e=guest-sign-out-cancel]")
    await click("[data-e2e=guest-sign-out-keep]")
    await click("[data-e2e=guest-sign-out-anyway]")
    expect(calls).toEqual(["cancel", "keep", "sign-out"])
  })
})

describe("GuestRefusalDialog", () => {
  it("says why inviting needs a sign-in method and leads to /keep", async () => {
    await mount(<GuestRefusalDialog action="invite" onClose={() => {}} />)
    expect(document.body.textContent).toContain("Inviting needs a sign-in method")
    expect(find("[data-e2e=guest-refusal-keep]").getAttribute("href")).toBe("/keep")
  })
})

describe("GuestAccountDelete", () => {
  it("deletes only once the word is typed", async () => {
    const deleted: string[] = []
    await mount(
      <GuestAccountDelete pending={false} error={null} onDelete={(word) => deleted.push(word)} />,
    )
    await click("[data-e2e=guest-delete-open]")
    expect(find<HTMLButtonElement>("[data-e2e=guest-delete-confirm]").disabled).toBe(true)
    await submit("[data-e2e=guest-delete-confirm]")
    expect(deleted).toEqual([])
    await type("[data-e2e=guest-delete-word]", "Delete ")
    expect(find<HTMLButtonElement>("[data-e2e=guest-delete-confirm]").disabled).toBe(false)
    await submit("[data-e2e=guest-delete-confirm]")
    expect(deleted).toEqual(["Delete"])
  })
})

describe("onboardingSteps for a guest", () => {
  const steps: OnboardingSteps = {
    emailVerified: false,
    noteCreated: false,
    memberInvited: false,
    notificationsOn: false,
    twoFactorOn: false,
  }

  it("puts Keep your account first and leaves out the steps a guest is refused", () => {
    expect(onboardingSteps(steps, null, undefined, true).map((step) => step.id)).toEqual([
      "keep",
      "note",
    ])
    expect(onboardingSteps(steps, null).map((step) => step.id)).toEqual([
      "email",
      "note",
      "invite",
      "notifications",
      "two-factor",
    ])
  })
})
