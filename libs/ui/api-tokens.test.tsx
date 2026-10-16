/**
 * The "API tokens" section, driven in a browser DOM (happy-dom): what the list shows, what asks
 * first, what the app receives and where focus goes.
 */
import { formatTime } from "@spy4x/platform/universal/time"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type ApiToken, ApiTokenAccess } from "@domain/api-tokens"
import { UserMFAStatus } from "@domain/identity"
import { ApiTokens, type ApiTokensProps } from "./api-tokens.tsx"
import { ProfileScreen } from "./profile-screen.tsx"

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

/** Renders `node`, into the same root when one is mounted already, as a prop change would. */
async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
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

async function clickInDialog(dialog: string, label: string): Promise<void> {
  const button = [...document.querySelectorAll(`[data-e2e=${dialog}] button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the ${dialog} dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
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

function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
}

function focused(): string | null | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.getAttribute("aria-label") ??
    element?.tagName
}

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

const reader: ApiToken = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2027-01-02T10:00:00.000Z",
  lastUsedAt: null,
}
const writer: ApiToken = {
  ...reader,
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111010",
  name: "Backup script",
  access: ApiTokenAccess.WRITE,
  expiresAt: null,
  lastUsedAt: "2026-10-04T09:00:00.000Z",
}

const NO_ERRORS = { list: null, name: null, password: null, form: null }

/** The section with two tokens, recording every call the app would receive. */
function tokensProps(calls: unknown[][], props: Partial<ApiTokensProps> = {}): ApiTokensProps {
  return {
    tokens: [writer, reader],
    groups: [{ id: groupId, name: "Personal" }],
    values: { name: "", password: "", groupId, access: ApiTokenAccess.READ, expiresInDays: 90 },
    onValueChange: (field, value) => void calls.push(["value", field, value]),
    errors: { list: null, name: null, password: null, form: null },
    pending: { create: false, revoke: false },
    created: null,
    onStartCreate: () => void calls.push(["start"]),
    onCreate: () => void calls.push(["create"]),
    onDismissSecret: () => void calls.push(["dismiss"]),
    onRevoke: (id) => void calls.push(["revoke", id]),
    ...props,
  }
}

describe("ApiTokens", () => {
  it("shows each token's group, access, expiry and last use, never a secret", async () => {
    await mount(<ApiTokens {...tokensProps([])} />)

    const row = find(`[data-e2e=api-token-${writer.id}]`)
    expect(row.textContent).toContain("Backup script")
    expect(row.textContent).toContain("Personal")
    expect(row.textContent).toContain("Read and write")
    expect(row.textContent).toContain("Never expires")
    expect(row.querySelector("time")?.getAttribute("datetime")).toBe(writer.lastUsedAt)
    const other = find(`[data-e2e=api-token-${reader.id}]`).textContent
    expect(other).toContain("Read only")
    expect(other).toContain("Never used")
    expect(find("[data-e2e=api-tokens]").textContent).not.toContain("tpl_")
  })

  it("shows an empty token list inside the section's own card, not in a dashed box", async () => {
    await mount(<ApiTokens {...tokensProps([], { tokens: [] })} />)

    // The saved-copy notice is a status region too, always in the page, so pick the empty state's.
    const empty = [...document.querySelectorAll("[data-e2e=api-tokens] [role=status]")]
      .find((region) => region.textContent?.includes("No API tokens"))
    expect(empty?.closest(".pc-card")).not.toBeNull()
    expect(document.querySelectorAll(".border-dashed").length).toBe(0)
  })

  it("says that changing or resetting the password revokes every token", async () => {
    await mount(<ApiTokens {...tokensProps([])} />)

    expect(find("[data-e2e=api-tokens]").textContent).toContain(
      "Changing or resetting your password revokes every token",
    )
  })

  it("revokes a token only after the person confirms", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)

    expect(find(`[data-e2e=api-token-revoke-${reader.id}]`).textContent).toBe("Revoke Zapier")
    await click(`[data-e2e=api-token-revoke-${reader.id}]`)
    expect(isOpen("api-token-revoke-confirm")).toBe(true)
    await clickInDialog("api-token-revoke-confirm", "Cancel")
    expect(calls).toEqual([])

    await click(`[data-e2e=api-token-revoke-${reader.id}]`)
    await clickInDialog("api-token-revoke-confirm", "Revoke")
    expect(calls).toEqual([["revoke", reader.id]])
  })

  it("creates a token in a dialog: it opens empty, takes the name and the password and submits through onCreate", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)
    expect(isOpen("api-token-dialog")).toBe(false)

    await click("[data-e2e=api-token-create-open]")
    expect(isOpen("api-token-dialog")).toBe(true)
    await type("[data-e2e=api-token-name]", "Zapier")
    await type("[data-e2e=api-token-password]", "correct horse")
    await submit("[data-e2e=api-token-name]")

    expect(calls).toEqual([
      ["start"],
      ["value", "name", "Zapier"],
      ["value", "password", "correct horse"],
      ["create"],
    ])
  })

  it("asks for the current password in a labelled password field a manager can fill", async () => {
    await mount(<ApiTokens {...tokensProps([])} />)
    await click("[data-e2e=api-token-create-open]")

    const input = find<HTMLInputElement>("[data-e2e=api-token-password]")
    expect(input.type).toBe("password")
    expect(input.getAttribute("autocomplete")).toBe("current-password")
    expect(document.querySelector(`label[for=${input.id}]`)?.textContent).toContain("Your password")
  })

  it("moves focus to the password when it is refused, with the message tied to it", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)
    await click("[data-e2e=api-token-create-open]")
    await mount(
      <ApiTokens
        {...tokensProps(calls, { errors: { ...NO_ERRORS, password: "Wrong password" } })}
      />,
    )

    const input = find<HTMLInputElement>("[data-e2e=api-token-password]")
    expect(focused()).toBe("api-token-password")
    const describedBy = input.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Wrong password")
  })

  it("moves focus to the name, the first field, when both are refused", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)
    await click("[data-e2e=api-token-create-open]")
    await mount(
      <ApiTokens
        {...tokensProps(calls, {
          errors: { ...NO_ERRORS, name: "Name is too long", password: "Wrong password" },
        })}
      />,
    )
    expect(focused()).toBe("api-token-name")
  })

  it("moves focus to the name when it is refused, with the message tied to it", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)
    await click("[data-e2e=api-token-create-open]")
    await mount(
      <ApiTokens
        {...tokensProps(calls, { errors: { ...NO_ERRORS, name: "Name is too long" } })}
      />,
    )

    const input = find<HTMLInputElement>("[data-e2e=api-token-name]")
    expect(focused()).toBe("api-token-name")
    const describedBy = input.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Name is too long")
  })

  it("shows the new secret once with a copy control that takes focus, and forgets it on Done", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)
    await click("[data-e2e=api-token-create-open]")
    await mount(
      <ApiTokens
        {...tokensProps(calls, { created: { token: reader, secret: "tpl_shown-once-secret0000" } })}
      />,
    )

    expect(isOpen("api-token-dialog")).toBe(true)
    expect(find("[data-e2e=api-token-secret]").textContent).toContain("tpl_shown-once-secret0000")
    expect(document.activeElement?.closest("[data-e2e=api-token-secret]")).not.toBe(null)
    expect(document.activeElement?.tagName).toBe("BUTTON")
    expect(document.querySelectorAll("[data-e2e=api-token-name]").length).toBe(0)

    await click("[data-e2e=api-token-done]")
    expect(calls).toEqual([["start"], ["dismiss"]])
    await mount(<ApiTokens {...tokensProps(calls)} />)
    expect(isOpen("api-token-dialog")).toBe(false)
    expect(document.body.textContent).not.toContain("tpl_shown-once-secret0000")
  })

  it("shows an empty list with its one action, and no action without a group", async () => {
    await mount(<ApiTokens {...tokensProps([], { tokens: [] })} />)
    expect(find("[data-e2e=api-tokens]").textContent).toContain("No API tokens")
    expect(document.querySelectorAll("[data-e2e=api-token-create-open]").length).toBe(1)

    await mount(<ApiTokens {...tokensProps([], { tokens: [], groups: [] })} />)
    expect(document.querySelectorAll("[data-e2e=api-token-create-open]").length).toBe(0)
  })

  it("disables every revoke while one is in flight, and shows a failure above the list", async () => {
    await mount(
      <ApiTokens
        {...tokensProps([], {
          pending: { create: false, revoke: true },
          errors: { ...NO_ERRORS, list: "Could not revoke" },
        })}
      />,
    )

    expect(find<HTMLButtonElement>(`[data-e2e=api-token-revoke-${reader.id}]`).disabled).toBe(true)
    expect(find("[data-e2e=api-tokens]").textContent).toContain("Could not revoke")
  })

  it("says when the list is a copy saved on this device, with the time it was saved", async () => {
    const savedAt = Date.UTC(2026, 9, 10, 8, 30)
    await mount(<ApiTokens {...tokensProps([], { savedAt })} />)

    const notice = find("[data-e2e=api-tokens-saved-copy]")
    expect(notice.getAttribute("role")).toBe("status")
    expect(notice.textContent).toContain("Saved copy of your API tokens")
    // Worded in the machine's own zone, as the library does, so the test holds in every zone.
    const worded = formatTime(new Date(savedAt), { full: true })
    expect(notice.textContent).toContain(`saved on this device: ${worded}`)
    expect(notice.getAttribute("data-saved-at")).toBe("2026-10-10T08:30:00.000Z")
  })

  it("keeps an empty live region for the copy when the server answered", async () => {
    await mount(<ApiTokens {...tokensProps([], { savedAt: null })} />)

    const notice = find("[data-e2e=api-tokens-saved-copy]")
    expect(notice.getAttribute("role")).toBe("status")
    expect(notice.textContent).toBe("")
    expect(notice.hasAttribute("data-saved-at")).toBe(false)
  })
})

describe("ProfileScreen API tokens", () => {
  it("draws the section after the signed-in devices when the app passes it", async () => {
    await mount(
      <ProfileScreen
        onRemovePush={() => {}}
        user={{ firstName: "Ada", lastName: "Lovelace", mfa: UserMFAStatus.NOT_CONFIGURED }}
        isMfaRequired={false}
        email={{ email: "ada@example.com", proven: true, pending: null }}
        values={{
          firstName: "Ada",
          lastName: "Lovelace",
          currentPassword: "",
          newPassword: "",
          passwordOtp: "",
          otp: "",
          twoFactorProof: "",
        }}
        onValueChange={() => {}}
        errors={{ fields: {}, profile: null, password: null, totp: null, push: null }}
        pending={{ profile: false, password: false, totp: false, push: false }}
        enrolment={null}
        pushDevices={[]}
        devices={{
          sessions: [],
          pending: false,
          error: null,
          onEnd: () => {},
          onEndOthers: () => {},
        }}
        apiTokens={tokensProps([])}
      />,
    )

    const sections = [...document.querySelectorAll("section[data-e2e]")].map((section) =>
      section.getAttribute("data-e2e")
    )
    expect(sections.indexOf("api-tokens")).toBe(sections.indexOf("sessions") + 1)
  })
})
