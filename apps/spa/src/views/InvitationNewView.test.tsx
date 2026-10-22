/**
 * The invitation page (`/groups/:groupId/invitations/new`) drawn on the server by the real view over
 * the real stores: which group's plan it follows, where a refusal shows, and what a person who may
 * not invite, or is not in the group, sees instead of the form. In a browser DOM (happy-dom): what
 * opening and leaving the page reads and forgets.
 */
import "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render as draw } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { FREE_PLAN_ID, type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import type { User } from "@domain/identity"
import { VIEWERS_ONLY_HINT } from "@ui/group-invitations.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { invitationsStore } from "../state/invitations.ts"
import { sessionState } from "../state/session.ts"
import { InvitationNewView } from "./InvitationNewView.tsx"

const known = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  name: "Secret Team",
  role: GroupRole.ADMIN,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const strangerId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111999"

/** The page on the server for `groupId`: the router needs a path, because there is no `location`. */
const render = (groupId: string) =>
  renderToString(
    <Router ssrPath={`/groups/${groupId}/invitations/new`}>
      <InvitationNewView groupId={groupId} />
    </Router>,
  )

/** The page for the group `known`, held with `role`. */
const renderInvite = (role = GroupRole.ADMIN) => {
  groupsStore.groups.value = [{ ...known, role }]
  return render(known.id)
}

describe("InvitationNewView", () => {
  afterEach(() => {
    groupsStore.reset()
    billingStore.reset()
    invitationsStore.reset()
  })

  it("is a page titled New invitation for the group, with a form that creates the invitation", () => {
    const html = renderInvite()

    expect(html).toContain("New invitation")
    expect(html).toContain("Secret Team")
    expect(html).toContain("Create invitation")
    expect(html).toContain(`href="/groups/${known.id}/members"`)
    expect(html).not.toContain("<dialog")
  })

  it("refuses a guest at once with the reason and Keep your account, and draws no form", () => {
    sessionState.value = {
      ...sessionState.value,
      user: { id: 7, guestSince: new Date("2026-10-21T00:00:00.000Z") } as User,
    }
    try {
      const html = renderInvite()
      expect(html).toContain("Inviting needs a sign-in method")
      expect(html).toContain(`href="/keep"`)
      expect(html).not.toContain("invitation-form")
    } finally {
      sessionState.value = { ...sessionState.value, user: null }
    }
  })

  it("says the group does not exist, and shows no other group, for a group the person is not in", () => {
    groupsStore.groups.value = [known]
    groupsStore.loading.value = false

    const html = render(strangerId)

    expect(html).toContain("This group does not exist.")
    expect(html).not.toContain("Secret Team")
    expect(html).not.toContain("invitation-form")
  })

  it("tells an editor that only an admin or the owner can invite, and draws no form", () => {
    const html = renderInvite(GroupRole.EDITOR)

    expect(html).toContain("Only an admin or the owner can invite people.")
    expect(html).not.toContain("invitation-form")
  })

  it("shows the new link once in place of the form, titled Copy your invitation link", () => {
    invitationsStore.created.value = {
      link: "http://app.localhost/invite/shown-once",
      mailAsked: false,
      mailSent: false,
    }

    const html = renderInvite()

    expect(html).toContain("Copy your invitation link")
    expect(html).toContain("http://app.localhost/invite/shown-once")
    expect(html).not.toContain("invitation-form")
    expect(html).not.toContain("page-back")
  })

  it("offers invitations for viewers only while the group's plan lacks roles, and every role until the plan is read", () => {
    groupsStore.groups.value = [known]
    const plan = (planId: string): GroupBilling => ({
      enabled: true,
      planId,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canManage: false,
      subscribed: false,
      hasCustomer: false,
      trialEnd: null,
      notice: null,
      seatPrice: null,
    })
    const hint = VIEWERS_ONLY_HINT

    expect(renderInvite()).not.toContain(hint)
    billingStore.current.value = { groupId: known.id, billing: plan(FREE_PLAN_ID) }
    expect(renderInvite()).toContain(hint)
    billingStore.current.value = { groupId: strangerId, billing: plan(FREE_PLAN_ID) }
    expect(renderInvite()).not.toContain(hint)
    billingStore.current.value = { groupId: known.id, billing: plan(PRO_PLAN_ID) }
    expect(renderInvite()).not.toContain(hint)
  })

  it("shows a create refused for the price at the price box, and any other refusal under the form", () => {
    groupsStore.groups.value = [{ ...known, role: GroupRole.OWNER }]
    billingStore.current.value = {
      groupId: known.id,
      billing: {
        enabled: true,
        planId: PRO_PLAN_ID,
        status: 2,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canManage: true,
        subscribed: true,
        hasCustomer: true,
        trialEnd: null,
        notice: null,
        seatPrice: { seats: 2, amount: 900, currency: "EUR" },
      },
    }
    const box = (html: string) => html.match(/<input[^>]*name="acceptSeatPrice"[^>]*>/)?.[0] ?? ""

    invitationsStore.createError.value = {
      message: "Confirm the higher price",
      code: "SEAT_PRICE_NOT_ACCEPTED",
      plan: null,
    }
    const refused = renderInvite(GroupRole.OWNER)
    expect(refused).toContain(`id="invitation-seat-price-error"`)
    expect(box(refused)).toContain("invitation-seat-price-error")
    expect(refused.match(/Confirm the higher price/g)).toHaveLength(1)

    invitationsStore.createError.value = {
      message: "That address is not valid",
      code: "INVALID_REQUEST",
      plan: null,
    }
    const other = renderInvite(GroupRole.OWNER)
    expect(other).toContain("That address is not valid")
    expect(other).not.toContain(`id="invitation-seat-price-error"`)
  })

  it("shows a refusal for the creator's unverified address above the buttons with a way to the profile, not at the invitee's address", () => {
    const message = "Verify your e-mail address in your profile before you invite anyone."
    invitationsStore.createError.value = { message, code: "ADDRESS_NOT_PROVEN", plan: null }

    const html = renderInvite(GroupRole.OWNER)
    const email = html.match(/<input[^>]*name="email"[^>]*>/)?.[0] ?? ""
    const start = html.indexOf(`data-e2e="invitation-error"`)
    const notice = start < 0 ? "" : html.slice(start, html.indexOf(`data-e2e="invitation-create"`))

    expect(notice).toContain(message)
    expect(notice).toContain(`href="/profile/account?verify"`)
    expect(html.match(new RegExp(message, "g"))).toHaveLength(1)
    expect(email).not.toBe("")
    expect(email).not.toContain("aria-invalid")
    // The form stays, so the person can still fill it in and send it once the address is verified.
    expect(html).toContain(`data-e2e="invitation-create"`)
  })

  it("shows a refusal for the price under the form while the group's billing is not read", () => {
    groupsStore.groups.value = [{ ...known, role: GroupRole.OWNER }]
    billingStore.reset()
    invitationsStore.createError.value = {
      message: "Confirm the higher price",
      code: "SEAT_PRICE_NOT_ACCEPTED",
      plan: null,
    }

    const html = renderInvite(GroupRole.OWNER)

    expect(html).not.toContain(`name="acceptSeatPrice"`)
    expect(html).toContain("Confirm the higher price")
  })
})

describe("InvitationNewView in the browser", () => {
  const window = new Window({ url: `http://app.localhost/groups/${known.id}/invitations/new` })
  const NAMES = ["document", "location", "history", "getComputedStyle"] as const
  const own = Object.fromEntries(
    NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
  )
  const real = { open: invitationsStore.open, load: billingStore.load }
  /** What the page asked the stores to read: the group's invitations, and its plan. */
  let reads: string[] = []
  let root: HTMLElement | null = null

  beforeAll(() => {
    // Preact draws into `document`, the router reads `location` and `history`, and a dialog reads
    // the page's style.
    Object.assign(globalThis, {
      document: window.document,
      location: window.location,
      history: window.history,
      getComputedStyle: window.getComputedStyle.bind(window),
    })
    // The reads are recorded instead of sent, so the page never reaches a server.
    invitationsStore.open = (groupId: string) => {
      reads.push(`invitations ${groupId}`)
      return Promise.resolve()
    }
    billingStore.load = (groupId: string) => {
      reads.push(`plan ${groupId}`)
      return Promise.resolve()
    }
  })

  afterAll(async () => {
    Object.assign(globalThis, own)
    invitationsStore.open = real.open
    billingStore.load = real.load
    await window.happyDOM.close()
  })

  afterEach(async () => {
    if (root) await act(() => draw(null, root!))
    root?.remove()
    root = null
    reads = []
    groupsStore.reset()
    billingStore.reset()
    invitationsStore.reset()
  })

  async function mount(): Promise<void> {
    groupsStore.groups.value = [known]
    root = window.document.createElement("div") as unknown as HTMLElement
    window.document.body.appendChild(root as never)
    await act(() => draw(<InvitationNewView groupId={known.id} />, root!))
  }

  it("forgets the new link and the form when the page is left, so the link is shown once", async () => {
    await mount()
    await act(() => {
      invitationsStore.draft.value = { ...invitationsStore.draft.value, email: "ann@example.com" }
      invitationsStore.created.value = {
        link: "http://app.localhost/invite/shown-once",
        mailAsked: false,
        mailSent: false,
      }
    })
    expect(root!.textContent).toContain("http://app.localhost/invite/shown-once")

    await act(() => draw(null, root!))

    expect(invitationsStore.created.value).toBe(null)
    expect(invitationsStore.draft.value.email).toBe("")
  })

  it("reads the group's plan when the page opens, and not again when the group's page read it", async () => {
    await mount()
    expect(reads).toEqual([`invitations ${known.id}`, `plan ${known.id}`])
    await act(() => draw(null, root!))
    root?.remove()
    reads = []

    billingStore.current.value = {
      groupId: known.id,
      billing: {
        enabled: true,
        planId: PRO_PLAN_ID,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canManage: true,
        subscribed: false,
        hasCustomer: false,
        trialEnd: null,
        notice: null,
        seatPrice: null,
      },
    }
    await mount()

    expect(reads).toEqual([`invitations ${known.id}`])
  })
})
