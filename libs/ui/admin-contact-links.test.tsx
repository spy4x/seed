/**
 * The contact links' admin pages (#465), driven in a browser DOM (happy-dom): what the list's
 * menus send, the removal's confirmation, and the editor's fields, hints, errors and focus.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { ContactLinkRecord } from "@domain/contact-links"
import {
  AdminContactLinkEditorScreen,
  type AdminContactLinkEditorScreenProps,
  AdminContactLinksScreen,
  type AdminContactLinksScreenProps,
} from "./admin-contact-links.tsx"

const window = new Window({ url: "http://admin.localhost/contact-links" })
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

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The button whose text, without its key hint, starts with `text`; inside the open dialog if any. */
function button(text: string): HTMLButtonElement {
  const scope = document.querySelector("dialog") ?? document
  const found = [...scope.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text) ??
    [...scope.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.trim().startsWith(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found as unknown as HTMLButtonElement
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

const NOW = "2026-10-28T10:00:00.000Z"

function linkOf(id: string, overrides: Partial<ContactLinkRecord> = {}): ContactLinkRecord {
  return {
    id,
    kind: "telegram",
    value: "my_shop",
    label: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  }
}

const LINKS = [
  linkOf("0195f0b4-3c1e-7a00-8000-000000000001"),
  linkOf("0195f0b4-3c1e-7a00-8000-000000000002", {
    kind: "phone",
    value: "+84912345678",
    label: "Call us",
    position: 1,
  }),
]

function listProps(
  calls: unknown[][],
  overrides: Partial<AdminContactLinksScreenProps> = {},
): AdminContactLinksScreenProps {
  return {
    links: LINKS,
    error: null,
    busy: false,
    onRetry: () => calls.push(["retry"]),
    onMove: (id, by) => calls.push(["move", id, by]),
    onRemove: (link) => calls.push(["remove", link.id]),
    ...overrides,
  }
}

function row(index: number): Element {
  return document.querySelectorAll("[data-e2e=contact-link-row]")[index]
}

/** The labels of the menu items of row `index`, once its menu is open. */
async function openMenu(index: number): Promise<string[]> {
  await clickOn(row(index).querySelector("[data-e2e=contact-link-menu]")!)
  return [...row(index).querySelectorAll("[role=menuitem]")].map((item) =>
    item.textContent?.trim() ?? ""
  )
}

describe("the contact links list", () => {
  it("shows each link's label or value with its channel, in order", async () => {
    await mount(<AdminContactLinksScreen {...listProps([])} />)
    const rows = [...document.querySelectorAll("[data-e2e=contact-link-row] > div:first-child")]
    expect(rows.map((text) => text.textContent)).toEqual([
      "my_shopTelegram",
      "Call usPhone · +84912345678",
    ])
  })

  it("offers only the moves that can happen, and sends the one chosen", async () => {
    const calls: unknown[][] = []
    await mount(<AdminContactLinksScreen {...listProps(calls)} />)
    expect(await openMenu(0)).toEqual(["Edit link", "Move down", "Remove link"])
    await clickOn(row(0).querySelector("[data-e2e=contact-link-down]")!)
    expect(calls).toEqual([["move", LINKS[0].id, 1]])
    expect(await openMenu(1)).toEqual(["Edit link", "Move up", "Remove link"])
  })

  it("removes a link only after the dialog that names it is confirmed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminContactLinksScreen {...listProps(calls)} />)
    await openMenu(1)
    await clickOn(row(1).querySelector("[data-e2e=contact-link-remove]")!)
    expect(document.body.textContent).toContain(`Remove "Call us"?`)
    expect(calls).toEqual([])
    await clickOn(button("Remove link"))
    expect(calls).toEqual([["remove", LINKS[1].id]])
  })

  it("says there are no links yet and offers to add one", async () => {
    await mount(<AdminContactLinksScreen {...listProps([], { links: [] })} />)
    expect(document.body.textContent).toContain("No contact links yet")
  })

  it("says the list failed in its own words and tries again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminContactLinksScreen {...listProps(calls, { links: null, error: "boom" })} />)
    expect(find("[data-e2e=contact-links-error]").textContent).toContain("could not be loaded")
    await clickOn(button("Try again"))
    expect(calls).toEqual([["retry"]])
  })
})

function editorProps(
  calls: unknown[][],
  overrides: Partial<AdminContactLinkEditorScreenProps> = {},
): AdminContactLinkEditorScreenProps {
  return {
    link: null,
    loading: false,
    notFound: false,
    value: { kind: "telegram", value: "", label: "" },
    onChange: (value) => calls.push(["change", value]),
    errors: {},
    saving: false,
    onSave: () => calls.push(["save"]),
    onRemove: () => calls.push(["remove"]),
    ...overrides,
  }
}

describe("the contact link editor", () => {
  it("passes each typed field up and saves on submit", async () => {
    const calls: unknown[][] = []
    await mount(<AdminContactLinkEditorScreen {...editorProps(calls)} />)
    await type("[data-e2e=contact-link-value]", "@my_shop")
    await submit("[data-e2e=contact-link-value]")
    expect(calls).toEqual([
      ["change", { kind: "telegram", value: "@my_shop", label: "" }],
      ["save"],
    ])
  })

  it("names the link a valid value opens, and an example until then", async () => {
    await mount(<AdminContactLinkEditorScreen {...editorProps([])} />)
    expect(document.body.textContent).toContain("Such as my_shop")
    await mount(
      <AdminContactLinkEditorScreen
        {...editorProps([], { value: { kind: "zalo", value: "091 234 5678", label: "" } })}
      />,
    )
    expect(document.body.textContent).toContain("Opens https://zalo.me/0912345678")
    expect(document.body.textContent).toContain("Phone number")
  })

  it("shows a refused value under its field and moves focus there", async () => {
    await mount(
      <AdminContactLinkEditorScreen
        {...editorProps([], { errors: { value: "Enter a Telegram username." } })}
      />,
    )
    const field = find<HTMLInputElement>("[data-e2e=contact-link-value]")
    expect(document.activeElement).toBe(field)
    const described = field.getAttribute("aria-describedby") ?? ""
    expect(described.split(" ").map((id) => document.getElementById(id)?.textContent).join(" "))
      .toContain("Enter a Telegram username.")
  })
})
