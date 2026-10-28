/**
 * Passkeys (#222) on the screens, driven in a browser DOM (happy-dom): the rows and the "Add a
 * passkey" flow of the sign-in methods card, the passkey button on the sign-in page, and the
 * passkey proof of an account without a password. What is offered, what asks first, what the app
 * receives and where focus goes.
 */
import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.json" with { type: "json" }
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { SignInMethod } from "@domain/identity"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { providerOnlyNames } from "./profile-screen.tsx"
import { ProviderProofNotice, providerProofOf } from "./provider-proof.tsx"
import {
  PASSKEY_RENAME_FAILURE,
  type PasskeyAddStatus,
  SignInMethods,
  type SignInMethodsProps,
} from "./sign-in-methods.tsx"

/** The product's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: "en", catalogs: [{ source: appEn }] })

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
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }) as unknown as Event,
    )
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

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

async function press(selector: string, key: string): Promise<void> {
  await act(async () => {
    find(selector).dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
}

/** The elements of `selector`, by their `data-e2e`, in the order a reader meets them. */
function order(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((element) =>
    element.getAttribute("data-e2e") ?? ""
  )
}

const password: SignInMethod = {
  id: 3,
  kind: "password",
  email: "ada@example.com",
  current: false,
  canUnlink: false,
}
const google: SignInMethod = {
  id: 8,
  kind: "google",
  email: "ada@example.com",
  current: false,
  canUnlink: true,
}
const laptop: SignInMethod = {
  id: 12,
  kind: "passkey",
  email: null,
  current: true,
  canUnlink: true,
  passkey: {
    name: "Chrome on macOS",
    createdAt: "2026-10-21T09:00:00.000Z",
    lastUsedAt: "2026-10-21T10:00:00.000Z",
  },
}

/** The card with a password, Google and a passkey, on a browser with passkeys. */
function methodsProps(
  asked: unknown[],
  props: Partial<SignInMethodsProps> = {},
): SignInMethodsProps {
  return {
    methods: [google, laptop, password],
    available: ["github"],
    pending: false,
    error: null,
    passkeysSupported: true,
    onLink: (provider) => void asked.push(provider),
    onUnlink: (id, typed) => void asked.push(["remove", id, typed]),
    onAddPasskey: (typed) => void asked.push(["add", typed]),
    onRenamePasskey: (id, name) => (asked.push(["rename", id, name]), Promise.resolve()),
    ...props,
  }
}

describe("SignInMethods with passkeys", () => {
  it("lists the password, then each passkey, then the providers", async () => {
    await mount(<SignInMethods {...methodsProps([])} />)

    const rows = ["sign-in-method-password", "sign-in-method-passkey", "sign-in-method-google"]
    expect(order("[data-e2e=sign-in-methods-list] [data-e2e]").filter((id) => rows.includes(id)))
      .toEqual(["sign-in-method-password", "sign-in-method-passkey", "sign-in-method-google"])
  })

  it("shows a passkey by its full name, when it was added and last used, and this device's use", async () => {
    await mount(<SignInMethods {...methodsProps([])} />)

    const row = find("[data-e2e=sign-in-method-passkey]")
    expect(row.textContent).toContain("Chrome on macOS")
    // A long name is cut off on a narrow screen, so the whole of it is in the title.
    expect(find("[data-e2e=passkey-full-name]").getAttribute("title")).toBe("Chrome on macOS")
    expect(find("[data-e2e=passkey-dates]").textContent).toMatch(/^Added .+ · Last used .+/)
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-21T09:00:00.000Z")
    expect(row.textContent).toContain("Used on this device")
    expect(find(`[data-e2e=sign-in-method-remove-passkey-12]`).textContent)
      .toBe("Remove Chrome on macOS")
  })

  it("offers Add a passkey before the link buttons, only where the browser has passkeys", async () => {
    const mounted = await mount(<SignInMethods {...methodsProps([])} />)
    expect(order("button[data-e2e^=sign-in-method-add], button[data-e2e^=sign-in-method-link]"))
      .toEqual(["sign-in-method-add-passkey", "sign-in-method-link-github"])

    await act(() =>
      render(<SignInMethods {...methodsProps([], { passkeysSupported: false })} />, mounted)
    )
    expect(document.querySelector("[data-e2e=sign-in-method-add-passkey]")).toBe(null)
    // A passkey made elsewhere stays listed and removable.
    expect(document.querySelector("[data-e2e=sign-in-method-remove-passkey-12]")).not.toBe(null)
  })

  it("asks for the password before adding a passkey, and hands it to the app", async () => {
    const asked: unknown[] = []
    await mount(<SignInMethods {...methodsProps(asked)} />)

    await click("[data-e2e=sign-in-method-add-passkey]")
    expect(isOpen("sign-in-method-link-dialog")).toBe(true)
    expect(find("[data-e2e=sign-in-method-link-dialog]").textContent)
      .toContain("A passkey is another way to sign in, so your password is asked first.")
    expect(asked).toEqual([])
    await type("[data-e2e=sign-in-method-link-password]", "Passw0rd!")
    await submit("[data-e2e=sign-in-method-link-password]")
    expect(asked).toEqual([["add", "Passw0rd!"]])
  })

  it("adds a passkey at once after a sign-in a moment ago, asking nothing", async () => {
    const asked: unknown[] = []
    await mount(
      <SignInMethods
        {...methodsProps(asked, {
          methods: [laptop, google],
          providerProof: { providers: ["google"], passkeys: true, fresh: true },
        })}
      />,
    )

    await click("[data-e2e=sign-in-method-add-passkey]")
    expect(isOpen("sign-in-method-link-dialog")).toBe(false)
    expect(asked).toEqual([["add", undefined]])
  })

  it("offers Continue, with focus on it, once a sign-in from the open dialog made the proof fresh", async () => {
    const asked: unknown[] = []
    const card = (fresh: boolean) => (
      <SignInMethods
        {...methodsProps(asked, {
          methods: [laptop, google],
          providerProof: { providers: ["google"], passkeys: true, fresh, onPasskey: () => {} },
        })}
      />
    )
    const mounted = await mount(card(false))
    await click("[data-e2e=sign-in-method-add-passkey]")
    expect(isOpen("sign-in-method-link-dialog")).toBe(true)
    expect(document.querySelector("[data-e2e=sign-in-method-link-submit]")).toBe(null)
    find("[data-e2e=provider-proof-passkey]").focus()

    await act(() => render(card(true), mounted))

    expect(find("[data-e2e=provider-proof-fresh]").textContent).toContain("a moment ago")
    expect(document.querySelector("[data-e2e=sign-in-method-link-password]")).toBe(null)
    expect(find("[data-e2e=sign-in-method-link-submit]").textContent).toBe("Continue")
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("sign-in-method-link-submit")
    expect(asked).toEqual([])
    await click("[data-e2e=sign-in-method-link-submit]")
    expect(asked).toEqual([["add", undefined]])
  })

  it("waits for the device, then says nothing was added and puts focus back on the button", async () => {
    const status = (passkeyStatus: PasskeyAddStatus | null) => (
      <SignInMethods {...methodsProps([], { passkeyStatus })} />
    )
    const mounted = await mount(status({ kind: "waiting" }))
    expect(find("[data-e2e=sign-in-method-add-passkey]").textContent)
      .toContain("Waiting for your device…")

    await act(() => render(status({ kind: "cancelled" }), mounted))
    expect(find("[data-e2e=passkey-status]").textContent).toBe("No passkey was added.")
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("sign-in-method-add-passkey")
  })

  it("announces a new passkey by its name and moves focus to its rename control", async () => {
    const mounted = await mount(<SignInMethods {...methodsProps([], { methods: [password] })} />)

    await act(() =>
      render(
        <SignInMethods
          {...methodsProps([], {
            methods: [password, laptop],
            passkeyStatus: { kind: "added", keyId: 12, name: "Chrome on macOS" },
          })}
        />,
        mounted,
      )
    )
    expect(find("[data-e2e=passkey-status]").getAttribute("role")).toBe("status")
    expect(find("[data-e2e=passkey-status]").textContent)
      .toBe(`Passkey added as "Chrome on macOS". Rename it if you like.`)
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Rename Chrome on macOS")
  })

  it("renames a passkey in place, and keeps the typed name with a reason when that fails", async () => {
    const asked: unknown[] = []
    let refuse = false
    await mount(
      <SignInMethods
        {...methodsProps(asked, {
          onRenamePasskey: (id, name) => {
            asked.push(["rename", id, name])
            return refuse ? Promise.reject(new Error("offline")) : Promise.resolve()
          },
        })}
      />,
    )

    await click("[data-e2e=passkey-name-12] button")
    await type("[data-e2e=passkey-name-12] input", "Work laptop")
    await press("[data-e2e=passkey-name-12] input", "Enter")
    expect(asked).toEqual([["rename", 12, "Work laptop"]])

    refuse = true
    await click("[data-e2e=passkey-name-12] button")
    await type("[data-e2e=passkey-name-12] input", "Home")
    await press("[data-e2e=passkey-name-12] input", "Enter")
    expect(find("[data-e2e=passkey-name-12] input").getAttribute("aria-invalid")).toBe("true")
    expect(find("[data-e2e=passkey-name-12]").textContent).toContain(EN.t(PASSKEY_RENAME_FAILURE))
  })

  it("asks before removing a passkey, naming it and the sign-out, then hands over the password", async () => {
    const asked: unknown[] = []
    await mount(<SignInMethods {...methodsProps(asked)} />)

    await click("[data-e2e=sign-in-method-remove-passkey-12]")
    const dialog = find("[data-e2e=sign-in-method-unlink-confirm]")
    expect(dialog.textContent).toContain(`Remove "Chrome on macOS"?`)
    expect(dialog.textContent).toContain("Delete it from your password manager too.")
    expect(dialog.textContent).toContain(
      "This device signed in with it, so it will be signed out too.",
    )
    expect(asked).toEqual([])
    await type("[data-e2e=sign-in-method-unlink-password]", "Passw0rd!")
    await submit("[data-e2e=sign-in-method-unlink-password]")
    expect(asked).toEqual([["remove", 12, "Passw0rd!"]])
    expect(find("[data-e2e=sign-in-method-unlink-submit]").textContent).toBe("Remove passkey")
  })

  it("says why the only passkey has no Remove", async () => {
    const only = { ...laptop, canUnlink: false }
    await mount(<SignInMethods {...methodsProps([], { methods: [only] })} />)

    const row = find("[data-e2e=sign-in-method-passkey]")
    expect(row.querySelector("[data-e2e^=sign-in-method-remove]")).toBe(null)
    expect(row.textContent).toContain("Your only way to sign in, so it cannot be removed.")
  })

  it("keeps Add a passkey off while offline, and says why", async () => {
    await mount(<SignInMethods {...methodsProps([], { online: false })} />)

    expect(find<HTMLButtonElement>("[data-e2e=sign-in-method-add-passkey]").disabled).toBe(true)
    expect(find("[data-e2e=passkey-offline]").textContent)
      .toBe("Adding a passkey needs a connection.")
  })
})

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

describe("AuthScreen with passkeys", () => {
  it("offers Sign in with a passkey first among the other ways in, and hands the press over", async () => {
    let pressed = 0
    await mount(
      <AuthScreen {...authDefaults} providers={["google"]} onPasskey={() => void pressed++} />,
    )

    const ways = find("[aria-label='Other ways in']")
    expect([...ways.querySelectorAll("[data-e2e]")].map((item) => item.getAttribute("data-e2e")))
      .toEqual(["passkey-sign-in", "provider-google"])
    await click("[data-e2e=passkey-sign-in]")
    expect(pressed).toBe(1)
  })

  it("offers no passkey button without passkeys in the browser, or on sign-up", async () => {
    const mounted = await mount(<AuthScreen {...authDefaults} />)
    expect(document.querySelector("[data-e2e=passkey-sign-in]")).toBe(null)

    await act(() =>
      render(<AuthScreen {...authDefaults} screen="sign-up" onPasskey={() => {}} />, mounted)
    )
    expect(document.querySelector("[data-e2e=passkey-sign-in]")).toBe(null)
  })

  it("says the passkey button waits for the device", async () => {
    await mount(<AuthScreen {...authDefaults} onPasskey={() => {}} passkeyBusy />)

    expect(find("[data-e2e=passkey-sign-in]").textContent).toContain("Waiting for your device…")
  })

  it("lets the login field offer passkeys in its autofill when the browser can", async () => {
    const mounted = await mount(<AuthScreen {...authDefaults} />)
    expect(find("input[name=login]").getAttribute("autocomplete")).not.toContain("webauthn")

    await act(() => render(<AuthScreen {...authDefaults} passkeyAutofill />, mounted))
    expect(find("input[name=login]").getAttribute("autocomplete")).toBe("username webauthn")
  })

  it("says a passkey was the last way this browser signed in", async () => {
    await mount(<AuthScreen {...authDefaults} lastSignIn={{ method: "passkey", email: null }} />)

    expect(find("[data-e2e=last-sign-in]").textContent)
      .toContain("Last time you signed in with a passkey.")
  })
})

describe("the proof of an account without a password, with a passkey", () => {
  it("counts the passkey as a way to confirm, beside the providers", () => {
    expect(providerProofOf([google, laptop], false)).toEqual({
      providers: ["google"],
      passkeys: true,
      fresh: false,
    })
    expect(providerProofOf([password, laptop], false)).toBe(null)
    expect(providerOnlyNames(EN, [google, laptop])).toBe("Google and a passkey")
    expect(providerOnlyNames(EN, [laptop, { ...laptop, id: 13 }])).toBe("passkeys")
  })

  it("offers to sign in again with a passkey on the spot", async () => {
    let pressed = 0
    await mount(
      <ProviderProofNotice
        proof={{ providers: [], passkeys: true, fresh: false, onPasskey: () => void pressed++ }}
        next="/profile"
      />,
    )

    expect(find("[data-e2e=provider-proof-needed]").textContent).toContain(
      "Sign in with a passkey again, then come back here",
    )
    await click("[data-e2e=provider-proof-passkey]")
    expect(pressed).toBe(1)
  })
})
