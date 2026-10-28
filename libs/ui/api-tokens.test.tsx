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
import { API_TOKEN_MESSAGES, ApiTokens, type ApiTokensProps } from "./api-tokens.tsx"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import { englishLeft, PSEUDO } from "./i18n-testing.ts"
import { ProfileScreen } from "./profile-screen.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  CSS: globalThis.CSS,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    CSS: window.CSS,
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
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }) as unknown as Event,
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

function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
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

/** The section with two tokens, recording every call the app would receive. */
function tokensProps(calls: unknown[][], props: Partial<ApiTokensProps> = {}): ApiTokensProps {
  return {
    tokens: [writer, reader],
    canCreate: true,
    error: null,
    revoking: false,
    onRevoke: (id) => void calls.push(["revoke", id]),
    navigate: (to) => void calls.push(["navigate", to]),
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

  it("links to the API docs in a new tab, with or without tokens, and not without a website", async () => {
    const docsHref = "https://www.example.com/docs/api"
    for (const tokens of [undefined, []]) {
      await mount(<ApiTokens {...tokensProps([], { ...(tokens && { tokens }), docsHref })} />)
      const link = find("[data-e2e=api-tokens-docs]")
      expect(link.getAttribute("href")).toBe(docsHref)
      expect(link.getAttribute("target")).toBe("_blank")
      expect(link.textContent).toBe("How to use a token, opens in a new tab")
    }

    await mount(<ApiTokens {...tokensProps([], { docsHref: null })} />)
    expect(document.querySelector("[data-e2e=api-tokens-docs]")).toBeNull()
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

  it("names the token in the revoke question", async () => {
    await mount(<ApiTokens {...tokensProps([])} />)

    await click(`[data-e2e=api-token-revoke-${reader.id}]`)
    expect(find("[data-e2e=api-token-revoke-confirm]").textContent).toContain("Revoke “Zapier”?")
  })

  it("opens the create page from New token, a link a person can also open in a new tab", async () => {
    const calls: unknown[][] = []
    await mount(<ApiTokens {...tokensProps(calls)} />)

    const opener = find<HTMLAnchorElement>("[data-e2e=api-token-create-open]")
    expect(opener.tagName).toBe("A")
    expect(opener.textContent?.trim()).toBe("New token")
    expect(opener.getAttribute("href")).toBe("/tokens/new")
    await click("[data-e2e=api-token-create-open]")
    expect(calls).toEqual([["navigate", "/tokens/new"]])
    expect(document.querySelectorAll("dialog").length).toBe(0)
  })

  it("shows an empty list with its one action, and no action without a group", async () => {
    await mount(<ApiTokens {...tokensProps([], { tokens: [] })} />)
    expect(find("[data-e2e=api-tokens]").textContent).toContain("No API tokens")
    expect(document.querySelectorAll("[data-e2e=api-token-create-open]").length).toBe(1)

    await mount(<ApiTokens {...tokensProps([], { tokens: [], canCreate: false })} />)
    expect(document.querySelectorAll("[data-e2e=api-token-create-open]").length).toBe(0)
  })

  it("disables every revoke while one is in flight, and shows a failure above the list", async () => {
    await mount(
      <ApiTokens
        {...tokensProps([], {
          revoking: true,
          error: "Could not revoke.",
        })}
      />,
    )

    expect(find<HTMLButtonElement>(`[data-e2e=api-token-revoke-${reader.id}]`).disabled).toBe(true)
    expect(find("[data-e2e=api-tokens]").textContent).toContain("Could not revoke.")
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
  it("draws the tokens on their own profile section, without the signed-in devices", async () => {
    await mount(
      <ProfileScreen
        section="api-tokens"
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
          totpPassword: "",
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

    expect(find("[data-e2e=settings-heading]").textContent).toBe("API tokens")
    expect(document.querySelector(`[data-e2e=api-token-${writer.id}]`)).not.toBeNull()
    expect(document.querySelector("[data-e2e=sessions]")).toBeNull()
  })
})

describe("ApiTokens in another language", () => {
  it("shows no English outside the catalogs: an en-XA render of the list, its states and the revoke question is all pseudo-language or data", async () => {
    const format = createFormatters({ locale: "en-GB", timeZone: "UTC", hourCycle: "h23" })
    const inPseudo = (props: Partial<ApiTokensProps>) => (
      <I18nContext.Provider value={PSEUDO}>
        <FormatContext.Provider value={format}>
          <ApiTokens {...tokensProps([], { docsHref: "https://example.com/api", ...props })} />
        </FormatContext.Provider>
      </I18nContext.Provider>
    )
    // Data: the tokens' and their group's names, and the dates and times the format writes.
    const data = () =>
      [
        "Zapier",
        "Backup script",
        "Personal",
        ...[...document.querySelectorAll("time")].flatMap((time) => [
          time.textContent ?? "",
          time.getAttribute("title") ?? "",
        ]),
      ].filter(Boolean)

    await mount(inPseudo({ error: API_TOKEN_MESSAGES.failed, savedAt: Date.now() }))
    await click(`[data-e2e=api-token-revoke-${reader.id}]`)
    expect(englishLeft(document.body, data())).toEqual([])
    const page = document.body.textContent ?? ""
    for (
      const key of ["ApiTokens.failed", "ApiTokens.savedCopyTitle", "ApiTokens.revokeMessage"]
    ) {
      expect(page).toContain(PSEUDO.t(key))
    }

    await mount(inPseudo({ tokens: [] }))
    expect(englishLeft(document.body, data())).toEqual([])
    expect(document.body.textContent).toContain(PSEUDO.t("ApiTokens.emptyText"))

    await mount(inPseudo({ tokens: null }))
    expect(englishLeft(document.body, data())).toEqual([])
    expect(document.body.textContent).toContain(PSEUDO.t("ApiTokens.loading"))
  })
})
