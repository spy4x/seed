/**
 * The groups page's invitations, drawn by the real view over the real store with a fake API: what
 * the screen's own tests cannot show is when the store takes an answered row out of its list.
 */

import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { GroupRole } from "@domain/groups"
import { createInvitationsStore, type InvitationFetch } from "../state/invitations.ts"
import { MyInvitationsView } from "./InvitationView.tsx"

const window = new Window({ url: "http://app.localhost/groups" })
const own = { document: globalThis.document }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document })
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

const invitation = (id: string, groupName: string) => ({
  id,
  groupId: `g-${id}`,
  groupName,
  inviterName: "Olga Owner",
  role: GroupRole.VIEWER,
  addressed: true,
  forYou: true,
  expiresAt: "2026-02-01T00:00:00.000Z",
})

/**
 * Lets the pending requests answer and the page draw what they changed. Not inside `act`, which
 * holds every render back until it ends: the page draws when Preact itself would, so two store
 * updates a moment apart are two renders here, as they are in a browser. Effects run 100 ms after
 * a render where there is no `requestAnimationFrame`.
 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 250))

/**
 * The groups page with the view on it, over a store whose API holds `rows`. Each answer arrives a
 * moment after its request, as one from a server does. `declineStatus` is what a decline gets.
 */
async function page(rows: ReturnType<typeof invitation>[], declineStatus = 200) {
  const held = { rows }
  const fetch: InvitationFetch = async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 2))
    if ((init?.method ?? "GET") === "GET") return Response.json({ invitations: held.rows })
    return url.endsWith("/decline") && declineStatus === 200
      ? Response.json({})
      : Response.json({ error: { message: "Refused." } }, { status: declineStatus })
  }
  const store = createInvitationsStore({ fetch, origin: () => "http://app.localhost" })
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={memoryLocation({ path: "/groups" }).hook}>
        <button type="button" data-e2e="page-action">New group</button>
        <MyInvitationsView store={store} />
      </Router>,
      root!,
    )
  )
  await settle()
  return { store, held }
}

/** Focuses the button named `label` and presses it. */
async function press(label: string): Promise<void> {
  const button = document.querySelector<HTMLElement>(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`no button "${label}"`)
  button.focus()
  button.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
  )
  await settle()
}

/** What has focus: its accessible name, else its `data-e2e`, else its tag. */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("aria-label") ?? element?.getAttribute("data-e2e") ??
    element?.tagName
}

describe("MyInvitationsView", () => {
  it("moves focus to the next invitation once the store took a declined one away, and to the page's first button after the last", async () => {
    await page([invitation("i-1", "Team"), invitation("i-2", "Family")])

    await press("Decline the invitation to Team")
    expect(focused()).toBe("Decline the invitation to Family")

    await press("Decline the invitation to Family")
    expect(focused()).toBe("page-action")
  })

  it("leaves focus alone when an invitation goes without an answer from this page", async () => {
    const { store, held } = await page(
      [invitation("i-1", "Team"), invitation("i-2", "Family")],
      409,
    )
    await press("Decline the invitation to Team")
    expect(focused()).toBe("invitation-answer-error")
    document.querySelector<HTMLElement>("[data-e2e=page-action]")!.focus()

    // The refused invitation was withdrawn meanwhile, and the list is read again.
    held.rows = held.rows.slice(1)
    await store.loadMine()
    await settle()

    expect(document.querySelectorAll("[data-e2e=invitation-card]").length).toBe(1)
    expect(focused()).toBe("page-action")
  })
})
