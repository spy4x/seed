import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { Router } from "wouter-preact"
import { type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { GroupTab } from "@ui/group-editor-screen.tsx"
import { billingStore } from "../state/billing.ts"
import { groupsStore } from "../state/groups.ts"
import { invitationsStore } from "../state/invitations.ts"
import { membersStore } from "../state/members.ts"
import {
  createAndOpen,
  GroupEditorView,
  GroupTransfer,
  saveAndAnnounce,
  transferAndRefresh,
} from "./GroupEditorView.tsx"

const known = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  name: "Secret Team",
  role: GroupRole.ADMIN,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const strangerId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111999"

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
const render = (groupId: string | null, tab = GroupTab.GENERAL) =>
  renderToString(
    <Router ssrPath="/">
      <GroupEditorView groupId={groupId} tab={tab} />
    </Router>,
  )

describe("GroupEditorView", () => {
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

  it("draws the create page with empty fields and Create group for no group id", () => {
    groupsStore.groups.value = [known]

    const html = render(null)

    expect(html).toContain("New group")
    expect(html).toContain(`data-e2e="group-create"`)
    // An empty value renders as a bare `value` attribute.
    expect(html).toMatch(/<input data-e2e="group-name"[^>]* value /)
    expect(html).not.toContain("Secret Team")
  })

  it("shows what was typed for this group, and the saved group when the draft is another's", () => {
    groupsStore.groups.value = [known]
    groupsStore.edit(known.id, { name: "Crew", description: "", color: null, emoji: "" })

    expect(render(known.id)).toMatch(/<input [^>]*data-e2e="group-name"[^>]*value="Crew"/)
    expect(render(known.id)).toContain(`data-e2e="group-save"`)

    groupsStore.edit(strangerId, { name: "Crew", description: "", color: null, emoji: "" })
    expect(render(known.id)).toMatch(/<input [^>]*data-e2e="group-name"[^>]*value="Secret Team"/)
    expect(render(known.id)).not.toContain(`data-e2e="group-save"`)
  })

  it("shows the error, not a loading message, when the first read failed and nothing is held", () => {
    groupsStore.loadError.value = "Could not load the groups"

    const html = render(known.id)

    expect(html).toContain("Could not load the groups")
    expect(html).not.toContain("Loading the group…")
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
    expect(render(known.id, GroupTab.MEMBERS)).not.toContain("Vera Viewer")

    membersStore.groupId.value = known.id
    expect(render(known.id, GroupTab.MEMBERS)).toContain("Vera Viewer")
  })

  it("links Invite to the group's invitation page, and offers no invite dialog", () => {
    groupsStore.groups.value = [known]

    const html = render(known.id, GroupTab.MEMBERS)

    const invite = html.match(/<a[^>]*data-e2e="invite-open"[^>]*>/)?.[0] ?? ""
    expect(invite).toContain(`href="/groups/${known.id}/invitations/new"`)
    expect(html).not.toContain("invite-dialog")
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

describe("createAndOpen", () => {
  const created = { ...known, name: "Trip" }

  it("puts the new group's page in place of the create page, makes it current and says so", async () => {
    const visits: [string, { replace: boolean }][] = []
    const selected: string[] = []
    const notices: unknown[] = []
    const done = await createAndOpen(
      { create: () => Promise.resolve(created) },
      { select: (id: string) => Promise.resolve(void selected.push(id)) },
      (to, options) => visits.push([to, options]),
      { success: (notice) => String(notices.push(notice)) },
    )

    expect(done).toBe(true)
    expect(visits).toEqual([[`/groups/${known.id}`, { replace: true }]])
    expect(selected).toEqual([known.id])
    expect(notices).toEqual([{
      title: "Group created",
      body: `"Trip" is now your current group.`,
      dataE2E: "group-created",
    }])
  })

  it("stays on the create page and selects nothing when the create was refused", async () => {
    const visits: string[] = []
    const selected: string[] = []
    const notices: unknown[] = []
    const done = await createAndOpen(
      { create: () => Promise.resolve(null) },
      { select: (id: string) => Promise.resolve(void selected.push(id)) },
      (to) => visits.push(to),
      { success: (notice) => String(notices.push(notice)) },
    )

    expect(done).toBe(false)
    expect([visits, selected, notices]).toEqual([[], [], []])
  })
})

describe("saveAndAnnounce", () => {
  const groups = (saved: boolean) =>
    ({
      save: () => Promise.resolve(saved),
      groups: { value: [{ ...known, name: "Crew" }] },
    }) as unknown as Parameters<typeof saveAndAnnounce>[0]

  it("says the changes are saved, with the group's new name, once the save worked", async () => {
    const notices: unknown[] = []
    const done = await saveAndAnnounce(groups(true), known.id, {
      success: (notice) => String(notices.push(notice)),
    })

    expect(done).toBe(true)
    expect(notices).toEqual([{
      title: "Group saved",
      body: `"Crew" saved.`,
      dataE2E: "group-saved",
    }])
  })

  it("says nothing when the save was refused", async () => {
    const notices: unknown[] = []
    const done = await saveAndAnnounce(groups(false), known.id, {
      success: (notice) => String(notices.push(notice)),
    })

    expect(done).toBe(false)
    expect(notices).toEqual([])
  })
})
