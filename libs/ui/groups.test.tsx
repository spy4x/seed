/**
 * The group screens driven in a browser DOM (happy-dom): the groups list, a group's settings with
 * its menu and dialogs, the members, the invitations, the transfer and the invitation page. These
 * screens are drawn by the SPA only, so every test runs them with their callbacks, the way the app
 * does.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { renderToString } from "preact-render-to-string"
import { act } from "preact/test-utils"
import type { PlanRefusal } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { BILLING_PATHS, SeatPriceConfirm } from "./billing-screen.tsx"
import {
  type CreatedInvitation,
  EMPTY_INVITATION_DRAFT,
  type InvitationDraft,
  type InvitationPreviewRow,
  type InvitationRow,
  InvitationScreen,
  InviteForm,
  type InviteFormProps,
  MyInvitationsSection,
  PendingInvitations,
  type PendingInvitationsProps,
  VIEWERS_ONLY_HINT,
} from "./group-invitations.tsx"
import {
  type GroupMemberRow,
  GroupMembersSection,
  type GroupMembersSectionProps,
} from "./group-members.tsx"
import { GroupDetailsForm, groupLabel, GroupMark } from "./group-appearance.tsx"
import { GroupPicker } from "./group-picker.tsx"
import { GroupSettingsScreen, type GroupSettingsScreenProps } from "./group-settings-screen.tsx"
import {
  EMPTY_TRANSFER_DRAFT,
  GroupTransferForm,
  type GroupTransferFormProps,
  type TransferDraft,
} from "./group-transfer.tsx"
import { GroupsScreen, type GroupsScreenProps } from "./groups-screen.tsx"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { GROUP_PATHS, SCREEN_PATHS } from "./progressive.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, FormData: globalThis.FormData }

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do.
  Object.assign(globalThis, { document: window.document, FormData: window.FormData })
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

/** Renders `node` into a fresh element in the page, effects run. */
async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

/** The one element `selector` finds, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** Whether anything matches `selector`. */
function has(selector: string): boolean {
  return root?.querySelector(selector) != null
}

/** The text of every element `selector` finds, trimmed. */
function texts(selector: string): string[] {
  return [...root!.querySelectorAll(selector)].map((element) => element.textContent!.trim())
}

/** Types `value` into a field the way a person does: the value changes, then `input` fires. */
async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Picks `value` in a select, then `change` fires. */
async function choose(selector: string, value: string): Promise<void> {
  const field = find<HTMLSelectElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
  })
}

/** Presses `key` on the element `selector` finds, and lets a returned promise settle. */
async function press(selector: string, key: string): Promise<void> {
  const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  await act(async () => {
    find(selector).dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * Submits the form around `selector` from its submit button, and lets EnhancedForm's callback run.
 * Returns whether the native post was cancelled.
 */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")
  if (!form) throw new Error(`no form around ${selector}`)
  form.querySelector<HTMLButtonElement>("button[type=submit]")?.focus()
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** Clicks an element, and lets a returned promise settle. */
async function click(selector: string): Promise<void> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    find(selector).dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Clicks the button inside `scope` whose text is `text`. */
async function clickText(scope: string, text: string): Promise<void> {
  const button = [...find(scope).querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`no button "${text}" in ${scope}`)
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    button.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * What has focus: its `data-e2e`, or its tag name when it has none. A string, so a failed check
 * prints two names instead of diffing two DOM nodes, which never finishes.
 */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const team = { id: groupId, name: "Team", role: GroupRole.OWNER }

describe("GroupsScreen", () => {
  const defaults: GroupsScreenProps = {
    groups: [
      { ...team, memberCount: 3, members: [{ name: "Ann Lee" }, { name: "Bo Kim" }] },
      { id: "g-2", name: "Family", role: GroupRole.VIEWER },
    ],
    selectedId: groupId,
    name: "",
    creating: false,
    loading: false,
    error: null,
  }

  it("lists each group as one row with its role, its members and a link to its settings", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(texts("[data-e2e=group-item-name]")).toEqual(["Team", "Family"])
    expect(find(`[data-e2e=group-${groupId}]`).textContent).toContain("Owner")
    expect(find("[data-e2e=group-g-2]").textContent).toContain("Viewer")
    expect(find(`[data-e2e=group-${groupId}] [aria-label^="Members of Team"]`)).toBeTruthy()
    expect(find("[data-e2e=group-g-2] [data-e2e=group-settings]").getAttribute("href"))
      .toBe(GROUP_PATHS.settings("g-2"))
    expect(find("[data-e2e=group-g-2] [data-e2e=group-settings]").getAttribute("aria-label"))
      .toBe("Settings of Family")
  })

  it("shows an empty list as an empty state whose one action opens the new group dialog", async () => {
    await mount(<GroupsScreen {...defaults} groups={[]} />)
    expect(find("[data-e2e=group-new-empty]").textContent).toContain("New group")
    expect(has("[data-e2e=group-new-dialog]")).toBe(false)
    await click("[data-e2e=group-new-empty]")
    expect(has("[data-e2e=group-new-dialog] [data-e2e=group-name]")).toBe(true)

    await rerender(<GroupsScreen {...defaults} groups={[]} loading />)
    expect(has("[data-e2e=group-new-empty]")).toBe(false)
  })

  it("marks only the current group, with a check and in the row's name", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(root!.querySelectorAll("[data-e2e=group-current]")).toHaveLength(1)
    expect(has(`[data-e2e=group-${groupId}] [data-e2e=group-current]`)).toBe(true)
    expect(find(`[data-e2e=group-${groupId}] [data-e2e=group-open]`).getAttribute("aria-label"))
      .toBe("Open notes in Team, the current group")
    expect(find("[data-e2e=group-g-2] [data-e2e=group-open]").getAttribute("aria-label"))
      .toBe("Open notes in Family")
  })

  it("opens a group's notes when its row is pressed", async () => {
    const open = spy<[string]>()
    await mount(<GroupsScreen {...defaults} onOpen={open.fn} />)
    await click("[data-e2e=group-g-2] [data-e2e=group-open]")
    expect(open.calls).toEqual([["g-2"]])
  })

  it("keeps the new-group form closed until the header's button opens it", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=group-name]")).toBe(false)
    await click("[data-e2e=group-new]")
    expect(has("[data-e2e=group-new-dialog] [data-e2e=group-name]")).toBe(true)
  })

  it("reports the typed name and creates the group through the app's callbacks", async () => {
    const names = spy<[string]>()
    const create = spy<[]>()
    await mount(<GroupsScreen {...defaults} onNameChange={names.fn} onCreate={create.fn} />)
    await click("[data-e2e=group-new]")
    await type("[data-e2e=group-name]", "Trip")
    expect(names.calls).toEqual([["Trip"]])
    await rerender(
      <GroupsScreen {...defaults} name="Trip" onNameChange={names.fn} onCreate={create.fn} />,
    )
    expect(await submit("[data-e2e=group-create]")).toBe(true)
    expect(create.calls).toHaveLength(1)
  })

  it("closes the dialog once the create worked, and keeps it open with the error when it did not", async () => {
    await mount(<GroupsScreen {...defaults} />)
    await click("[data-e2e=group-new]")
    await rerender(<GroupsScreen {...defaults} creating />)
    await rerender(<GroupsScreen {...defaults} error="That name is taken." />)
    expect(find("[data-e2e=group-new-dialog]").textContent).toContain("That name is taken.")
    await rerender(<GroupsScreen {...defaults} creating />)
    await rerender(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=group-new-dialog]")).toBe(false)
  })

  it("moves focus to the name when the create was refused", async () => {
    await mount(<GroupsScreen {...defaults} />)
    await click("[data-e2e=group-new]")
    find("[data-e2e=group-create]").focus()
    await rerender(<GroupsScreen {...defaults} creating />)
    await rerender(<GroupsScreen {...defaults} error="That name is taken." />)
    expect(focused()).toBe("group-name")
  })

  it("has no refresh button", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=group-refresh]")).toBe(false)
  })

  it("restores a deleted group and moves focus to a refused restore's message", async () => {
    const restore = spy<[string]>()
    const deleted = [{ id: "d-1", name: "Old", deletedAt: "2026-01-01T00:00:00.000Z" }]
    await mount(<GroupsScreen {...defaults} deleted={deleted} onRestore={restore.fn} />)
    expect(texts("[data-e2e=deleted-group-name]")).toEqual(["Old"])
    expect(find("[data-e2e=deleted-group-d-1]").textContent).toContain("2026-01-31")
    await click("[data-e2e=group-restore]")
    expect(restore.calls).toEqual([["d-1"]])
    await rerender(
      <GroupsScreen
        {...defaults}
        deleted={deleted}
        restoreError="Too late."
        onRestore={restore.fn}
      />,
    )
    expect(focused()).toBe("group-restore-error")
  })

  it("leaves the deleted groups out when there are none", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=deleted-group-list]")).toBe(false)
    expect(root!.textContent).not.toContain("Deleted groups")
  })
})

const owner: GroupMemberRow = {
  userId: 1,
  name: "Olga Owner",
  email: "olga@example.com",
  role: GroupRole.OWNER,
  joinedAt: "2026-01-01T00:00:00.000Z",
  isYou: true,
}
const editor: GroupMemberRow = {
  userId: 2,
  name: "Eddie Editor",
  email: "eddie@example.com",
  role: GroupRole.EDITOR,
  joinedAt: "2026-01-02T00:00:00.000Z",
  isYou: false,
}
const viewer: GroupMemberRow = {
  userId: 3,
  name: "",
  email: "vic@example.com",
  role: GroupRole.VIEWER,
  joinedAt: "2026-01-03T00:00:00.000Z",
  isYou: false,
}

describe("GroupSettingsScreen header", () => {
  const defaults: GroupSettingsScreenProps = {
    group: team,
    selected: true,
    loading: false,
    members: [owner, editor],
    transfer: () => <p data-e2e="transfer-body">transfer</p>,
  }

  it("shows the name, the role and that it is the current group", async () => {
    await mount(<GroupSettingsScreen {...defaults} />)
    expect(find("[data-e2e=group-general-name]").textContent).toBe("Team")
    expect(find("[data-e2e=group-general-role]").textContent).toBe("Owner")
    expect(has("[data-e2e=group-current]")).toBe(true)
    await rerender(<GroupSettingsScreen {...defaults} selected={false} />)
    expect(has("[data-e2e=group-current]")).toBe(false)
  })

  it("opens the group's notes from the header", async () => {
    const open = spy<[string]>()
    await mount(<GroupSettingsScreen {...defaults} onOpen={open.fn} />)
    await click("[data-e2e=group-open]")
    expect(open.calls).toEqual([[groupId]])
  })

  it("lets an admin rename the group in place", async () => {
    const names: string[] = []
    const rename = (name: string) => {
      names.push(name)
      return Promise.resolve()
    }
    await mount(
      <GroupSettingsScreen
        {...defaults}
        group={{ ...team, role: GroupRole.ADMIN }}
        onRename={rename}
      />,
    )
    await click('button[aria-label="Rename Team"]')
    await type('input[aria-label="New name"]', "Crew")
    await press('input[aria-label="New name"]', "Enter")
    expect(names).toEqual(["Crew"])
  })

  it("keeps the name's field open with the message of a refused rename", async () => {
    const rename = () => Promise.reject(new Error("That name is too long."))
    await mount(<GroupSettingsScreen {...defaults} onRename={rename} />)
    await click('button[aria-label="Rename Team"]')
    await type('input[aria-label="New name"]', "Crew")
    await press('input[aria-label="New name"]', "Enter")
    expect(has('input[aria-label="New name"]')).toBe(true)
    expect(find("[data-e2e=group-general-name]").textContent).toContain("That name is too long.")
  })

  it("shows a viewer or an editor the name with no way to rename it", async () => {
    const rename = () => Promise.resolve()
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR]) {
      await mount(<GroupSettingsScreen {...defaults} group={{ ...team, role }} onRename={rename} />)
      expect(has('button[aria-label="Rename Team"]')).toBe(false)
      expect(find("[data-e2e=group-general-name]").textContent).toBe("Team")
      await act(() => render(null, root!))
    }
  })

  it("gives the owner Transfer ownership and Delete group in the menu, and no Leave", async () => {
    await mount(<GroupSettingsScreen {...defaults} />)
    expect(has("[data-e2e=group-transfer-open]")).toBe(true)
    expect(has("[data-e2e=group-delete-open]")).toBe(true)
    expect(has("[data-e2e=group-leave-open]")).toBe(false)
  })

  it("gives any other member Leave group in the menu, and neither Transfer nor Delete", async () => {
    await mount(<GroupSettingsScreen {...defaults} group={{ ...team, role: GroupRole.ADMIN }} />)
    expect(has("[data-e2e=group-leave-open]")).toBe(true)
    expect(has("[data-e2e=group-transfer-open]")).toBe(false)
    expect(has("[data-e2e=group-delete-open]")).toBe(false)
  })

  it("leaves Transfer ownership out while nobody else is in the group", async () => {
    await mount(<GroupSettingsScreen {...defaults} members={[owner]} />)
    expect(has("[data-e2e=group-transfer-open]")).toBe(false)
  })

  it("disables Delete group with the reason when it is the person's only group or still has a subscription", async () => {
    await mount(<GroupSettingsScreen {...defaults} isLastGroup />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-delete-why]").textContent).toBe("It is your only group")
    await rerender(<GroupSettingsScreen {...defaults} hasSubscription />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-delete-why]").textContent).toBe("Cancel its subscription first")
    await rerender(<GroupSettingsScreen {...defaults} />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(false)
    expect(has("[data-e2e=group-delete-why]")).toBe(false)
  })

  it("disables Leave group with the reason on the person's only group", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    await mount(<GroupSettingsScreen {...admin} isLastGroup />)
    expect(find<HTMLButtonElement>("[data-e2e=group-leave-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-leave-why]").textContent).toBe("It is your only group")
  })

  it("disables Transfer ownership with the reason while the group has a subscription", async () => {
    await mount(<GroupSettingsScreen {...defaults} hasSubscription />)
    expect(find<HTMLButtonElement>("[data-e2e=group-transfer-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-transfer-why]").textContent).toBe("Cancel its subscription first")
    await rerender(<GroupSettingsScreen {...defaults} />)
    expect(find<HTMLButtonElement>("[data-e2e=group-transfer-open]").disabled).toBe(false)
    expect(has("[data-e2e=group-transfer-why]")).toBe(false)
  })

  it("asks before deleting, deletes on confirm, and keeps the dialog open with a refused delete's message focused", async () => {
    const remove = spy<[]>()
    await mount(<GroupSettingsScreen {...defaults} onDelete={remove.fn} />)
    await click("[data-e2e=group-delete-open]")
    expect(remove.calls).toHaveLength(0)
    expect(find("[data-e2e=group-delete-confirmation]").textContent).toContain("30")
    await clickText("[data-e2e=group-delete-dialog]", "Delete group")
    expect(remove.calls).toHaveLength(1)
    await rerender(<GroupSettingsScreen {...defaults} onDelete={remove.fn} deleting />)
    await rerender(
      <GroupSettingsScreen {...defaults} onDelete={remove.fn} deleteError="It has a plan." />,
    )
    expect(find("[data-e2e=group-delete-dialog]").textContent).toContain("It has a plan.")
    expect(focused()).toBe("group-delete-error")
  })

  describe("move all data", () => {
    const targets = [{ id: "g2", name: "Archive" }, { id: "g3", name: "Home" }]
    const mover = { ...defaults, moveTargets: targets }

    it("offers the move to an editor with a group to move to, and to no one else", async () => {
      const move = spy<[string]>()
      const screen = (props: Partial<GroupSettingsScreenProps>) => (
        <GroupSettingsScreen {...mover} onMoveAll={move.fn} {...props} />
      )
      await mount(screen({ group: { ...team, role: GroupRole.EDITOR } }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(true)
      await rerender(screen({ group: { ...team, role: GroupRole.VIEWER } }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
      await rerender(screen({ moveTargets: [] }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
      await rerender(<GroupSettingsScreen {...mover} />)
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
    })

    it("moves to the group the person picks, and closes without moving on Cancel", async () => {
      const move = spy<[string]>()
      await mount(<GroupSettingsScreen {...mover} onMoveAll={move.fn} />)
      await click("[data-e2e=group-move-all-open]")
      expect(texts("[data-e2e=group-move-all-to] option")).toEqual(["Archive", "Home"])
      await clickText("[data-e2e=group-move-all-dialog]", "Cancel")
      expect(has("[data-e2e=group-move-all-dialog]")).toBe(false)
      expect(move.calls).toHaveLength(0)

      await click("[data-e2e=group-move-all-open]")
      await choose("[data-e2e=group-move-all-to]", "g3")
      await submit("[data-e2e=group-move-all-dialog] form")
      expect(move.calls).toEqual([["g3"]])
    })

    it("refuses a second submit while the move runs and shows a refusal in the dialog", async () => {
      const move = spy<[string]>()
      const screen = (props: Partial<GroupSettingsScreenProps>) => (
        <GroupSettingsScreen {...mover} onMoveAll={move.fn} {...props} />
      )
      await mount(screen({}))
      await click("[data-e2e=group-move-all-open]")
      await rerender(screen({ movingAll: true }))
      await submit("[data-e2e=group-move-all-dialog] form")
      expect(move.calls).toHaveLength(0)
      await rerender(screen({ moveAllError: "Free groups hold 10 notes." }))
      expect(find("[data-e2e=group-move-all-dialog]").textContent).toContain(
        "Free groups hold 10 notes.",
      )
      expect(focused()).toBe("group-move-all-error")
    })

    it("shows the target's plan notice, with whose limit it is, and moves focus to it", async () => {
      const screen = (props: Partial<GroupSettingsScreenProps>) => (
        <GroupSettingsScreen {...mover} onMoveAll={() => {}} {...props} />
      )
      await mount(screen({}))
      await click("[data-e2e=group-move-all-open]")
      await submit("[data-e2e=group-move-all-dialog] form")
      await rerender(screen({
        moveAllError: "Free groups hold 10 notes.",
        moveAllRefusal: {
          code: "PLAN_LIMIT_REACHED",
          entitlement: "maxNotes",
          limit: 10,
          canUpgrade: true,
        },
      }))
      const dialog = find("[data-e2e=group-move-all-dialog]")
      expect(find("[data-e2e=plan-refusal]").textContent).toContain(
        "Archive has reached its note limit",
      )
      expect(dialog.textContent).not.toContain("not this one's")
      expect(find("[data-e2e=plan-refusal] a").getAttribute("href")).toContain("g2")
      expect(has("[data-e2e=group-move-all-error]")).toBe(false)
      expect(focused()).toBe("plan-refusal")
    })

    it("hides a refusal once another target is picked, and tells the app", async () => {
      const changed = spy<[]>()
      const refusal = {
        code: "PLAN_LIMIT_REACHED",
        entitlement: "maxNotes",
        limit: 10,
        canUpgrade: true,
      } as const
      const screen = (props: Partial<GroupSettingsScreenProps>) => (
        <GroupSettingsScreen
          {...mover}
          onMoveAll={() => {}}
          onMoveAllTargetChange={changed.fn}
          {...props}
        />
      )
      await mount(screen({}))
      await click("[data-e2e=group-move-all-open]")
      await submit("[data-e2e=group-move-all-dialog] form")
      await rerender(
        screen({ moveAllError: "Free groups hold 10 notes.", moveAllRefusal: refusal }),
      )
      expect(changed.calls).toHaveLength(0)

      await choose("[data-e2e=group-move-all-to]", "g3")
      expect(changed.calls).toHaveLength(1)
      // The refusal is still passed in, but it was Archive's: no notice names or links Home.
      expect(has("[data-e2e=plan-refusal]")).toBe(false)
      expect(find("[data-e2e=group-move-all-dialog]").textContent).not.toContain("Home has reached")
      await choose("[data-e2e=group-move-all-to]", "g2")
      expect(find("[data-e2e=plan-refusal]").textContent).toContain("Archive has reached")
      expect(find("[data-e2e=plan-refusal] a").getAttribute("href")).toContain("g2")
      await choose("[data-e2e=group-move-all-to]", "g3")
      // The app answers the callback by clearing the refusal.
      await rerender(screen({}))
      expect(has("[data-e2e=plan-refusal]")).toBe(false)
    })

    it("says how many notes moved and offers to delete the group or keep it", async () => {
      const closed = spy<[]>()
      const remove = spy<[]>()
      const screen = (props: Partial<GroupSettingsScreenProps>) => (
        <GroupSettingsScreen
          {...mover}
          onMoveAll={() => {}}
          onDelete={remove.fn}
          onMoveAllClose={closed.fn}
          {...props}
        />
      )
      await mount(screen({}))
      await click("[data-e2e=group-move-all-open]")
      await rerender(screen({ moveAllResult: { count: 3, toName: "Archive" } }))
      expect(find("[data-e2e=group-move-all-done]").textContent).toContain(
        `Moved 3 notes from "Team" to "Archive"`,
      )
      expect(focused()).toBe("group-move-all-keep")

      await click("[data-e2e=group-move-all-delete]")
      expect(closed.calls).toHaveLength(1)
      expect(has("[data-e2e=group-move-all-dialog]")).toBe(false)
      expect(find("[data-e2e=group-delete-dialog]").textContent).toContain(`Delete "Team"?`)
      expect(remove.calls).toHaveLength(0)
    })

    it("offers no delete after the move when the group cannot be deleted, and keeping the group closes", async () => {
      const closed = spy<[]>()
      const result = { count: 1, toName: "Archive" }
      await mount(
        <GroupSettingsScreen
          {...mover}
          onMoveAll={() => {}}
          onMoveAllClose={closed.fn}
          hasSubscription
        />,
      )
      await click("[data-e2e=group-move-all-open]")
      await rerender(
        <GroupSettingsScreen
          {...mover}
          onMoveAll={() => {}}
          onMoveAllClose={closed.fn}
          hasSubscription
          moveAllResult={result}
        />,
      )
      expect(has("[data-e2e=group-move-all-delete]")).toBe(false)
      expect(find("[data-e2e=group-move-all-done]").textContent).toContain("Moved 1 note ")
      await click("[data-e2e=group-move-all-keep]")
      expect(closed.calls).toHaveLength(1)
      expect(has("[data-e2e=group-move-all-dialog]")).toBe(false)
    })
  })

  it("closes the delete dialog on Cancel without deleting", async () => {
    const remove = spy<[]>()
    await mount(<GroupSettingsScreen {...defaults} onDelete={remove.fn} />)
    await click("[data-e2e=group-delete-open]")
    await clickText("[data-e2e=group-delete-dialog]", "Cancel")
    expect(has("[data-e2e=group-delete-dialog]")).toBe(false)
    expect(remove.calls).toHaveLength(0)
  })

  it("opens the delete dialog again without the message of an earlier refused delete", async () => {
    const screen = (props: Partial<GroupSettingsScreenProps>) => (
      <GroupSettingsScreen {...defaults} {...props} />
    )
    await mount(screen({}))
    await click("[data-e2e=group-delete-open]")
    await rerender(screen({ deleting: true }))
    await rerender(screen({ deleteError: "It has a plan." }))
    await clickText("[data-e2e=group-delete-dialog]", "Cancel")

    await click("[data-e2e=group-delete-open]")
    expect(has("[data-e2e=group-delete-error]")).toBe(false)
    await rerender(screen({ deleting: true, deleteError: "It has a plan." }))
    await rerender(screen({ deleteError: "It has a plan." }))
    expect(find("[data-e2e=group-delete-error]").textContent).toContain("It has a plan.")
  })

  it("asks before leaving and leaves on confirm", async () => {
    const leave = spy<[]>()
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    await mount(<GroupSettingsScreen {...admin} onLeave={leave.fn} />)
    await click("[data-e2e=group-leave-open]")
    expect(leave.calls).toHaveLength(0)
    await clickText("[data-e2e=group-leave-dialog]", "Leave group")
    expect(leave.calls).toHaveLength(1)
    await rerender(<GroupSettingsScreen {...admin} onLeave={leave.fn} leaving />)
    await rerender(<GroupSettingsScreen {...admin} onLeave={leave.fn} leaveError="No." />)
    expect(focused()).toBe("group-leave-error")
  })

  it("closes the leave dialog once the leave worked", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    await mount(<GroupSettingsScreen {...admin} />)
    await click("[data-e2e=group-leave-open]")
    await rerender(<GroupSettingsScreen {...admin} leaving />)
    expect(has("[data-e2e=group-leave-dialog]")).toBe(true)
    await rerender(<GroupSettingsScreen {...admin} />)
    expect(has("[data-e2e=group-leave-dialog]")).toBe(false)
  })

  it("opens the leave dialog again without the message of an earlier refused leave", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    const screen = (props: Partial<GroupSettingsScreenProps>) => (
      <GroupSettingsScreen {...admin} {...props} />
    )
    await mount(screen({}))
    await click("[data-e2e=group-leave-open]")
    await rerender(screen({ leaving: true }))
    await rerender(screen({ leaveError: "No." }))
    await clickText("[data-e2e=group-leave-dialog]", "Cancel")

    await click("[data-e2e=group-leave-open]")
    expect(has("[data-e2e=group-leave-error]")).toBe(false)
    await rerender(screen({ leaving: true, leaveError: "No." }))
    await rerender(screen({ leaveError: "No." }))
    expect(find("[data-e2e=group-leave-error]").textContent).toContain("No.")
  })

  it("draws the transfer form in a dialog that the form can close", async () => {
    let close: (() => void) | null = null
    await mount(
      <GroupSettingsScreen
        {...defaults}
        transfer={(done) => {
          close = done
          return <p data-e2e="transfer-body">transfer</p>
        }}
      />,
    )
    expect(has("[data-e2e=transfer-body]")).toBe(false)
    await click("[data-e2e=group-transfer-open]")
    expect(has("[data-e2e=group-transfer-dialog] [data-e2e=transfer-body]")).toBe(true)
    await act(() => close!())
    expect(has("[data-e2e=group-transfer-dialog]")).toBe(false)
  })

  it("drops the transfer's typed password when its dialog is closed", async () => {
    const drafts = spy<[TransferDraft]>()
    const draft = { userId: 2, name: "", password: "secret" }
    await mount(
      <GroupSettingsScreen
        {...defaults}
        transfer={(done) => (
          <GroupTransferForm
            groupName="Team"
            role={GroupRole.OWNER}
            members={[owner, editor]}
            draft={draft}
            onDraftChange={drafts.fn}
            onCancel={done}
          />
        )}
      />,
    )
    await click("[data-e2e=group-transfer-open]")
    await click("[data-e2e=group-transfer-dialog] button[aria-label=Close]")
    expect(has("[data-e2e=group-transfer-dialog]")).toBe(false)
    expect(drafts.calls).toEqual([[{ ...draft, password: "" }]])
  })

  it("moves focus to the More actions menu once a transfer went through and took the dialog away", async () => {
    const screen = (role: GroupRole) => (
      <GroupSettingsScreen
        {...defaults}
        group={{ ...team, role }}
        transfer={() => <button type="button" data-e2e="transfer-body">transfer</button>}
      />
    )
    await mount(screen(GroupRole.OWNER))
    await click("[data-e2e=group-transfer-open]")
    find("[data-e2e=transfer-body]").focus()
    await rerender(screen(GroupRole.ADMIN))
    expect(has("[data-e2e=group-transfer-dialog]")).toBe(false)
    expect(focused()).toBe("group-menu")
  })

  it("offers Invite people to the owner and admins only, in a dialog the form can close", async () => {
    let close: (() => void) | null = null
    const invite = (done: () => void) => {
      close = done
      return <p data-e2e="invite-body">invite</p>
    }
    await mount(
      <GroupSettingsScreen
        {...defaults}
        group={{ ...team, role: GroupRole.EDITOR }}
        invite={invite}
      />,
    )
    expect(has("[data-e2e=invite-open]")).toBe(false)
    await rerender(<GroupSettingsScreen {...defaults} invite={invite} />)
    await click("[data-e2e=invite-open]")
    expect(has("[data-e2e=invite-dialog] [data-e2e=invite-body]")).toBe(true)
    await act(() => close!())
    expect(has("[data-e2e=invite-dialog]")).toBe(false)
  })

  it("says a missing group may be deleted, with the way back to the groups", async () => {
    await mount(<GroupSettingsScreen {...defaults} group={null} />)
    expect(root!.textContent).toContain("This group does not exist.")
    expect(find("[data-e2e=page-back]").getAttribute("href")).toBe(SCREEN_PATHS.groups)
  })
})

describe("GroupMembersSection", () => {
  const props = { groupId, actorRole: GroupRole.OWNER, members: [owner, editor, viewer] }

  it("lists every member with the role, and the address under a name", async () => {
    await mount(<GroupMembersSection {...props} />)
    expect(texts("[data-e2e=group-member-name]")).toEqual([
      "Olga Owner",
      "Eddie Editor",
      "vic@example.com",
    ])
    expect(texts("[data-e2e=group-member-role]")).toEqual(["Owner", "Editor", "Viewer"])
    expect(find('[data-user-id="2"]').textContent).toContain("eddie@example.com")
    expect(find('[data-user-id="1"]').textContent).toContain("you")
  })

  it("counts every member in the heading and says when the list is cut off", async () => {
    await mount(<GroupMembersSection {...props} memberCount={1200} />)
    expect(find("#group-members").textContent).toBe("Members (1200)")
    expect(find("[data-e2e=group-members-cut-off]").textContent)
      .toBe("Showing the first 3 of 1200 members.")
  })

  it("gives the owner a menu on each other member's row to change the role", async () => {
    const roles = spy<[number, GroupRole]>()
    await mount(<GroupMembersSection {...props} onRoleChange={roles.fn} />)
    expect(has('[data-user-id="1"] [data-e2e=group-member-menu]')).toBe(false)
    expect(texts('[data-user-id="2"] [data-e2e=group-member-make]')).toEqual([
      "Make Viewer",
      "Make Admin",
    ])
    await click('[data-user-id="2"] [data-e2e=group-member-make]')
    expect(roles.calls).toEqual([[2, GroupRole.VIEWER]])
  })

  it("gives a viewer no menu on any row", async () => {
    await mount(<GroupMembersSection {...props} actorRole={GroupRole.VIEWER} />)
    expect(has("[data-e2e=group-member-menu]")).toBe(false)
  })

  it("asks before removing a member and removes on confirm", async () => {
    const remove = spy<[number]>()
    await mount(<GroupMembersSection {...props} onRemove={remove.fn} />)
    await click('[data-user-id="3"] [data-e2e=group-member-remove-open]')
    expect(remove.calls).toHaveLength(0)
    expect(find("[data-e2e=group-member-remove-dialog]").textContent)
      .toContain("Remove vic@example.com?")
    await clickText("[data-e2e=group-member-remove-dialog]", "Remove member")
    expect(remove.calls).toEqual([[3]])
  })

  it("shows a refused removal's message in its dialog, and not again when the dialog reopens", async () => {
    const section = (over: Partial<GroupMembersSectionProps>) => (
      <GroupMembersSection {...props} {...over} />
    )
    await mount(section({}))
    await click('[data-user-id="3"] [data-e2e=group-member-remove-open]')
    await rerender(section({ pendingUserId: 3 }))
    await rerender(section({ memberError: { userId: 3, message: "Not allowed." } }))
    expect(
      find("[data-e2e=group-member-remove-dialog] [data-e2e=group-member-remove-error]")
        .textContent,
    ).toContain("Not allowed.")
    expect(focused()).toBe("group-member-remove-error")

    await clickText("[data-e2e=group-member-remove-dialog]", "Cancel")
    await click('[data-user-id="3"] [data-e2e=group-member-remove-open]')
    expect(has("[data-e2e=group-member-remove-error]")).toBe(false)
  })

  it("shows when a member was last seen, and nothing for a row without the field", async () => {
    const seen: GroupMemberRow = {
      ...editor,
      lastSeenAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    }
    await mount(<GroupMembersSection {...props} members={[owner, seen]} />)
    expect(find('[data-user-id="2"] [data-e2e=group-member-last-seen]').textContent)
      .toBe("Last seen 3 hours ago")
    expect(has('[data-user-id="1"] [data-e2e=group-member-last-seen]')).toBe(false)
  })

  it("moves focus to the next row's menu once a member is removed, else to the section's button", async () => {
    const kim: GroupMemberRow = { ...viewer, userId: 4, email: "kim@example.com" }
    const invite = <button type="button" data-e2e="invite-open">Invite people</button>
    const section = (over: Partial<GroupMembersSectionProps>) => (
      <GroupMembersSection
        {...props}
        members={[owner, editor, viewer, kim]}
        action={invite}
        {...over}
      />
    )
    await mount(section({}))
    await rerender(section({ pendingUserId: 3 }))
    await rerender(section({ members: [owner, editor, kim] }))
    expect(focused()).toBe("group-member-menu")
    expect(document.activeElement?.closest("li")?.getAttribute("data-user-id")).toBe("4")

    // The last row has no next one: focus skips the earlier rows for the section's button.
    await rerender(section({ members: [owner, editor, kim], pendingUserId: 4 }))
    await rerender(section({ members: [owner, editor] }))
    expect(focused()).toBe("invite-open")
  })

  it("leaves focus alone when a member whose role changed earlier leaves later", async () => {
    const page = (over: Partial<GroupMembersSectionProps>) => (
      <div>
        <GroupMembersSection {...props} {...over} />
        <input data-e2e="elsewhere" />
      </div>
    )
    await mount(page({}))
    await rerender(page({ pendingUserId: 3 }))
    await rerender(page({}))
    find<HTMLInputElement>("[data-e2e=elsewhere]").focus()
    await rerender(page({ members: [owner, editor] }))
    expect(focused()).toBe("elsewhere")
  })

  it("moves focus to a refused change's message under the member's row", async () => {
    await mount(<GroupMembersSection {...props} />)
    await rerender(
      <GroupMembersSection {...props} memberError={{ userId: 2, message: "Not allowed." }} />,
    )
    expect(find('[data-user-id="2"] [data-e2e=group-member-error]').textContent)
      .toContain("Not allowed.")
    expect(focused()).toBe("group-member-error")
  })

  it("draws no error box under a row while nothing was refused", async () => {
    await mount(<GroupMembersSection {...props} />)
    expect(has("[data-e2e=group-member-error]")).toBe(false)
  })

  it("shows a plan's refusal under the member's row in place of the message", async () => {
    const plan: PlanRefusal = {
      code: "PLAN_FEATURE_MISSING",
      entitlement: "memberRoles",
      limit: null,
      canUpgrade: true,
    }
    await mount(
      <GroupMembersSection {...props} memberError={{ userId: 2, message: "Upgrade.", plan }} />,
    )
    expect(has('[data-user-id="2"] [data-e2e=plan-refusal]')).toBe(true)
    expect(has('[data-user-id="2"] [data-e2e=group-member-error]')).toBe(false)
  })
})

describe("PlanRefusalNotice", () => {
  const refusal: PlanRefusal = {
    code: "PLAN_LIMIT_REACHED",
    entitlement: "maxMembers",
    limit: 3,
    canUpgrade: true,
  }

  it("gives the owner a See plans link to the group's pricing", async () => {
    await mount(<PlanRefusalNotice groupId={groupId} refusal={refusal} />)
    const link = find<HTMLAnchorElement>("[data-e2e=plan-refusal] a")
    expect(link.textContent).toBe("See plans")
    expect(link.getAttribute("href")).toBe(BILLING_PATHS.pricing(groupId))
    expect(focused()).toBe("plan-refusal")
  })

  it("tells anyone else to ask the owner, with no link", async () => {
    await mount(<PlanRefusalNotice groupId={groupId} refusal={{ ...refusal, canUpgrade: false }} />)
    expect(has("[data-e2e=plan-refusal] a")).toBe(false)
    expect(find("[data-e2e=plan-refusal-ask-owner]").textContent)
      .toContain("Ask the group's owner to upgrade the plan.")
  })
})

describe("InviteForm", () => {
  const defaults: InviteFormProps = {
    groupId,
    actorRole: GroupRole.ADMIN,
    draft: EMPTY_INVITATION_DRAFT,
  }
  const created: CreatedInvitation = {
    link: "http://app.localhost/invite/abc",
    mailAsked: false,
    mailSent: false,
  }

  it("offers roles up to the person's own", async () => {
    await mount(<InviteForm {...defaults} />)
    expect(texts("[data-e2e=invitation-role] option")).toEqual(["Viewer", "Editor"])
  })

  it("offers viewers only on a plan without member roles, and says why", async () => {
    const drafts = spy<[InvitationDraft]>()
    await mount(<InviteForm {...defaults} memberRoles={false} onDraftChange={drafts.fn} />)
    expect(texts("[data-e2e=invitation-role] option")).toEqual(["Viewer"])
    expect(root!.textContent).toContain(VIEWERS_ONLY_HINT)
    expect(drafts.calls).toEqual([[{ ...EMPTY_INVITATION_DRAFT, role: GroupRole.VIEWER }]])
  })

  it("reports what the person fills in and creates through the app's callback", async () => {
    const drafts = spy<[InvitationDraft]>()
    const create = spy<[]>()
    await mount(<InviteForm {...defaults} onDraftChange={drafts.fn} onCreate={create.fn} />)
    await choose("[data-e2e=invitation-role]", String(GroupRole.VIEWER))
    await type("[data-e2e=invitation-uses]", "2")
    await type("[data-e2e=invitation-days]", "3")
    await type("[data-e2e=invitation-email]", "kim@example.com")
    expect(drafts.calls.map(([draft]) => draft)).toEqual([
      { ...EMPTY_INVITATION_DRAFT, role: GroupRole.VIEWER },
      { ...EMPTY_INVITATION_DRAFT, maxUses: 2 },
      { ...EMPTY_INVITATION_DRAFT, expiresInDays: 3 },
      { ...EMPTY_INVITATION_DRAFT, email: "kim@example.com" },
    ])
    expect(await submit("[data-e2e=invitation-create]")).toBe(true)
    expect(create.calls).toHaveLength(1)
  })

  it("offers to mail the link only once an address is typed", async () => {
    await mount(<InviteForm {...defaults} />)
    expect(has("[data-e2e=invitation-send-email]")).toBe(false)
    await rerender(
      <InviteForm {...defaults} draft={{ ...EMPTY_INVITATION_DRAFT, email: "a@b.c" }} />,
    )
    expect(has("[data-e2e=invitation-send-email]")).toBe(true)
  })

  it("drops the tick to mail the link when the address is cleared", async () => {
    const drafts = spy<[InvitationDraft]>()
    const draft = { ...EMPTY_INVITATION_DRAFT, email: "a@b.c", sendEmail: true }
    await mount(<InviteForm {...defaults} draft={draft} onDraftChange={drafts.fn} />)
    await type("[data-e2e=invitation-email]", "")
    expect(drafts.calls).toEqual([[{ ...draft, email: "", sendEmail: false }]])
  })

  it("moves focus to the address on a refused create, and shows a plan's refusal in its place", async () => {
    await mount(<InviteForm {...defaults} />)
    await rerender(<InviteForm {...defaults} createError="Not a valid address." />)
    expect(focused()).toBe("invitation-email")
    const plan: PlanRefusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxMembers",
      limit: 3,
      canUpgrade: false,
    }
    await rerender(<InviteForm {...defaults} createError="Full." createRefusal={plan} />)
    expect(has("[data-e2e=plan-refusal]")).toBe(true)
    expect(root!.textContent).not.toContain("Full.")
  })

  it("shows the link created while it is open, focused, and closes on Done", async () => {
    const close = spy<[]>()
    await mount(<InviteForm {...defaults} onClose={close.fn} />)
    await rerender(<InviteForm {...defaults} onClose={close.fn} created={created} />)
    expect(has("[data-e2e=invitation-form]")).toBe(false)
    expect(find("[data-e2e=invitation-created] code").textContent).toBe(created.link)
    expect(focused()).toBe("invitation-created")
    await click("[data-e2e=invitation-done]")
    expect(close.calls).toHaveLength(1)
  })

  it("never shows again a link that was created before it opened", async () => {
    await mount(<InviteForm {...defaults} created={created} />)
    expect(has("[data-e2e=invitation-created]")).toBe(false)
    expect(has("[data-e2e=invitation-form]")).toBe(true)
  })
})

describe("PendingInvitations", () => {
  const rows: InvitationRow[] = [
    {
      id: "i-1",
      role: GroupRole.EDITOR,
      email: null,
      maxUses: 2,
      uses: 1,
      expiresAt: "2026-02-01T00:00:00.000Z",
      createdBy: { name: "Olga Owner" },
    },
    {
      id: "i-2",
      role: GroupRole.ADMIN,
      email: "kim@example.com",
      maxUses: 1,
      uses: 0,
      expiresAt: "2026-02-02T00:00:00.000Z",
      createdBy: { name: "" },
    },
  ]

  it("lists each pending invitation with its role, uses and expiry", async () => {
    await mount(<PendingInvitations actorRole={GroupRole.OWNER} invitations={rows} />)
    expect(texts("[data-e2e=invitation-who]")).toEqual(["Anyone with the link", "kim@example.com"])
    expect(texts("[data-e2e=invitation-role-text]")).toEqual(["Editor", "Admin"])
    expect(find('[data-invitation-id="i-1"]').textContent).toContain("used 1 of 2")
    expect(find('[data-invitation-id="i-1"]').textContent).toContain("2026-02-01")
  })

  it("draws nothing while there are none, or for a member who may not invite", async () => {
    await mount(<PendingInvitations actorRole={GroupRole.OWNER} invitations={[]} />)
    expect(root!.textContent).toBe("")
    expect(has("[data-e2e=group-section-invitations]")).toBe(false)
    await rerender(<PendingInvitations actorRole={GroupRole.EDITOR} invitations={rows} />)
    expect(root!.innerHTML).toBe("")
  })

  it("asks before revoking and revokes on confirm", async () => {
    const revoke = spy<[string]>()
    await mount(
      <PendingInvitations actorRole={GroupRole.OWNER} invitations={rows} onRevoke={revoke.fn} />,
    )
    await click('[data-invitation-id="i-1"] [data-e2e=invitation-revoke-open]')
    expect(revoke.calls).toHaveLength(0)
    await clickText("[data-e2e=invitation-revoke-dialog]", "Revoke")
    expect(revoke.calls).toEqual([["i-1"]])
  })

  it("shows a refused revoke's message in its dialog, and not again when the dialog reopens", async () => {
    const list = (props: Partial<PendingInvitationsProps>) => (
      <PendingInvitations actorRole={GroupRole.OWNER} invitations={rows} {...props} />
    )
    await mount(list({}))
    await click('[data-invitation-id="i-1"] [data-e2e=invitation-revoke-open]')
    await rerender(list({ revokingId: "i-1" }))
    await rerender(list({ revokeError: { invitationId: "i-1", message: "Already used." } }))
    expect(find("[data-e2e=invitation-revoke-dialog] [data-e2e=invitation-error]").textContent)
      .toContain("Already used.")
    expect(focused()).toBe("invitation-error")

    await clickText("[data-e2e=invitation-revoke-dialog]", "Cancel")
    await click('[data-invitation-id="i-1"] [data-e2e=invitation-revoke-open]')
    expect(has("[data-e2e=invitation-error]")).toBe(false)
  })

  it("moves focus to the next invitation's menu once one is revoked, else to the button of the section around it", async () => {
    const page = (props: Partial<PendingInvitationsProps>) => (
      <section>
        <button type="button" data-e2e="invite-open">Invite people</button>
        <PendingInvitations actorRole={GroupRole.OWNER} invitations={rows} {...props} />
      </section>
    )
    await mount(page({}))
    await rerender(page({ revokingId: "i-1" }))
    await rerender(page({ invitations: [rows[1]] }))
    expect(focused()).toBe("invitation-menu")
    expect(document.activeElement?.closest("li")?.getAttribute("data-invitation-id")).toBe("i-2")

    await rerender(page({ invitations: [rows[1]], revokingId: "i-2" }))
    await rerender(page({ invitations: [] }))
    expect(focused()).toBe("invite-open")
  })

  it("skips the invitations before a revoked last one and moves focus to the section's button", async () => {
    const page = (props: Partial<PendingInvitationsProps>) => (
      <section>
        <button type="button" data-e2e="invite-open">Invite people</button>
        <PendingInvitations actorRole={GroupRole.OWNER} invitations={rows} {...props} />
      </section>
    )
    await mount(page({}))
    await rerender(page({ revokingId: "i-2" }))
    await rerender(page({ invitations: [rows[0]] }))
    expect(focused()).toBe("invite-open")
  })

  it("gives no revoke for an invitation with a role above the person's", async () => {
    await mount(<PendingInvitations actorRole={GroupRole.ADMIN} invitations={rows} />)
    expect(has('[data-invitation-id="i-1"] [data-e2e=invitation-menu]')).toBe(true)
    expect(has('[data-invitation-id="i-2"] [data-e2e=invitation-menu]')).toBe(false)
  })
})

describe("SeatPriceConfirm", () => {
  const seatPrice = { seats: 2, amount: 900, currency: "EUR" }

  it("hands the price tick to the app", async () => {
    const ticks = spy<[boolean]>()
    await mount(<SeatPriceConfirm seatPrice={seatPrice} checked={false} onChange={ticks.fn} />)
    await click("[data-e2e=seat-price-accept]")
    expect(ticks.calls).toEqual([[true]])
  })

  it("moves focus to the price box when a create is refused for the price", async () => {
    await mount(<SeatPriceConfirm seatPrice={seatPrice} checked={false} />)
    expect(focused()).not.toBe("seat-price-accept")
    await rerender(
      <SeatPriceConfirm seatPrice={seatPrice} checked={false} error="Confirm the price" />,
    )
    expect(focused()).toBe("seat-price-accept")
    expect(find("[data-e2e=seat-price-accept]").getAttribute("aria-describedby"))
      .toContain("invitation-seat-price-error")
  })
})

describe("GroupTransferForm", () => {
  const defaults: GroupTransferFormProps = {
    groupName: "Team",
    role: GroupRole.OWNER,
    members: [owner, editor, viewer],
    draft: EMPTY_TRANSFER_DRAFT,
  }

  it("offers every member but the owner and picks the first one", async () => {
    const drafts = spy<[TransferDraft]>()
    await mount(<GroupTransferForm {...defaults} onDraftChange={drafts.fn} />)
    expect(texts("[data-e2e=group-transfer-member] option")).toEqual([
      "Eddie Editor",
      "vic@example.com",
    ])
    expect(drafts.calls).toEqual([[{ ...EMPTY_TRANSFER_DRAFT, userId: 2 }]])
  })

  it("reports what the owner fills in and transfers through the app's callback", async () => {
    const drafts = spy<[TransferDraft]>()
    const transfer = spy<[]>()
    const draft = { ...EMPTY_TRANSFER_DRAFT, userId: 2 }
    await mount(
      <GroupTransferForm
        {...defaults}
        draft={draft}
        onDraftChange={drafts.fn}
        onTransfer={transfer.fn}
      />,
    )
    await choose("[data-e2e=group-transfer-member]", "3")
    await type("[data-e2e=group-transfer-name]", "Team")
    await type("[data-e2e=group-transfer-password]", "secret")
    expect(drafts.calls.map(([next]) => next)).toEqual([
      { ...draft, userId: 3 },
      { ...draft, name: "Team" },
      { ...draft, password: "secret" },
    ])
    expect(await submit("[data-e2e=group-transfer]")).toBe(true)
    expect(transfer.calls).toHaveLength(1)
  })

  it("moves focus to the field a refused transfer names, or to the message when it names none", async () => {
    const draft = { ...EMPTY_TRANSFER_DRAFT, userId: 2 }
    await mount(<GroupTransferForm {...defaults} draft={draft} />)
    await rerender(
      <GroupTransferForm
        {...defaults}
        draft={draft}
        error={{ field: "password", message: "Wrong." }}
      />,
    )
    expect(focused()).toBe("group-transfer-password")
    await rerender(
      <GroupTransferForm {...defaults} draft={draft} error={{ field: "name", message: "No." }} />,
    )
    expect(focused()).toBe("group-transfer-name")
    await rerender(
      <GroupTransferForm {...defaults} draft={draft} error={{ field: null, message: "Busy." }} />,
    )
    expect(focused()).toBe("group-transfer-error")
  })

  it("asks the app to drop the typed password when the form leaves the page", async () => {
    const drafts = spy<[TransferDraft]>()
    const draft = { userId: 2, name: "Team", password: "secret" }
    await mount(<GroupTransferForm {...defaults} draft={draft} onDraftChange={drafts.fn} />)
    await rerender(<p>closed</p>)
    expect(drafts.calls).toEqual([[{ userId: 2, name: "Team", password: "" }]])
  })

  it("draws nothing while nobody else is in the group", async () => {
    await mount(<GroupTransferForm {...defaults} members={[owner]} />)
    expect(root!.innerHTML).toBe("")
  })
})

const preview: InvitationPreviewRow = {
  id: "i-1",
  groupId,
  groupName: "Team",
  inviterName: "Olga Owner",
  role: GroupRole.EDITOR,
  addressed: false,
  forYou: true,
  expiresAt: "2026-02-01T00:00:00.000Z",
}

describe("InvitationScreen", () => {
  it("shows the group, who invited and the role, and accepts or declines through the app's callbacks", async () => {
    const accept = spy<[]>()
    const decline = spy<[]>()
    await mount(
      <InvitationScreen
        invitation={preview}
        loading={false}
        onAccept={accept.fn}
        onDecline={decline.fn}
      />,
    )
    expect(find("h1[data-e2e=invitation-group]").textContent).toBe("Team")
    expect(find("[data-e2e=invitation-inviter]").textContent).toBe("Olga Owner")
    expect(find("[data-e2e=invitation-card]").textContent).toContain("Editor")
    await click("[data-e2e=invitation-accept]")
    await click("[data-e2e=invitation-decline]")
    expect([accept.calls.length, decline.calls.length]).toEqual([1, 1])
  })

  it("explains an invitation for another address in place of the buttons", async () => {
    await mount(<InvitationScreen invitation={{ ...preview, forYou: false }} loading={false} />)
    expect(has("[data-e2e=invitation-not-for-you]")).toBe(true)
    expect(has("[data-e2e=invitation-accept]")).toBe(false)
  })

  it("says why an invitation cannot be used, with the way to the groups", async () => {
    await mount(<InvitationScreen invitation={null} loading={false} error="It expired." />)
    expect(root!.textContent).toContain("It expired.")
    expect(find(`a[href="${SCREEN_PATHS.groups}"]`).textContent).toBe("Go to your groups")
  })

  it("moves focus to a refused answer's message", async () => {
    await mount(<InvitationScreen invitation={preview} loading={false} />)
    await rerender(<InvitationScreen invitation={preview} loading={false} answerError="Used up." />)
    expect(focused()).toBe("invitation-answer-error")
  })
})

describe("MyInvitationsSection", () => {
  it("lists the invitations for the person, each with Accept and Decline", async () => {
    const accept = spy<[string]>()
    const decline = spy<[string]>()
    await mount(
      <MyInvitationsSection invitations={[preview]} onAccept={accept.fn} onDecline={decline.fn} />,
    )
    expect(texts("[data-e2e=invitation-group]")).toEqual(["Team"])
    await click("[data-e2e=invitation-accept]")
    await click("[data-e2e=invitation-decline]")
    expect([accept.calls, decline.calls]).toEqual([[["i-1"]], [["i-1"]]])
  })

  it("moves focus to the next invitation when one was answered, and to the page's first button after the last", async () => {
    const second = { ...preview, id: "i-2", groupName: "Family" }
    const page = (invitations: InvitationPreviewRow[], answeringId: string | null = null) => (
      <div>
        <button type="button" data-e2e="page-action">New group</button>
        <MyInvitationsSection invitations={invitations} answeringId={answeringId} />
      </div>
    )
    await mount(page([preview, second]))
    await rerender(page([preview, second], "i-1"))
    await rerender(page([second]))
    expect(document.activeElement?.getAttribute("aria-label"))
      .toBe("Decline the invitation to Family")

    await rerender(page([second], "i-2"))
    await rerender(page([]))
    expect(focused()).toBe("page-action")
  })

  it("draws nothing when there are none", async () => {
    await mount(<MyInvitationsSection invitations={[]} />)
    expect(root!.innerHTML).toBe("")
  })
})

describe("group details", () => {
  const owned = { ...team, description: "Our flat", color: "green" as const, emoji: "🏠" }
  const settings: GroupSettingsScreenProps = {
    group: owned,
    selected: true,
    loading: false,
    members: [],
    transfer: () => <p>transfer</p>,
  }

  it("shows the description, and the emoji on its colour, in the settings header", async () => {
    await mount(<GroupSettingsScreen {...settings} />)
    expect(find("[data-e2e=group-general-description]").textContent).toBe("Our flat")
    expect(find("[data-e2e=group-mark]").textContent).toBe("🏠")
    expect(find("[data-e2e=group-mark]").getAttribute("data-color")).toBe("green")
  })

  it("draws no mark and no description for a group that has neither", async () => {
    await mount(<GroupSettingsScreen {...settings} group={team} />)
    expect(has("[data-e2e=group-mark]")).toBe(false)
    expect(has("[data-e2e=group-general-description]")).toBe(false)
  })

  it("offers Edit details to the owner and an admin, and to no editor or viewer", async () => {
    const onUpdateDetails = () => Promise.resolve()
    for (
      const [role, offered] of [
        [GroupRole.OWNER, true],
        [GroupRole.ADMIN, true],
        [GroupRole.EDITOR, false],
        [GroupRole.VIEWER, false],
      ] as const
    ) {
      await mount(
        <GroupSettingsScreen
          {...settings}
          group={{ ...owned, role }}
          onUpdateDetails={onUpdateDetails}
        />,
      )
      expect(has("[data-e2e=group-details-open]")).toBe(offered)
      await act(() => render(null, root!))
    }
  })

  it("opens the dialog with the saved details and saves what the person changed", async () => {
    const calls = spy<[unknown]>()
    await mount(
      <GroupSettingsScreen
        {...settings}
        onUpdateDetails={(details) => {
          calls.fn(details)
          return Promise.resolve()
        }}
      />,
    )
    expect(has("[data-e2e=group-details-dialog]")).toBe(false)
    await click("[data-e2e=group-details-open]")
    expect(find<HTMLTextAreaElement>("[data-e2e=group-description]").value).toBe("Our flat")
    expect(find<HTMLInputElement>("[data-e2e=group-color-green]").checked).toBe(true)
    expect(find<HTMLInputElement>("[data-e2e=group-emoji]").value).toBe("🏠")

    await type("[data-e2e=group-description]", "  Our new flat  ")
    await click("[data-e2e=group-color-blue]")
    await type("[data-e2e=group-emoji]", "🏕️")
    await submit("[data-e2e=group-details-save]")

    expect(calls.calls).toEqual([[{ description: "Our new flat", color: "blue", emoji: "🏕️" }]])
  })

  it("clears the colour and the emoji when the person picks None and empties the field", async () => {
    const calls = spy<[unknown]>()
    await mount(
      <GroupSettingsScreen
        {...settings}
        onUpdateDetails={(details) => {
          calls.fn(details)
          return Promise.resolve()
        }}
      />,
    )
    await click("[data-e2e=group-details-open]")
    await click("[data-e2e=group-color-none]")
    await type("[data-e2e=group-emoji]", "")
    await submit("[data-e2e=group-details-save]")
    expect(calls.calls).toEqual([[{ description: "Our flat", color: null, emoji: null }]])
  })

  it("tells a second emoji or a word at the emoji field, and saves nothing", async () => {
    const calls = spy<[unknown]>()
    await mount(
      <GroupSettingsScreen
        {...settings}
        onUpdateDetails={(details) => {
          calls.fn(details)
          return Promise.resolve()
        }}
      />,
    )
    await click("[data-e2e=group-details-open]")
    for (const bad of ["🏠🏕️", "ab"]) {
      await type("[data-e2e=group-emoji]", bad)
      await submit("[data-e2e=group-details-save]")
      expect(find("[data-e2e=group-details-dialog]").textContent).toContain("single emoji")
      expect(find("[data-e2e=group-emoji]").getAttribute("aria-invalid")).toBe("true")
      expect(focused()).toBe("group-emoji")
    }
    expect(calls.calls).toEqual([])
  })

  it("counts the description's characters, and refuses more than 500 of them when saving", async () => {
    const calls = spy<[unknown]>()
    await mount(
      <GroupSettingsScreen
        {...settings}
        onUpdateDetails={(details) => {
          calls.fn(details)
          return Promise.resolve()
        }}
      />,
    )
    await click("[data-e2e=group-details-open]")
    expect(find("[data-e2e=group-details-dialog]").textContent).toContain("8 of 500 characters")

    // Each emoji is two UTF-16 units but one character, as the counter and the server count it.
    await type("[data-e2e=group-description]", "🏠".repeat(501))
    await submit("[data-e2e=group-details-save]")
    expect(calls.calls).toEqual([])
    expect(find("[data-e2e=group-details-dialog]").textContent).toContain("at most 500")
    expect(focused()).toBe("group-description")

    await type("[data-e2e=group-description]", "🏠".repeat(500))
    await submit("[data-e2e=group-details-save]")
    expect(calls.calls.length).toBe(1)
  })

  it("keeps the dialog open with the message of a refused save", async () => {
    await mount(
      <GroupSettingsScreen
        {...settings}
        onUpdateDetails={() => Promise.reject(new Error("Not allowed."))}
      />,
    )
    await click("[data-e2e=group-details-open]")
    await submit("[data-e2e=group-details-save]")
    expect(find("[data-e2e=group-details-dialog]").textContent).toContain("Not allowed.")
    expect(focused()).toBe("group-details-error")
  })

  it("closes the dialog once the save worked", async () => {
    await mount(<GroupSettingsScreen {...settings} onUpdateDetails={() => Promise.resolve()} />)
    await click("[data-e2e=group-details-open]")
    await submit("[data-e2e=group-details-save]")
    expect(has("[data-e2e=group-details-dialog]")).toBe(false)
  })

  it("shows each group's mark and description in the groups list", async () => {
    await mount(
      <GroupsScreen
        groups={[owned, { id: "g-2", name: "Family", role: GroupRole.VIEWER }]}
        selectedId={groupId}
        name=""
        creating={false}
        loading={false}
        error={null}
      />,
    )
    expect(texts(`[data-e2e=group-${groupId}] [data-e2e=group-mark]`)).toEqual(["🏠"])
    expect(texts(`[data-e2e=group-${groupId}] [data-e2e=group-item-description]`)[0])
      .toContain("Our flat")
    expect(has("[data-e2e=group-g-2] [data-e2e=group-mark]")).toBe(false)
    expect(has("[data-e2e=group-g-2] [data-e2e=group-item-description]")).toBe(false)
  })

  it("puts the emoji before the name in the picker's field", async () => {
    await mount(
      <GroupPicker
        groups={[owned, { id: "g-2", name: "Family", role: GroupRole.VIEWER }]}
        selectedId={groupId}
        onSelect={() => {}}
      />,
    )
    expect(find<HTMLInputElement>("input").value).toBe("🏠 Team")
  })

  it("draws no mark without a colour or an emoji, and a gray one for an emoji alone", async () => {
    await mount(<GroupMark />)
    expect(has("[data-e2e=group-mark]")).toBe(false)
    await rerender(<GroupMark emoji="🏠" />)
    expect(find("[data-e2e=group-mark]").hasAttribute("data-color")).toBe(false)
    await rerender(<GroupMark color="red" />)
    expect(find("[data-e2e=group-mark]").getAttribute("data-color")).toBe("red")
    expect(groupLabel({ name: "Team", emoji: "🏠" })).toBe("🏠 Team")
    expect(groupLabel({ name: "Team", emoji: null })).toBe("Team")
  })
})

describe("group details, as the server draws them", () => {
  it("hides the mark and names each colour for a screen reader in one radio group", () => {
    const mark = renderToString(<GroupMark color="green" emoji="🏠" />)
    expect(mark).toMatch(/<span [^>]*aria-hidden="true"[^>]*>🏠<\/span>/)

    const form = renderToString(
      <GroupDetailsForm
        initial={{ description: "", color: "blue", emoji: null }}
        onSave={() => Promise.resolve()}
        onCancel={() => {}}
      />,
    )
    const radios = form.match(/<input [^>]*type="radio"[^>]*>/g) ?? []
    // None and the six palette names.
    expect(radios.length).toBe(7)
    for (const radio of radios) expect(radio).toContain(`name="color"`)
    for (const name of ["Red", "Orange", "Green", "Blue", "Purple", "Gray"]) {
      expect(form).toMatch(new RegExp(`<span class="sr-only">${name}</span>`))
    }
  })
})
