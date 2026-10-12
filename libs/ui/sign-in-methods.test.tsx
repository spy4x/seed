/**
 * Sign-in with a provider, driven in a browser DOM (happy-dom): the "Continue with" links on the
 * auth pages, the question before a provider creates an account, and the profile's sign-in
 * methods. What is offered, what asks first, what the app receives and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { Button } from "@spy4x/preact-ui/button"
import { type PendingSignUp, type SignInMethod, UserMFAStatus } from "@domain/identity"
import { ProfileScreen, type ProfileScreenProps, providerOnlyNames } from "./profile-screen.tsx"
import { AuthScreen, type AuthScreenProps } from "./auth-screen.tsx"
import { ConfirmSignUpScreen, type ConfirmSignUpScreenProps } from "./confirm-sign-up-screen.tsx"
import { SignInMethods, type SignInMethodsProps } from "./sign-in-methods.tsx"

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
    // A link asks whether its address is this page's own before it hands a click to the router.
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

/** Clicks the button labelled `label` inside the dialog `dialog` names by its `data-e2e`. */
async function clickInDialog(dialog: string, label: string): Promise<void> {
  const button = [...document.querySelectorAll(`[data-e2e=${dialog}] button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the ${dialog} dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
}

/** What has focus: its `data-e2e`, or its tag name when it has none. */
function focused(): string {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName ?? "nothing"
}

const authDefaults: AuthScreenProps = {
  screen: "sign-in",
  isSignedIn: false,
  isMfaRequired: false,
  busy: false,
  error: null,
}

describe("AuthScreen last sign-in", () => {
  const last = { method: "google", email: "a***@example.com" } as const

  it("says on the sign-in screen which method was used last, with the masked address", async () => {
    await mount(<AuthScreen {...authDefaults} lastSignIn={last} />)

    expect(find("[data-e2e=last-sign-in] span").textContent)
      .toBe("Last time you signed in with Google (a***@example.com).")
    expect(find("[data-e2e=last-sign-in-forget]").textContent).toBe("Not you? Forget")
  })

  it("names a password sign-in that kept no address", async () => {
    await mount(<AuthScreen {...authDefaults} lastSignIn={{ method: "password", email: null }} />)

    expect(find("[data-e2e=last-sign-in] span").textContent)
      .toBe("Last time you signed in with your password.")
  })

  it("shows nothing when the browser remembers nothing, or on another screen", async () => {
    await mount(<AuthScreen {...authDefaults} />)
    expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)

    for (const screen of ["sign-up", "one-time-code"] as const) {
      await act(() =>
        render(<AuthScreen {...authDefaults} screen={screen} lastSignIn={last} />, root!)
      )
      expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)
    }
  })

  it("forgets on request, says so and moves focus to that sentence", async () => {
    let forgotten = 0
    await mount(
      <AuthScreen {...authDefaults} lastSignIn={last} onForgetLastSignIn={() => forgotten++} />,
    )

    await click("[data-e2e=last-sign-in-forget]")

    expect(forgotten).toBe(1)
    expect(document.querySelectorAll("[data-e2e=last-sign-in]").length).toBe(0)
    expect(find("[data-e2e=last-sign-in-forgotten]").getAttribute("role")).toBe("status")
    expect(focused()).toBe("last-sign-in-forgotten")
  })
})

describe("AuthScreen provider links", () => {
  it("offers one link per provider that is on, to the API's start route", async () => {
    await mount(<AuthScreen {...authDefaults} providers={["google", "github"]} />)

    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-e2e^=provider-]")]
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["Continue with Google", "/api/auth/google/start"],
      ["Continue with GitHub", "/api/auth/github/start"],
    ])
  })

  it("shows no provider link when none is on", async () => {
    await mount(<AuthScreen {...authDefaults} />)
    expect(document.querySelectorAll("[data-e2e^=provider-]").length).toBe(0)

    await mount(<AuthScreen {...authDefaults} screen="sign-up" providers={["github"]} />)
    expect([...document.querySelectorAll("[data-e2e^=provider-]")].map((link) => link.textContent))
      .toEqual(["Continue with GitHub"])
  })

  it("carries the page to return to into the provider link", async () => {
    await mount(<AuthScreen {...authDefaults} providers={["google"]} next="/notes/abc?tab=2" />)

    expect(find("[data-e2e=provider-google]").getAttribute("href"))
      .toBe("/api/auth/google/start?next=%2Fnotes%2Fabc%3Ftab%3D2")
  })

  it("leaves the app for the provider instead of routing inside it", async () => {
    const routed: string[] = []
    await mount(
      <AuthScreen
        {...authDefaults}
        providers={["google"]}
        navigate={(path) => void routed.push(path)}
      />,
    )

    // A link inside the app goes through the router: without it this test would prove nothing.
    await click(`a[href="/forgot-password"]`)
    expect(routed).toEqual(["/forgot-password"])

    await click("[data-e2e=provider-google]")

    expect(routed).toEqual(["/forgot-password"])
  })

  it("offers no provider on the one-time-code page", async () => {
    await mount(
      <AuthScreen {...authDefaults} screen="one-time-code" isMfaRequired providers={["google"]} />,
    )

    expect(document.querySelectorAll("[data-e2e^=provider-]").length).toBe(0)
  })
})

/** How a button is drawn: its classes without the width, in a fixed order. */
function look(button: Element): string {
  return [...button.classList].filter((name) => name !== "w-full").sort().join(" ")
}

const waiting: PendingSignUp = {
  provider: "google",
  email: "ada@example.com",
  expiresAt: "2026-11-04T08:10:00.000Z",
  unconfirmedAccount: false,
}

/** The question with a sign-up waiting, recording which answer the app received. */
function confirmProps(
  answers: string[],
  props: Partial<ConfirmSignUpScreenProps> = {},
): ConfirmSignUpScreenProps {
  return {
    pending: waiting,
    busy: false,
    error: null,
    onBack: () => void answers.push("back"),
    onCreate: () => void answers.push("create"),
    ...props,
  }
}

describe("ConfirmSignUpScreen", () => {
  it("asks before creating, naming the provider and the address", async () => {
    await mount(<ConfirmSignUpScreen {...confirmProps([])} />)

    expect(find("h1").textContent).toBe("Create a new account?")
    const card = find("[data-e2e=confirm-sign-up]").textContent
    expect(card).toContain("signs in with the Google account ada@example.com.")
    expect(find("[data-e2e=confirm-sign-up-email]").textContent).toBe("ada@example.com")
    expect(card).toContain("Nothing has been created yet.")
  })

  it("warns before creating that an unconfirmed account with this address gets locked", async () => {
    const mounted = await mount(<ConfirmSignUpScreen {...confirmProps([])} />)
    expect(document.querySelectorAll("[data-e2e=confirm-sign-up-unconfirmed]").length).toBe(0)

    await act(() => {
      render(
        <ConfirmSignUpScreen
          {...confirmProps([], { pending: { ...waiting, unconfirmedAccount: true } })}
        />,
        mounted,
      )
    })

    const warning = find("[data-e2e=confirm-sign-up-unconfirmed]")
    expect(warning.textContent).toContain("already uses this address, but never confirmed it.")
    expect(warning.textContent).toContain("its password stops working")
    expect(warning.textContent).toContain("To keep it, go back, sign in with its password")
    // Read before either answer can be given.
    const back = find("[data-e2e=confirm-sign-up-back]")
    expect(warning.compareDocumentPosition(back) & 4).toBe(4)
  })

  it("makes going back the first and the main action, and creating the second", async () => {
    await mount(<ConfirmSignUpScreen {...confirmProps([])} />)

    const buttons = [...document.querySelectorAll("[data-e2e=confirm-sign-up] button")]
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "I already have an account: go back to sign in",
      "Create a new account",
    ])
    // Drawn as the library draws its main and its secondary button.
    const [back, create] = buttons.map(look)
    const reference = await mount(
      <>
        <Button>Main</Button>
        <Button variant="secondary">Second</Button>
      </>,
    )
    const [main, second] = [...reference.querySelectorAll("button")].map(look)
    expect(main).not.toBe(second)
    expect(back).toBe(main)
    expect(create).toBe(second)
  })

  it("tells the app which answer was given", async () => {
    const answers: string[] = []
    await mount(<ConfirmSignUpScreen {...confirmProps(answers)} />)

    await click("[data-e2e=confirm-sign-up-back]")
    expect(answers).toEqual(["back"])

    await submit("[data-e2e=confirm-sign-up-create]")
    expect(answers).toEqual(["back", "create"])
  })

  it("takes no second answer while one is in flight", async () => {
    const answers: string[] = []
    await mount(<ConfirmSignUpScreen {...confirmProps(answers, { busy: true })} />)

    await submit("[data-e2e=confirm-sign-up-create]")
    await click("[data-e2e=confirm-sign-up-back]")

    expect(answers).toEqual([])
    expect(find<HTMLButtonElement>("[data-e2e=confirm-sign-up-back]").disabled).toBe(true)
  })

  it("moves focus to the reason when creating the account failed", async () => {
    const mounted = await mount(<ConfirmSignUpScreen {...confirmProps([])} />)
    expect(focused()).not.toBe("confirm-sign-up-error")

    await act(() =>
      render(<ConfirmSignUpScreen {...confirmProps([], { error: "Try again later" })} />, mounted)
    )

    expect(focused()).toBe("confirm-sign-up-error")
    expect(find("[data-e2e=confirm-sign-up-error]").textContent).toContain("Try again later")
  })

  it("names the provider alone when it shared no address", async () => {
    await mount(
      <ConfirmSignUpScreen
        {...confirmProps([], { pending: { ...waiting, provider: "github", email: null } })}
      />,
    )

    expect(find("[data-e2e=confirm-sign-up]").textContent).toContain("this GitHub account")
    expect(document.querySelector("[data-e2e=confirm-sign-up-email]")).toBe(null)
  })

  it("offers only the way back to sign-in when nothing waits", async () => {
    await mount(<ConfirmSignUpScreen {...confirmProps([], { pending: null })} />)

    const gone = find("[data-e2e=confirm-sign-up-gone]")
    expect(gone.textContent).toContain("Nothing was created")
    expect(gone.querySelectorAll("button").length).toBe(0)
    expect(gone.querySelector("a")?.getAttribute("href")).toBe("/sign-in")
  })

  it("offers no answer while it is not known whether a sign-up waits", async () => {
    await mount(<ConfirmSignUpScreen {...confirmProps([], { pending: undefined })} />)

    expect(document.querySelectorAll("button").length).toBe(0)
  })
})

const password: SignInMethod = {
  id: 3,
  kind: "password",
  email: "ada@example.com",
  current: true,
  canUnlink: false,
}
const google: SignInMethod = {
  id: 8,
  kind: "google",
  email: "ada@example.com",
  current: false,
  canUnlink: true,
}

/** The card with a password and Google, recording what the app was asked to do. */
function methodsProps(
  asked: (string | number)[],
  props: Partial<SignInMethodsProps> = {},
): SignInMethodsProps {
  return {
    methods: [password, google],
    available: ["github"],
    pending: false,
    error: null,
    onLink: (provider) => void asked.push(provider),
    onUnlink: (id) => void asked.push(id),
    ...props,
  }
}

function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
}

describe("SignInMethods", () => {
  it("lists each method with its address and marks the one this device used", async () => {
    await mount(<SignInMethods {...methodsProps([])} />)

    const passwordRow = find("[data-e2e=sign-in-method-password]").textContent
    expect(passwordRow).toContain("Password")
    expect(passwordRow).toContain("ada@example.com")
    expect(passwordRow).toContain("Used on this device")
    const googleRow = find("[data-e2e=sign-in-method-google]").textContent
    expect(googleRow).toContain("Google")
    expect(googleRow).not.toContain("Used on this device")
  })

  it("offers Unlink only on a method the server says can go", async () => {
    await mount(<SignInMethods {...methodsProps([])} />)

    expect(find("[data-e2e=sign-in-method-password]").querySelectorAll("button").length).toBe(0)
    expect(find("[data-e2e=sign-in-method-unlink-google]").textContent).toBe("Unlink Google")
  })

  it("says why the only method has no Unlink", async () => {
    const only = { ...google, current: true, canUnlink: false }
    await mount(<SignInMethods {...methodsProps([], { methods: [only] })} />)

    const row = find("[data-e2e=sign-in-method-google]")
    expect(row.querySelectorAll("button").length).toBe(0)
    expect(row.textContent).toContain("Your only way to sign in")
  })

  it("asks before unlinking, and unlinks nothing when the person cancels", async () => {
    const asked: (string | number)[] = []
    await mount(<SignInMethods {...methodsProps(asked)} />)

    await click("[data-e2e=sign-in-method-unlink-google]")
    expect(isOpen("sign-in-method-unlink-confirm")).toBe(true)
    expect(find("[data-e2e=sign-in-method-unlink-confirm]").textContent)
      .toContain("This device stays signed in.")
    expect(asked).toEqual([])

    await clickInDialog("sign-in-method-unlink-confirm", "Cancel")
    expect(asked).toEqual([])
    expect(isOpen("sign-in-method-unlink-confirm")).toBe(false)
  })

  it("unlinks the confirmed method by its id", async () => {
    const asked: (string | number)[] = []
    await mount(<SignInMethods {...methodsProps(asked)} />)

    await click("[data-e2e=sign-in-method-unlink-google]")
    await clickInDialog("sign-in-method-unlink-confirm", "Unlink")

    expect(asked).toEqual([8])
  })

  it("warns that unlinking the method this device used signs it out", async () => {
    const used = { ...google, current: true }
    await mount(
      <SignInMethods {...methodsProps([], { methods: [{ ...password, current: false }, used] })} />,
    )

    await click("[data-e2e=sign-in-method-unlink-google]")

    const dialog = find("[data-e2e=sign-in-method-unlink-confirm]").textContent
    expect(dialog).toContain("it will be signed out")
    expect(dialog).not.toContain("This device stays signed in.")
  })

  it("offers to link each provider that is not linked yet", async () => {
    const asked: (string | number)[] = []
    await mount(<SignInMethods {...methodsProps(asked)} />)

    expect(find("[data-e2e=sign-in-method-link-github]").textContent).toBe("Link GitHub")
    expect(document.querySelector("[data-e2e=sign-in-method-link-google]")).toBe(null)
    await click("[data-e2e=sign-in-method-link-github]")

    expect(asked).toEqual(["github"])
  })

  it("lets nothing be pressed while a change is in flight", async () => {
    const asked: (string | number)[] = []
    await mount(<SignInMethods {...methodsProps(asked, { pending: true })} />)

    await click("[data-e2e=sign-in-method-link-github]")
    await click("[data-e2e=sign-in-method-unlink-google]")

    expect(asked).toEqual([])
    expect(isOpen("sign-in-method-unlink-confirm")).toBe(false)
  })

  it("moves focus to the reason when a change failed", async () => {
    const mounted = await mount(<SignInMethods {...methodsProps([])} />)

    await act(() =>
      render(
        <SignInMethods {...methodsProps([], { error: "This is your only way to sign in." })} />,
        mounted,
      )
    )

    expect(focused()).toBe("sign-in-methods-error")
    expect(find("[data-e2e=sign-in-methods-error]").textContent)
      .toContain("This is your only way to sign in.")
  })

  it("moves focus to the list when the unlinked method leaves it", async () => {
    const mounted = await mount(<SignInMethods {...methodsProps([])} />)
    find("[data-e2e=sign-in-method-unlink-google]").focus()

    // The same list again moves nothing.
    await act(() => {
      render(<SignInMethods {...methodsProps([], { methods: [password, google] })} />, mounted)
    })
    expect(focused()).toBe("sign-in-method-unlink-google")

    await act(() => {
      render(<SignInMethods {...methodsProps([], { methods: [password] })} />, mounted)
    })
    expect(focused()).toBe("sign-in-methods-list")
  })

  it("shows that the list is loading before it is known", async () => {
    await mount(<SignInMethods {...methodsProps([], { methods: null, available: [] })} />)

    expect(find("[data-e2e=sign-in-methods]").textContent).toContain("Loading")
    expect(document.querySelectorAll("button").length).toBe(0)
  })
})

describe("ProfileScreen for an account without a password", () => {
  const profile = {
    onRemovePush: () => {},
    user: { id: 1, firstName: "Gia", lastName: "", mfa: UserMFAStatus.NOT_CONFIGURED },
    isMfaRequired: false,
    email: { email: "gia@example.com", proven: true, pending: null },
    values: { firstName: "Gia", lastName: "", currentPassword: "", newPassword: "", otp: "" },
    onValueChange: () => {},
    errors: { fields: {}, profile: null, password: null, totp: null, push: null },
    pending: { profile: false, password: false, totp: false, push: false },
    enrolment: null,
    pushDevices: [],
  } as unknown as ProfileScreenProps
  const onlyGoogle = { ...google, current: true, canUnlink: false }

  it("shows the provider's address and offers no change that would ask for a password", async () => {
    await mount(
      <ProfileScreen {...profile} methods={methodsProps([], { methods: [onlyGoogle] })} />,
    )

    const page = document.body.textContent ?? ""
    expect(page).not.toContain("You sign in with your username")
    expect(find("[data-e2e=profile-email-from-provider]").textContent).toBe(
      "From Google. It cannot be changed here: this account has no password to confirm the change with.",
    )
    expect(page).toContain("gia@example.com")
    expect(document.querySelectorAll("[data-e2e=profile-email-link]").length).toBe(0)
    expect(find("[data-e2e=password-none]").textContent).toBe("None. You sign in with Google.")
    expect(document.querySelectorAll("[data-e2e=password-open]").length).toBe(0)
  })

  it("keeps both changes for an account that has a password", async () => {
    await mount(
      <ProfileScreen {...profile} methods={methodsProps([], { methods: [password, google] })} />,
    )

    expect(find("[data-e2e=profile-email-link]").textContent).toBe("Change e-mail address")
    expect(find("[data-e2e=password-open]").textContent).toBe("Change password")
    expect(document.querySelectorAll("[data-e2e=profile-email-from-provider]").length).toBe(0)
    expect(document.querySelectorAll("[data-e2e=password-none]").length).toBe(0)
  })

  const deletion = {
    blockers: [],
    values: { password: "", otp: "" },
    onValueChange: () => {},
    errors: { form: null },
    pending: false,
  }

  it("offers no delete dialog, which would ask for a password, and says why", async () => {
    await mount(
      <ProfileScreen
        {...profile}
        methods={methodsProps([], { methods: [onlyGoogle] })}
        accountDeletion={deletion}
      />,
    )

    expect(document.querySelectorAll("[data-e2e=account-delete-open]").length).toBe(0)
    expect(find("[data-e2e=account-delete-unavailable]").textContent).toBe(
      "This account cannot be deleted here yet: it has no password to confirm the deletion with.",
    )
  })

  it("keeps the delete action for an account that has a password", async () => {
    await mount(
      <ProfileScreen
        {...profile}
        methods={methodsProps([], { methods: [password, google] })}
        accountDeletion={deletion}
      />,
    )

    expect(find("[data-e2e=account-delete-open]").textContent).toBe("Delete my account")
    expect(document.querySelectorAll("[data-e2e=account-delete-unavailable]").length).toBe(0)
  })

  it("names every provider of an account that has two and no password", () => {
    const github = { ...google, id: 9, kind: "github" as const }
    expect(providerOnlyNames([onlyGoogle, github])).toBe("Google and GitHub")
    expect(providerOnlyNames(null)).toBe(null)
    expect(providerOnlyNames([])).toBe(null)
  })
})
