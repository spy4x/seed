import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { FREE_PLAN_ID, type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { VIEWERS_ONLY_HINT } from "@ui/group-invitations.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { invitationsStore } from "../state/invitations.ts"
import { membersStore } from "../state/members.ts"
import {
  GroupInvite,
  GroupSettingsView,
  GroupTransfer,
  renameGroup,
  transferAndRefresh,
  updateGroupDetails,
} from "./GroupSettingsView.tsx"

const known = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  name: "Secret Team",
  role: GroupRole.ADMIN,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const strangerId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111999"

/** The invite dialog's body on the server, for the group `known`. */
const renderInvite = (role = GroupRole.ADMIN) =>
  renderToString(<GroupInvite groupId={known.id} actorRole={role} onClose={() => {}} />)

/** The transfer dialog's body on the server, for the group `known` held by its owner. */
const renderTransfer = () =>
  renderToString(
    <GroupTransfer
      groupId={known.id}
      group={{ ...known, role: GroupRole.OWNER }}
      onClose={() => {}}
    />,
  )

/** The view on the server: the router needs a path, because there is no `location`. */
const render = (groupId: string) =>
  renderToString(
    <Router ssrPath="/">
      <GroupSettingsView groupId={groupId} />
    </Router>,
  )

describe("GroupSettingsView", () => {
  afterEach(() => {
    groupsStore.reset()
    membersStore.reset()
    billingStore.reset()
    invitationsStore.reset()
  })

  it("says the group does not exist, and shows no other group, for an address that names a group the person is not in", () => {
    groupsStore.groups.value = [known]
    // The list has been read: until then the page cannot say which groups exist.
    groupsStore.loading.value = false

    const html = render(strangerId)

    expect(html).toContain("This group does not exist.")
    expect(html).not.toContain("Secret Team")
    expect(html).not.toContain("Admin")
  })

  it("shows the group's name and role when the address names a group in the list", () => {
    groupsStore.groups.value = [known]

    const html = render(known.id)

    expect(html).toContain("Secret Team")
    expect(html).toContain("Admin")
  })

  it("shows the error, not a loading message, when the first read failed and nothing is held", () => {
    groupsStore.loadError.value = "Could not load the groups"

    const html = render(known.id)

    expect(html).toContain("Could not load the groups")
    expect(html).not.toContain("Loading the group...")
  })

  it("shows the members the store holds for this group, and never another group's", () => {
    groupsStore.groups.value = [known]
    membersStore.members.value = [{
      userId: 2,
      name: "Vera Viewer",
      email: null,
      role: GroupRole.VIEWER,
      joinedAt: "2026-10-01T00:00:00.000Z",
      isYou: false,
    }]

    membersStore.groupId.value = strangerId
    expect(render(known.id)).not.toContain("Vera Viewer")

    membersStore.groupId.value = known.id
    expect(render(known.id)).toContain("Vera Viewer")
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

  it("offers the owner every other member of this group to transfer it to", () => {
    const vera = {
      userId: 2,
      name: "Vera Viewer",
      email: null,
      role: GroupRole.VIEWER,
      joinedAt: "2026-10-01T00:00:00.000Z",
      isYou: false,
    }
    membersStore.groupId.value = known.id
    membersStore.members.value = [{
      ...vera,
      userId: 1,
      name: "Olga Owner",
      role: GroupRole.OWNER,
      isYou: true,
    }, vera]

    membersStore.groupId.value = strangerId
    expect(renderTransfer()).not.toContain(`data-e2e="group-section-transfer"`)

    membersStore.groupId.value = known.id
    const html = renderTransfer()
    expect(html).toContain(`data-e2e="group-section-transfer"`)
    expect(html).toMatch(/<option[^>]*value="2"[^>]*>Vera Viewer<\/option>/)
    expect(html).not.toMatch(/<option[^>]*>Olga Owner<\/option>/)
  })

  it("disables Transfer ownership while the open group's subscription renews, and for no other group's", () => {
    groupsStore.groups.value = [{ ...known, role: GroupRole.OWNER }]
    membersStore.groupId.value = known.id
    membersStore.members.value = [
      {
        userId: 1,
        name: "Olga Owner",
        email: null,
        role: GroupRole.OWNER,
        joinedAt: "2026-10-01T00:00:00.000Z",
        isYou: true,
      },
      {
        userId: 2,
        name: "Vera Viewer",
        email: null,
        role: GroupRole.VIEWER,
        joinedAt: "2026-10-01T00:00:00.000Z",
        isYou: false,
      },
    ]
    const subscribed: GroupBilling = {
      enabled: true,
      planId: PRO_PLAN_ID,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canManage: true,
      subscribed: true,
      hasCustomer: true,
      trialEnd: null,
      notice: null,
      seatPrice: null,
    }
    const blocked = "group-transfer-why"

    expect(render(known.id)).toContain("group-transfer-open")
    expect(render(known.id)).not.toContain(blocked)
    billingStore.current.value = { groupId: strangerId, billing: subscribed }
    expect(render(known.id)).not.toContain(blocked)
    billingStore.current.value = { groupId: known.id, billing: subscribed }
    expect(render(known.id)).toContain(blocked)
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

describe("transferAndRefresh", () => {
  it("reads the groups again after a transfer that worked, so the new role shows", async () => {
    let reads = 0
    const moved = await transferAndRefresh(
      { transfer: () => Promise.resolve(true) },
      { refreshFromUser: () => Promise.resolve(void reads++) },
    )

    expect(moved).toBe(true)
    expect(reads).toBe(1)
  })

  it("leaves the groups alone after a refused transfer", async () => {
    let reads = 0
    const moved = await transferAndRefresh(
      { transfer: () => Promise.resolve(false) },
      { refreshFromUser: () => Promise.resolve(void reads++) },
    )

    expect(moved).toBe(false)
    expect(reads).toBe(0)
  })
})

describe("renameGroup", () => {
  const store = (renamed: boolean, failure: typeof groupsStore.actionError.value = null) => {
    const draft = { value: null as { groupId: string; name: string } | null }
    return {
      draft,
      groups: {
        renameDraft: draft,
        rename: () => Promise.resolve(renamed),
        actionError: { value: failure },
      } as unknown as Parameters<typeof renameGroup>[0],
    }
  }

  it("hands the new name to the store and resolves when the server renamed the group", async () => {
    const { draft, groups } = store(true)

    await renameGroup(groups, known.id, "Crew")

    expect(draft.value).toEqual({ groupId: known.id, name: "Crew" })
  })

  it("rejects with the server's message when it refused this group's rename", async () => {
    const { groups } = store(false, {
      groupId: known.id,
      action: "rename",
      message: "That name is too long.",
    })

    await expect(renameGroup(groups, known.id, "Crew")).rejects.toThrow("That name is too long.")
  })

  it("rejects with a general message when the refusal held is another group's", async () => {
    const { groups } = store(false, { groupId: strangerId, action: "rename", message: "Theirs." })

    await expect(renameGroup(groups, known.id, "Crew")).rejects
      .toThrow("Could not rename the group.")
  })
})

describe("updateGroupDetails", () => {
  const details = { description: "Flat", color: "green" as const, emoji: "🏠" }
  const store = (saved: boolean, failure: typeof groupsStore.actionError.value = null) => {
    const sent: unknown[] = []
    return {
      sent,
      groups: {
        updateDetails: (groupId: string, d: unknown) => {
          sent.push({ groupId, d })
          return Promise.resolve(saved)
        },
        actionError: { value: failure },
      } as unknown as Parameters<typeof updateGroupDetails>[0],
    }
  }

  it("hands the details to the store and resolves when the server saved them", async () => {
    const { sent, groups } = store(true)

    await updateGroupDetails(groups, known.id, details)

    expect(sent).toEqual([{ groupId: known.id, d: details }])
  })

  it("rejects with the server's message when it refused this group's details", async () => {
    const { groups } = store(false, {
      groupId: known.id,
      action: "details",
      message: "Not allowed.",
    })

    await expect(updateGroupDetails(groups, known.id, details)).rejects.toThrow("Not allowed.")
  })

  it("rejects with a general message when the refusal held is another group's", async () => {
    const { groups } = store(false, { groupId: strangerId, action: "details", message: "Theirs." })

    await expect(updateGroupDetails(groups, known.id, details)).rejects
      .toThrow("Could not save the details.")
  })
})
