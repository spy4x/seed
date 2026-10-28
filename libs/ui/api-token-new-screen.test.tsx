/**
 * The API token page (`/tokens/new`), driven in a browser DOM (happy-dom): the form, what the app
 * receives, where focus goes, the secret shown once, and the loading, no-group and offline states.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { API_TOKEN_MESSAGES } from "./api-tokens.tsx"
import { ENGLISH, englishLeft, PSEUDO } from "./i18n-testing.ts"
import {
  API_TOKEN_OFFLINE,
  ApiTokenNewScreen,
  type ApiTokenNewScreenProps,
} from "./api-token-new-screen.tsx"

const window = new Window({ url: "http://app.localhost/tokens/new" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, and a link
  // is routed only when it points at the page's own origin (`location`).
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
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

/** Renders `node`, into the same root when one is mounted already, as a prop change would. */
async function mount(node: VNode): Promise<void> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function count(selector: string): number {
  return document.querySelectorAll(selector).length
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

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function focused(): string | null | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** The text of every element that describes the field `selector` finds. */
function descriptionOf(selector: string): (string | null | undefined)[] {
  const describedBy = find(selector).getAttribute("aria-describedby") ?? ""
  return describedBy.split(" ").map((id) => document.getElementById(id)?.textContent)
}

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const token: ApiToken = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2027-01-02T10:00:00.000Z",
  lastUsedAt: null,
}
const SECRET = "tpl_shown-once-secret0000"
const NO_ERRORS = { name: null, password: null, form: null }

/** The page with one group and an empty form, recording every call the app would receive. */
function pageProps(
  calls: unknown[][],
  props: Partial<ApiTokenNewScreenProps> = {},
): ApiTokenNewScreenProps {
  return {
    groups: [{ id: groupId, name: "Personal" }],
    values: { name: "", password: "", groupId, access: ApiTokenAccess.READ, expiresInDays: 90 },
    onValueChange: (field, value) => void calls.push(["value", field, value]),
    errors: NO_ERRORS,
    pending: false,
    created: null,
    onCreate: () => void calls.push(["create"]),
    onDone: () => void calls.push(["done"]),
    navigate: (to) => void calls.push(["navigate", to]),
    ...props,
  }
}

describe("ApiTokenNewScreen", () => {
  it("is a page titled New API token with a way back to API tokens, never a dialog", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([])} />)

    expect(find("h1").textContent).toBe("New API token")
    const back = find("[data-e2e=page-back]")
    expect(back.getAttribute("href")).toBe("/profile/api-tokens")
    expect(back.getAttribute("aria-label")).toBe("Back to API tokens")
    expect(count("dialog")).toBe(0)
  })

  it("takes the name and the password and submits through onCreate", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokenNewScreen {...pageProps(calls)} />)

    await type("[data-e2e=api-token-name]", "Zapier")
    await type("[data-e2e=api-token-password]", "correct horse")
    await submit("[data-e2e=api-token-name]")

    expect(calls).toEqual([
      ["value", "name", "Zapier"],
      ["value", "password", "correct horse"],
      ["create"],
    ])
    expect(find("[data-e2e=api-token-create]").textContent).toBe("Create token")
  })

  it("leaves through Cancel to API tokens without creating anything", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokenNewScreen {...pageProps(calls)} />)

    expect(find("[data-e2e=api-token-cancel]").getAttribute("href")).toBe("/profile/api-tokens")
    await click("[data-e2e=api-token-cancel]")
    expect(calls).toEqual([["navigate", "/profile/api-tokens"]])
  })

  it("asks for the current password in a labelled password field a manager can fill", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([])} />)

    const input = find<HTMLInputElement>("[data-e2e=api-token-password]")
    expect(input.type).toBe("password")
    expect(input.getAttribute("autocomplete")).toBe("current-password")
    expect(document.querySelector(`label[for=${input.id}]`)?.textContent).toContain("Your password")
  })

  it("moves focus to the password when it is refused, with the message tied to it", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokenNewScreen {...pageProps(calls)} />)
    await mount(
      <ApiTokenNewScreen
        {...pageProps(calls, { errors: { ...NO_ERRORS, password: "Wrong password." } })}
      />,
    )

    expect(focused()).toBe("api-token-password")
    expect(descriptionOf("[data-e2e=api-token-password]")).toContain("Wrong password.")
  })

  it("moves focus to the name, the first field, when both are refused", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokenNewScreen {...pageProps(calls)} />)
    await mount(
      <ApiTokenNewScreen
        {...pageProps(calls, {
          errors: { ...NO_ERRORS, name: "Enter a name.", password: "Wrong password." },
        })}
      />,
    )

    expect(focused()).toBe("api-token-name")
    expect(descriptionOf("[data-e2e=api-token-name]")).toContain("Enter a name.")
  })

  it("shows the new secret once in place of the form, with a copy control that takes focus", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokenNewScreen {...pageProps(calls)} />)
    await mount(<ApiTokenNewScreen {...pageProps(calls, { created: { token, secret: SECRET } })} />)

    expect(find("h1").textContent).toBe("Copy your token")
    expect(find("[data-e2e=api-token-secret]").textContent).toContain(SECRET)
    expect(document.activeElement?.closest("[data-e2e=api-token-secret]")).not.toBe(null)
    expect(document.activeElement?.tagName).toBe("BUTTON")
    // No form and no back link: the one way on is Done, after the copy.
    expect(count("[data-e2e=api-token-name]")).toBe(0)
    expect(count("[data-e2e=page-back]")).toBe(0)

    await click("[data-e2e=api-token-done]")
    expect(calls).toEqual([["done"]])
  })

  it("links to the API docs in a new tab on the form and to the quick start beside the secret", async () => {
    const docsHref = "https://www.example.com/docs/api"
    await mount(<ApiTokenNewScreen {...pageProps([], { docsHref })} />)
    const form = find("[data-e2e=api-token-docs]")
    expect(form.getAttribute("href")).toBe(docsHref)
    expect(form.getAttribute("target")).toBe("_blank")

    await mount(
      <ApiTokenNewScreen {...pageProps([], { docsHref, created: { token, secret: SECRET } })} />,
    )
    const secret = find("[data-e2e=api-token-secret-docs]")
    expect(secret.getAttribute("href")).toBe(`${docsHref}#quick-start`)
    // A same-tab link would leave the page and lose the secret, shown once.
    expect(secret.getAttribute("target")).toBe("_blank")
    // Focus still lands on the copy control, not on the link.
    expect(document.activeElement?.closest("[data-e2e=api-token-secret]")).not.toBe(null)
  })

  it("shows no API docs link without a website", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([])} />)
    expect(count("[data-e2e=api-token-docs]")).toBe(0)
    await mount(<ApiTokenNewScreen {...pageProps([], { created: { token, secret: SECRET } })} />)
    expect(count("[data-e2e=api-token-secret-docs]")).toBe(0)
  })

  it("never draws the secret again once the app has forgotten it", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([], { created: { token, secret: SECRET } })} />)
    await mount(<ApiTokenNewScreen {...pageProps([])} />)

    expect(document.body.textContent).not.toContain(SECRET)
  })

  it("says it is offline above the form, and shows a refused submit's reason under it", async () => {
    await mount(
      <ApiTokenNewScreen
        {...pageProps([], { offline: true, errors: { ...NO_ERRORS, form: API_TOKEN_OFFLINE } })}
      />,
    )

    expect(find("[data-e2e=api-token-offline]").textContent).toContain("You are offline")
    expect(find("[data-e2e=api-token-offline]").textContent).toContain(ENGLISH.t(API_TOKEN_OFFLINE))
    expect(find("[data-e2e=api-token-error]").textContent).toContain(ENGLISH.t(API_TOKEN_OFFLINE))
  })

  it("says when the person is in no group to make a token for, with a way back", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([], { groups: [] })} />)

    expect(find("[data-e2e=api-token-no-group]").textContent).toContain(
      "You are not in a group you can make a token for.",
    )
    expect(find("[data-e2e=api-token-no-group] a").getAttribute("href")).toBe("/profile/api-tokens")
    expect(count("form")).toBe(0)
  })

  it("draws a placeholder only after 300 ms while the groups are read, and says it is loading", async () => {
    await mount(<ApiTokenNewScreen {...pageProps([], { groups: null })} />)
    expect(count("[data-e2e=api-token-loading]")).toBe(0)
    expect(count("form")).toBe(0)
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)))
    expect(find("[data-e2e=api-token-loading] [role=status]").textContent).toBe(
      "Loading your groups…",
    )
  })
})

describe("ApiTokenNewScreen in another language", () => {
  it("shows no English outside the catalogs: an en-XA render of the form, its errors and the secret is all pseudo-language or data", async () => {
    const inPseudo = (props: Partial<ApiTokenNewScreenProps>) => (
      <I18nContext.Provider value={PSEUDO}>
        <ApiTokenNewScreen
          {...pageProps([], { docsHref: "https://example.com/api", ...props })}
        />
      </I18nContext.Provider>
    )

    await mount(inPseudo({
      offline: true,
      errors: {
        name: API_TOKEN_MESSAGES.nameMissing,
        password: API_TOKEN_MESSAGES.passwordMissing,
        form: API_TOKEN_MESSAGES.createFailed,
      },
    }))
    expect(englishLeft(document.body, ["Personal"])).toEqual([])
    let page = document.body.textContent ?? ""
    for (
      const key of [
        "ApiTokenNewScreen.offline",
        "ApiTokenNewScreen.nameMissing",
        "ApiTokenNewScreen.passwordMissing",
        "ApiTokenNewScreen.createFailed",
        "ApiTokenNewScreen.expiresAfter",
      ]
    ) {
      expect(page).toContain(PSEUDO.t(key))
    }

    await mount(inPseudo({ created: { token, secret: SECRET } }))
    expect(englishLeft(document.body, [SECRET, "Authorization: Bearer"])).toEqual([])
    page = document.body.textContent ?? ""
    expect(page).toContain(PSEUDO.t("ApiTokenNewScreen.copyNow"))

    await mount(inPseudo({ groups: [] }))
    expect(englishLeft(document.body)).toEqual([])
    expect(document.body.textContent).toContain(PSEUDO.t("ApiTokenNewScreen.noGroup"))
  })
})
