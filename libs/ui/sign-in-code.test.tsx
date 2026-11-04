/**
 * Sign-in and sign-up by e-mail code (#391, #752) in a browser DOM (happy-dom): the code page,
 * the button on sign-in and sign-up, the last-sign-in hint, and the proof an account with no
 * password confirms a step with. Typing, pressing through the app's callbacks, and where focus goes.
 */
import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.ts"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { useEffect } from "preact/hooks"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { SignInCodeScreen, type SignInCodeScreenProps } from "./sign-in-code-screen.tsx"
import { ProviderProofNotice, providerProofOf } from "./provider-proof.tsx"
import { providerOnlyNames } from "./profile-screen.tsx"

/** The product's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: "en", catalogs: [{ source: appEn }] })

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
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

/** Lets the focus moves that wait for a microtask run. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Renders `node` into a fresh element in the page, effects and their focus moves run. */
async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  await settle()
  return root
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
  await settle()
}

/** The one element `selector` finds, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** Types `value` into a field the way a person does: the value changes, then `input` fires. */
async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Presses the button `selector` finds. */
async function press(selector: string): Promise<void> {
  await act(() => find(selector).click())
}

/** Submits the form that holds `selector` and says whether the native post was cancelled. */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")!
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** What has focus: its `data-e2e`, or its tag name when it has none. */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

/** The page's text with its spaces collapsed. */
function text(): string {
  return (root?.textContent ?? "").replace(/\s+/g, " ")
}

const codeDefaults: SignInCodeScreenProps = {
  email: "",
  onEmailChange: () => {},
  sentTo: null,
  dead: false,
  fieldError: null,
  error: null,
  pending: false,
  onSubmit: () => {},
  codeError: null,
  checking: false,
  onCode: () => {},
  resending: false,
  onResend: () => {},
  onDifferentAddress: () => {},
}

const sentDefaults: SignInCodeScreenProps = { ...codeDefaults, sentTo: "ada@example.com" }

describe("SignInCodeScreen's address form in the browser", () => {
  it("starts in the address field and asks for a code through the app's callback", async () => {
    const change = spy<[string]>()
    const send = spy<[]>()
    await mount(
      <SignInCodeScreen {...codeDefaults} onEmailChange={change.fn} onSubmit={send.fn} />,
    )
    expect(focused()).toBe("sign-in-code-email")

    await type("[data-e2e=sign-in-code-email]", "ada@example.com")

    expect(change.calls).toEqual([["ada@example.com"]])
    expect(await submit("[data-e2e=sign-in-code-email]")).toBe(true)
    expect(send.calls).toHaveLength(1)
  })

  it("ties a refused address to its field and moves focus there", async () => {
    await mount(<SignInCodeScreen {...codeDefaults} />)
    find("[data-e2e=sign-in-code-submit]").focus()

    await rerender(<SignInCodeScreen {...codeDefaults} fieldError="Enter an e-mail address" />)

    const field = find("[data-e2e=sign-in-code-email]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Enter an e-mail address")
    expect(focused()).toBe("sign-in-code-email")
  })

  it("moves focus to a failure that belongs to no field", async () => {
    await mount(<SignInCodeScreen {...codeDefaults} />)

    await rerender(<SignInCodeScreen {...codeDefaults} error="Too many codes" />)

    expect(focused()).toBe("sign-in-code-error")
    expect(find("[data-e2e=sign-in-code-error]").textContent).toBe("Too many codes")
  })

  it("tells a guest what signing in does to the guest account, and nobody else", async () => {
    await mount(<SignInCodeScreen {...codeDefaults} />)
    expect(root!.querySelector("[data-e2e=sign-in-code-guest]")).toBeNull()

    await rerender(<SignInCodeScreen {...codeDefaults} guest />)
    expect(find("[data-e2e=sign-in-code-guest]").textContent).toBe(appEn["SignInCodeScreen.guest"])
  })

  it("tells the app when Back to sign in is pressed, so it can hand the address over", async () => {
    const back = spy<[]>()
    await mount(<SignInCodeScreen {...codeDefaults} onBackToSignIn={back.fn} navigate={() => {}} />)

    await press("[data-e2e=sign-in-code-back]")

    expect(back.calls).toHaveLength(1)
  })
})

describe("SignInCodeScreen's code step in the browser", () => {
  it("names the address in bold, says how long the code works, and starts in the code field", async () => {
    await mount(<SignInCodeScreen {...sentDefaults} />)

    expect(find("h1").textContent).toBe("Check your inbox")
    expect(text()).toContain("We sent a code to ada@example.com. The code works for 10 minutes.")
    expect(find("strong bdi").textContent).toBe("ada@example.com")
    expect(focused()).toBe("mailed-code-step-code")
  })

  it("takes the focus back from the route announcer when reached by navigation", async () => {
    /** Focuses the new page's heading after the page mounted, as the app's route announcer does. */
    function Announced() {
      useEffect(() => {
        const heading = document.querySelector<HTMLElement>("h1")!
        heading.tabIndex = -1
        heading.focus()
      }, [])
      return <SignInCodeScreen {...sentDefaults} />
    }
    await mount(<Announced />)

    expect(focused()).toBe("mailed-code-step-code")
  })

  it("hands a pasted code to the app at once, without spaces", async () => {
    const code = spy<[string]>()
    await mount(<SignInCodeScreen {...sentDefaults} onCode={code.fn} />)

    // An input event with no input type is how a paste or an autofill arrives.
    await type("[data-e2e=mailed-code-step-code]", " Ab3_-x9Z ")

    expect(code.calls).toEqual([["Ab3_-x9Z"]])
  })

  it("refuses a code of the wrong shape before the app counts a guess", async () => {
    const code = spy<[string]>()
    await mount(<SignInCodeScreen {...sentDefaults} onCode={code.fn} />)

    await type("[data-e2e=mailed-code-step-code]", "Ab3+x9")
    await submit("[data-e2e=mailed-code-step-code]")

    expect(code.calls).toEqual([])
    expect(text()).toContain("The code has 8 characters. Check for a missing one.")
    expect(focused()).toBe("mailed-code-step-code")
  })

  it("shows a refused code under the field, its text selected for the next try", async () => {
    await mount(<SignInCodeScreen {...sentDefaults} checking />)

    await rerender(<SignInCodeScreen {...sentDefaults} codeError="That code is wrong." />)

    const field = find("[data-e2e=mailed-code-step-code]")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(text()).toContain("That code is wrong.")
    expect(focused()).toBe("mailed-code-step-code")
  })

  it("offers a new code only once the wait ends, through the app's callback", async () => {
    const resend = spy<[]>()
    await mount(
      <SignInCodeScreen {...sentDefaults} readyAt={Date.now() + 44_500} onResend={resend.fn} />,
    )
    expect(root!.querySelector("[data-e2e=resend-button-send]")).toBeNull()
    expect(find("[data-e2e=resend-button-waiting]").textContent).toContain("45")

    await rerender(
      <SignInCodeScreen {...sentDefaults} readyAt={Date.now() - 1} onResend={resend.fn} />,
    )
    await press("[data-e2e=resend-button-send]")

    expect(resend.calls).toHaveLength(1)
  })

  it("goes back to the address through the app's callback, or to sign-in", async () => {
    const different = spy<[]>()
    const back = spy<[]>()
    await mount(
      <SignInCodeScreen
        {...sentDefaults}
        onDifferentAddress={different.fn}
        onBackToSignIn={back.fn}
        navigate={() => {}}
      />,
    )

    await press("[data-e2e=mailed-code-step-change-email]")
    await press("[data-e2e=sign-in-code-step-back]")

    expect(different.calls).toHaveLength(1)
    expect(back.calls).toHaveLength(1)
  })
})

describe("SignInCodeScreen with a dead code in the browser", () => {
  it("says the code no longer works and focuses sending a new one", async () => {
    const resend = spy<[]>()
    const different = spy<[]>()
    await mount(
      <SignInCodeScreen
        {...sentDefaults}
        dead
        onResend={resend.fn}
        onDifferentAddress={different.fn}
      />,
    )

    expect(find("h1").textContent).toBe("This code no longer works")
    expect(root!.querySelector("[data-e2e=mailed-code-step-code]")).toBeNull()
    expect(focused()).toBe("code-dead-new")

    await press("[data-e2e=code-dead-new]")
    await press("[data-e2e=code-dead-different-address]")

    expect(resend.calls).toHaveLength(1)
    expect(different.calls).toHaveLength(1)
  })
})

describe("SignInCodeScreen for someone already signed in", () => {
  it("says they are signed in, with no address field, outside the proof flow", async () => {
    await mount(<SignInCodeScreen {...codeDefaults} signedIn />)

    expect(find("h1").textContent).toBe("You're signed in")
    expect(root!.querySelector("[data-e2e=sign-in-code-signed-in]")).not.toBeNull()
    expect(root!.querySelector("input[type=email]")).toBeNull()
  })

  it("fixes the account's address as text and asks a code for it from the confirm button", async () => {
    const asked = spy<[]>()
    await mount(
      <SignInCodeScreen
        {...codeDefaults}
        fixedEmail="ada@example.com"
        next="/profile/danger-zone"
        onSubmit={asked.fn}
      />,
    )

    expect(root!.querySelector("input[type=email]")).toBeNull()
    expect(find("[data-e2e=sign-in-code-confirm] strong").textContent).toBe("ada@example.com")
    expect(focused()).toBe("sign-in-code-submit")
    expect(find<HTMLAnchorElement>("[data-e2e=sign-in-code-back]").getAttribute("href"))
      .toBe("/profile/danger-zone")

    expect(await submit("[data-e2e=sign-in-code-submit]")).toBe(true)
    expect(asked.calls).toHaveLength(1)
  })

  it("waits for the account's address before the confirm button works", async () => {
    await mount(<SignInCodeScreen {...codeDefaults} fixedEmail={null} />)

    expect(text()).toContain("Loading")
    expect(find<HTMLButtonElement>("[data-e2e=sign-in-code-submit]").disabled).toBe(true)
  })
})

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

/** The `data-e2e` of each button in "Other ways in", in order. */
function otherWaysIn(): (string | null)[] {
  return [...find("[aria-label='Other ways in']").querySelectorAll("a, button")]
    .map((element) => element.getAttribute("data-e2e"))
}

describe("AuthScreen's sign-in code button", () => {
  it("sends what the login field holds through the app's callback, after the passkey", async () => {
    const link = spy<[string]>()
    await mount(
      <AuthScreen
        {...authDefaults}
        onPasskey={() => {}}
        providers={["google"]}
        onEmailLink={link.fn}
      />,
    )

    await type("input[name=login]", " ada@example.com ")
    await press("[data-e2e=link-sign-in]")

    expect(link.calls).toEqual([["ada@example.com"]])
    expect(find("[data-e2e=link-sign-in]").textContent).toBe("Email me a sign-in code")
    expect(otherWaysIn()).toEqual(["passkey-sign-in", "link-sign-in", "provider-google"])
  })

  it("sends an address handed back to the form without it being typed again", async () => {
    const link = spy<[string]>()
    await mount(
      <AuthScreen {...authDefaults} defaultLogin="ada@example.com" onEmailLink={link.fn} />,
    )

    expect(find<HTMLInputElement>("input[name=login]").value).toBe("ada@example.com")
    await press("[data-e2e=link-sign-in]")

    expect(link.calls).toEqual([["ada@example.com"]])
  })

  it("comes first on sign-up, before the providers", async () => {
    const link = spy<[string]>()
    await mount(
      <AuthScreen
        {...authDefaults}
        screen="sign-up"
        providers={["google"]}
        onEmailLink={link.fn}
      />,
    )

    await press("[data-e2e=link-sign-up]")

    expect(link.calls).toEqual([[""]])
    expect(find("[data-e2e=link-sign-up]").textContent).toBe("Email me a sign-up code")
    expect(otherWaysIn()).toEqual(["link-sign-up", "provider-google"])
  })

  it("shows the other ways in with no provider or passkey at all", async () => {
    await mount(<AuthScreen {...authDefaults} screen="sign-up" onEmailLink={() => {}} />)
    expect(otherWaysIn()).toEqual(["link-sign-up"])
  })

  it("is left out when the app offers no code", async () => {
    await mount(<AuthScreen {...authDefaults} />)
    expect(root!.querySelector("[data-e2e=link-sign-in]")).toBeNull()
  })

  it("names an e-mail code as the way the person last signed in", async () => {
    await mount(
      <AuthScreen {...authDefaults} lastSignIn={{ method: "link", email: "a***@example.com" }} />,
    )
    expect(find("[data-e2e=last-sign-in] span").textContent?.replace(/\s+/g, " ")).toBe(
      "Last time you signed in with an email code (a***@example.com).",
    )
  })
})

describe("an account that signs in only with an e-mail code", () => {
  it("confirms a step with an e-mail code, not with a password it does not have", async () => {
    const proof = providerProofOf([], false, true)
    expect(proof).toEqual({ providers: [], passkeys: false, emailLink: true, fresh: false })
    expect(providerProofOf([], false)).toBe(null)
    expect(providerOnlyNames(EN, [], true)).toBe("an email code")
    expect(providerOnlyNames(EN, [], false)).toBe(null)

    await mount(<ProviderProofNotice proof={proof!} next="/profile/danger-zone" />)

    expect(text()).toContain("Email me a sign-in code")
    expect(find("[data-e2e=provider-proof-link]").getAttribute("href"))
      .toBe("/sign-in/code?next=%2Fprofile%2Fdanger-zone")
  })
})
