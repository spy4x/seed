/**
 * Sign-in and sign-up by e-mail link (#391) in a browser DOM (happy-dom): the link pages, the
 * button on sign-in and sign-up, the last-sign-in hint, and the proof an account with only a link
 * confirms a step with. Typing, pressing through the app's callbacks, and where focus goes.
 */
import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.json" with { type: "json" }
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import {
  LinkOpenScreen,
  type LinkOpenScreenProps,
  LinkRequestScreen,
  type LinkRequestScreenProps,
} from "./sign-in-link-screen.tsx"
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

const requestDefaults: LinkRequestScreenProps = {
  email: "",
  onEmailChange: () => {},
  sentTo: null,
  fieldError: null,
  error: null,
  pending: false,
  onSubmit: () => {},
  resending: false,
  onResend: () => {},
  onDifferentAddress: () => {},
}

describe("LinkRequestScreen in the browser", () => {
  it("starts in the address field and asks for a link through the app's callback", async () => {
    const change = spy<[string]>()
    const send = spy<[]>()
    await mount(
      <LinkRequestScreen {...requestDefaults} onEmailChange={change.fn} onSubmit={send.fn} />,
    )
    expect(focused()).toBe("sign-in-link-email")

    await type("[data-e2e=sign-in-link-email]", "ada@example.com")

    expect(change.calls).toEqual([["ada@example.com"]])
    expect(await submit("[data-e2e=sign-in-link-email]")).toBe(true)
    expect(send.calls).toHaveLength(1)
  })

  it("ties a refused address to its field and moves focus there", async () => {
    await mount(<LinkRequestScreen {...requestDefaults} />)
    find("[data-e2e=sign-in-link-submit]").focus()

    await rerender(<LinkRequestScreen {...requestDefaults} fieldError="Enter an e-mail address" />)

    const field = find("[data-e2e=sign-in-link-email]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Enter an e-mail address")
    expect(focused()).toBe("sign-in-link-email")
  })

  it("moves focus to a failure that belongs to no field", async () => {
    await mount(<LinkRequestScreen {...requestDefaults} />)

    await rerender(<LinkRequestScreen {...requestDefaults} error="Too many links" />)

    expect(focused()).toBe("sign-in-link-error")
    expect(find("[data-e2e=sign-in-link-error]").textContent).toBe("Too many links")
  })

  it("says to check the inbox with focus on its heading, and offers no new link while the wait runs", async () => {
    await mount(
      <LinkRequestScreen
        {...requestDefaults}
        sentTo="ada@example.com"
        readyAt={Date.now() + 44_500}
      />,
    )

    expect(focused()).toBe("H1")
    expect(find("h1").textContent).toBe("Check your inbox")
    expect(text()).toContain("We sent a sign-in link to ada@example.com. It works once, for 15")
    // The ticking number is never announced.
    expect(find("[aria-live=off]").textContent).toBe(
      "Not there? Check your spam folder. You can send a new link in 45 seconds.",
    )
    expect(text()).not.toContain("Send a new link")
    // The next step is in the mail app: no primary button.
    expect(root!.querySelectorAll("button[type=submit]")).toHaveLength(0)
  })

  it("offers a new link once the wait ends, and moves focus to the line saying it is on its way", async () => {
    const resend = spy<[]>()
    const sent = { ...requestDefaults, sentTo: "ada@example.com", onResend: resend.fn }
    await mount(<LinkRequestScreen {...sent} />)

    expect(find("[data-e2e=resend-button-send]").textContent).toBe("Send a new link")
    await press("[data-e2e=resend-button-send]")
    await rerender(<LinkRequestScreen {...sent} readyAt={Date.now() + 60_000} />)

    expect(resend.calls).toHaveLength(1)
    expect(focused()).toBe("resend-button-sent")
    expect(find("[data-e2e=resend-button-sent]").textContent).toBe(
      "A new link is on its way. Earlier links still work until one is used.",
    )
    expect(text()).not.toContain("Send a new link")
  })

  it("tells the app when Back to sign in is pressed, so it can hand the address over", async () => {
    const back = spy<[]>()
    await mount(
      <LinkRequestScreen {...requestDefaults} email="ada@example.com" onBackToSignIn={back.fn} />,
    )

    await press("[data-e2e=sign-in-link-back]")

    expect(back.calls).toHaveLength(1)
  })

  it("leads back to sign-in from Check your inbox, handing the address over", async () => {
    const back = spy<[]>()
    await mount(
      <LinkRequestScreen
        {...requestDefaults}
        email="ada@example.com"
        sentTo="ada@example.com"
        next="/groups"
        onBackToSignIn={back.fn}
      />,
    )

    const link = find("[data-e2e=sign-in-link-sent-back]")
    expect(link.textContent).toBe("Back to sign in")
    expect(link.getAttribute("href")).toBe("/sign-in?next=%2Fgroups")
    await press("[data-e2e=sign-in-link-sent-back]")

    expect(back.calls).toHaveLength(1)
  })

  it("draws Use a different address in the size of the sentence around it", async () => {
    await mount(<LinkRequestScreen {...requestDefaults} sentTo="ada@example.com" />)

    const button = find("[data-e2e=sign-in-link-different-address]")
    // The sentence under the card is `text-sm`; the small button size would be `text-xs`.
    expect(button.closest("p")!.classList.contains("text-sm")).toBe(true)
    expect(button.classList.contains("text-xs")).toBe(false)
    expect(button.classList.contains("text-sm")).toBe(true)
  })

  it("goes back to the form, focused on the address, after Use a different address", async () => {
    const back = spy<[]>()
    const sent = { ...requestDefaults, email: "ada@example.com", onDifferentAddress: back.fn }
    await mount(<LinkRequestScreen {...sent} sentTo="ada@example.com" />)

    await press("[data-e2e=sign-in-link-different-address]")
    await rerender(<LinkRequestScreen {...sent} />)

    expect(back.calls).toHaveLength(1)
    expect(focused()).toBe("sign-in-link-email")
    expect(find<HTMLInputElement>("[data-e2e=sign-in-link-email]").value).toBe("ada@example.com")
  })
})

const openDefaults: LinkOpenScreenProps = {
  state: "ready",
  signedInAs: null,
  busy: false,
  error: null,
  onContinue: () => {},
}

describe("LinkOpenScreen in the browser", () => {
  it("focuses Continue and spends the link only when it is pressed", async () => {
    const go = spy<[]>()
    await mount(<LinkOpenScreen {...openDefaults} onContinue={go.fn} />)

    expect(focused()).toBe("sign-in-link-continue")
    expect(go.calls).toHaveLength(0)
    expect(await submit("[data-e2e=sign-in-link-continue]")).toBe(true)
    expect(go.calls).toHaveLength(1)
  })

  it("tells a signed-in person whose account they leave, and offers to stay", async () => {
    await mount(<LinkOpenScreen {...openDefaults} signedInAs="bob@example.com" />)

    expect(find("[data-e2e=sign-in-link-signed-in-as]").textContent).toBe(
      "You are signed in as bob@example.com. Continuing signs you in with the link's account instead.",
    )
    expect(find("[data-e2e=sign-in-link-stay]").getAttribute("href")).toBe("/")
    expect(focused()).toBe("sign-in-link-continue")
  })

  it("moves focus to a failure under Continue", async () => {
    await mount(<LinkOpenScreen {...openDefaults} />)

    await rerender(<LinkOpenScreen {...openDefaults} error="Could not reach the server" />)

    expect(focused()).toBe("sign-in-link-open-error")
  })

  it("offers a new link, focused, when the link no longer works or came incomplete", async () => {
    for (
      const [state, title] of [
        ["refused", "This link no longer works"],
        ["incomplete", "This link is incomplete"],
      ] as const
    ) {
      await mount(<LinkOpenScreen {...openDefaults} state={state} next="/notes" />)

      expect(find("h1").textContent).toBe(title)
      expect(focused()).toBe("sign-in-link-new")
      expect(find("[data-e2e=sign-in-link-new]").getAttribute("href"))
        .toBe("/sign-in/link?next=%2Fnotes")
      expect(root!.querySelector("[data-e2e=sign-in-link-continue]")).toBeNull()
      await act(() => render(null, root!))
    }
  })

  it("tells a guest what Continue does to the guest account, and nobody else", async () => {
    await mount(<LinkOpenScreen {...openDefaults} guest />)

    expect(find("[data-e2e=sign-in-link-guest]").textContent?.replace(/\s+/g, " ")).toBe(
      "You are using the app as a guest. If you asked for this link in this browser, continuing keeps this guest account under the link's address, or asks you first if that address already has an account.",
    )
    expect(focused()).toBe("sign-in-link-continue")
    // A guest has no other account to stay signed in to.
    expect(root!.querySelector("[data-e2e=sign-in-link-stay]")).toBeNull()

    await rerender(<LinkOpenScreen {...openDefaults} />)
    expect(text()).not.toContain("You are using the app as a guest")
  })

  it("tells a guest a link from another browser left the guest account as it was, focused on a new link", async () => {
    await mount(<LinkOpenScreen {...openDefaults} state="askedElsewhere" next="/notes" />)

    expect(find("h1").textContent).toBe("This link was asked for in another browser")
    expect(text()).toContain(
      "It did not sign you in, and your guest account is as it was. Ask for a new link in this browser to sign in here.",
    )
    expect(focused()).toBe("sign-in-link-new")
    expect(find("[data-e2e=sign-in-link-new]").getAttribute("href"))
      .toBe("/sign-in/link?next=%2Fnotes")
    const back = [...root!.querySelectorAll("a")].find((a) => a.textContent === "Back to the app")
    expect(back?.getAttribute("href")).toBe("/")
    expect(root!.querySelector("[data-e2e=sign-in-link-continue]")).toBeNull()
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

describe("AuthScreen's sign-in link button", () => {
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
    expect(find("[data-e2e=link-sign-in]").textContent).toBe("Email me a sign-in link")
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
    expect(find("[data-e2e=link-sign-up]").textContent).toBe("Email me a sign-up link")
    expect(otherWaysIn()).toEqual(["link-sign-up", "provider-google"])
  })

  it("shows the other ways in with no provider or passkey at all", async () => {
    await mount(<AuthScreen {...authDefaults} screen="sign-up" onEmailLink={() => {}} />)
    expect(otherWaysIn()).toEqual(["link-sign-up"])
  })

  it("is left out when the app offers no link", async () => {
    await mount(<AuthScreen {...authDefaults} />)
    expect(root!.querySelector("[data-e2e=link-sign-in]")).toBeNull()
  })

  it("names an e-mail link as the way the person last signed in", async () => {
    await mount(
      <AuthScreen {...authDefaults} lastSignIn={{ method: "link", email: "a***@example.com" }} />,
    )
    expect(find("[data-e2e=last-sign-in] span").textContent?.replace(/\s+/g, " ")).toBe(
      "Last time you signed in with an e-mail link (a***@example.com).",
    )
  })
})

describe("an account that signs in only with a link", () => {
  it("confirms a step with a sign-in link, not with a password it does not have", async () => {
    const proof = providerProofOf([], false, true)
    expect(proof).toEqual({ providers: [], passkeys: false, emailLink: true, fresh: false })
    expect(providerProofOf([], false)).toBe(null)
    expect(providerOnlyNames(EN, [], true)).toBe("a sign-in link")
    expect(providerOnlyNames(EN, [], false)).toBe(null)

    await mount(<ProviderProofNotice proof={proof!} next="/profile/danger-zone" />)

    expect(text()).toContain("Sign in with a sign-in link again")
    expect(find("[data-e2e=provider-proof-link]").getAttribute("href"))
      .toBe("/sign-in/link?next=%2Fprofile%2Fdanger-zone")
  })
})
