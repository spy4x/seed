/**
 * The API token page drawn by the real view over a real token store with a fake API: what the
 * screen's own tests cannot show is that Done forgets the secret before it leaves, and that an
 * offline submit sends nothing.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { type ApiToken, ApiTokenAccess, type ApiTokenCreateRequest } from "@domain/api-tokens"
import { GroupRole } from "@domain/groups"
import { API_TOKEN_OFFLINE } from "@ui/api-token-new-screen.tsx"
import { createApiTokensStore } from "../state/api-tokens.ts"
import { groupsStore } from "../state/groups.ts"
import { ApiTokenNewView } from "./ApiTokenNewView.tsx"

const window = new Window({ url: "http://app.localhost/tokens/new" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  window: globalThis.window,
}

beforeAll(() => {
  // The view follows the network through `online` and `offline` events on `window`.
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
    window,
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
  groupsStore.reset()
  await act(() => {
    window.dispatchEvent(new window.Event("online"))
  })
})

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const SECRET = "tpl_shown-once-secret0000"
const token: ApiToken = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111009",
  name: "Zapier",
  groupId,
  groupName: "Personal",
  access: ApiTokenAccess.READ,
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
}

/** The page at `/tokens/new`, over a store whose fake API records each create it receives. */
async function page() {
  groupsStore.groups.value = [{
    id: groupId,
    name: "Personal",
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: "1",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }]
  groupsStore.loading.value = false
  const sent: ApiTokenCreateRequest[] = []
  const store = createApiTokensStore({
    list: () => Promise.resolve({ ok: true, data: { tokens: [] } }),
    create: (request) => {
      sent.push(request)
      return Promise.resolve({ ok: true, data: { token, secret: SECRET } })
    },
    revoke: () => Promise.resolve({ ok: true, data: {} }),
  })
  const location = memoryLocation({ path: "/tokens/new", record: true })
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={location.hook}>
        <ApiTokenNewView store={store} />
      </Router>,
      root!,
    )
  )
  return { store, sent, location }
}

function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}

async function type(selector: string, value: string): Promise<void> {
  const field = find(selector) as HTMLInputElement
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

describe("ApiTokenNewView", () => {
  it("creates the token for the first group, forgets the secret on Done and opens the profile", async () => {
    const { store, sent, location } = await page()

    await type("[data-e2e=api-token-name]", "Zapier")
    await type("[data-e2e=api-token-password]", "correct horse")
    await submit("[data-e2e=api-token-name]")
    expect(sent.map((request) => request.groupId)).toEqual([groupId])
    expect(find("[data-e2e=api-token-secret]").textContent).toContain(SECRET)

    await act(() => {
      find("[data-e2e=api-token-done]").click()
    })
    expect(store.created.value).toBe(null)
    expect(location.history.at(-1)).toBe("/")
    // The address and the history never held the secret.
    expect(location.history.join(" ")).not.toContain(SECRET)
  })

  it("sends nothing while offline and says why under the form", async () => {
    const { sent } = await page()
    await act(() => {
      window.dispatchEvent(new window.Event("offline"))
    })

    await type("[data-e2e=api-token-name]", "Zapier")
    await type("[data-e2e=api-token-password]", "correct horse")
    await submit("[data-e2e=api-token-name]")

    expect(sent).toEqual([])
    expect(find("[data-e2e=api-token-offline]").textContent).toContain("You are offline")
    expect(find("[data-e2e=api-token-error]").textContent).toContain(API_TOKEN_OFFLINE)
  })
})
