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
import { SeatPriceConfirm } from "./billing-screen.tsx"
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
import { groupLabel, GroupMark } from "./group-appearance.tsx"
import { GroupPicker } from "./group-picker.tsx"
import {
  EMPTY_GROUP_DRAFT,
  type GroupDraft,
  GroupEditorScreen,
  type GroupEditorScreenProps,
  GroupTab,
  groupTabOf,
} from "./group-editor-screen.tsx"
import {
  EMPTY_TRANSFER_DRAFT,
  GroupTransferForm,
  type GroupTransferFormProps,
  type TransferDraft,
} from "./group-transfer.tsx"
import { GroupsScreen, type GroupsScreenProps, NEW_GROUP_PATH } from "./groups-screen.tsx"
import { INVITATION_OFFLINE, InvitationNewScreen } from "./invitation-new-screen.tsx"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { GROUP_PATHS, SCREEN_PATHS } from "./progressive.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do. Opening a dialog locks the page's scroll, which reads the
  // page's computed overflow.
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    // A link follows `navigate` only to the page's own origin, which it reads from `location`.
    location: window.location,
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

/**
 * Whether each link or button whose text is one of `labels` is at least 44 px tall on a phone.
 * happy-dom draws no layout, so this reads the class that sets the height (`min-h-11`).
 */
function tapTargets(labels: string[]): Record<string, boolean> {
  const controls = [...root!.querySelectorAll("a, button")]
  return Object.fromEntries(labels.map((label) => {
    const control = controls.find((element) => element.textContent?.trim() === label)
    if (!control) throw new Error(`no link or button reads ${label}`)
    return [label, control.classList.contains("min-h-11")]
  }))
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
      { id: "g-3", name: "Solo", role: GroupRole.OWNER, memberCount: 1 },
    ],
    selectedId: groupId,
    loading: false,
    error: null,
  }

  it("makes each whole row one link to its group's page, with the role and no other control", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(texts("[data-e2e=group-item-name]")).toEqual(["Team", "Family", "Solo"])
    expect(find(`[data-e2e=group-${groupId}]`).textContent).toContain("Owner")
    expect(find("[data-e2e=group-g-2]").textContent).toContain("Viewer")
    const link = find("[data-e2e=group-g-2] [data-e2e=group-open]")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe(GROUP_PATHS.settings("g-2"))
    // The link's box covers the row, so a tap anywhere on it opens the group.
    expect(link.className).toContain("after:absolute")
    expect(link.className).toContain("after:inset-0")
    for (const id of [groupId, "g-2"]) {
      expect(root!.querySelectorAll(`[data-e2e=group-${id}] a, [data-e2e=group-${id}] button`))
        .toHaveLength(1)
    }
    expect(has("[data-e2e=group-settings]")).toBe(false)
    expect(has(`[aria-label^="Members of"]`)).toBe(false)
  })

  it("counts each group's members on its row, says Only you for one, and nothing while unknown", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(find(`[data-e2e=group-${groupId}] [data-e2e=group-item-members]`).textContent)
      .toBe(" · 3 members")
    expect(find("[data-e2e=group-g-3] [data-e2e=group-item-members]").textContent)
      .toBe(" · Only you")
    expect(has("[data-e2e=group-g-2] [data-e2e=group-item-members]")).toBe(false)
  })

  it("follows a row's link through the app's navigate, without a page load", async () => {
    const navigate = spy<[string]>()
    await mount(<GroupsScreen {...defaults} navigate={navigate.fn} />)
    await click("[data-e2e=group-g-2] [data-e2e=group-open]")
    expect(navigate.calls).toEqual([[GROUP_PATHS.settings("g-2")]])
  })

  it("links New group in the header and in the empty state to the create page", async () => {
    await mount(<GroupsScreen {...defaults} groups={[]} />)
    expect(NEW_GROUP_PATH).toBe("/groups/new")
    expect(find("[data-e2e=group-new]").getAttribute("href")).toBe(NEW_GROUP_PATH)
    expect(find("[data-e2e=group-new-empty]").getAttribute("href")).toBe(NEW_GROUP_PATH)
    expect(root!.textContent).toContain("No groups yet")
    expect(has("dialog")).toBe(false)

    await rerender(<GroupsScreen {...defaults} groups={[]} loading />)
    expect(has("[data-e2e=group-new-empty]")).toBe(false)
  })

  it("shows a failed first read with Try again, not No groups yet or New group", async () => {
    const retries = spy<[]>()
    const failed = { ...defaults, groups: [], loadError: "Could not load the groups" }
    await mount(<GroupsScreen {...failed} onRetry={retries.fn} />)
    expect(find("[data-e2e=groups-load-error] [role=alert]").textContent)
      .toBe("Could not load the groups")
    expect(root!.textContent).not.toContain("No groups yet")
    expect(has("[data-e2e=group-new]")).toBe(false)
    expect(has("[data-e2e=group-new-empty]")).toBe(false)

    find("[data-e2e=groups-retry]").focus()
    await click("[data-e2e=groups-retry]")
    expect(retries.calls).toHaveLength(1)

    // While the retry runs the message and the button stay, so focus stays on the button.
    await rerender(<GroupsScreen {...failed} onRetry={retries.fn} loading />)
    expect(find("[data-e2e=groups-retry]").textContent).toContain("Loading groups…")
    expect(focused()).toBe("groups-retry")
    expect(root!.textContent).not.toContain("No groups yet")

    // A retry that answers brings the list and New group back.
    await rerender(<GroupsScreen {...defaults} onRetry={retries.fn} />)
    expect(has("[data-e2e=groups-load-error]")).toBe(false)
    expect(has("[data-e2e=group-new]")).toBe(true)
  })

  it("marks only the current group, with Current as text and in its link's name", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(texts("[data-e2e=group-current]")).toEqual(["Current"])
    expect(has(`[data-e2e=group-${groupId}] [data-e2e=group-current]`)).toBe(true)
    expect(find(`[data-e2e=group-${groupId}] [data-e2e=group-open]`).getAttribute("aria-label"))
      .toBe("Team, current group")
    expect(find("[data-e2e=group-g-2] [data-e2e=group-open]").getAttribute("aria-label"))
      .toBeNull()
  })

  it("has no refresh button", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=group-refresh]")).toBe(false)
  })

  it("keeps the deleted groups in a closed disclosure that counts them", async () => {
    const deleted = [{ id: "d-1", name: "Old", deletedAt: "2026-01-01T00:00:00.000Z" }]
    await mount(<GroupsScreen {...defaults} deleted={deleted} />)
    const disclosure = find<HTMLDetailsElement>("details[data-e2e=deleted-groups]")
    expect(disclosure.open).toBe(false)
    expect(find("details[data-e2e=deleted-groups] > summary").textContent)
      .toBe("Deleted groups (1)")
    expect(texts("[data-e2e=deleted-group-name]")).toEqual(["Old"])
    expect(find("[data-e2e=deleted-group-d-1]").textContent).toContain("2026-01-31")
  })

  it("restores a deleted group, and opens the disclosure on a refused restore's focused message", async () => {
    const restore = spy<[string]>()
    const deleted = [{ id: "d-1", name: "Old", deletedAt: "2026-01-01T00:00:00.000Z" }]
    await mount(<GroupsScreen {...defaults} deleted={deleted} onRestore={restore.fn} />)
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
    expect(find<HTMLDetailsElement>("details[data-e2e=deleted-groups]").open).toBe(true)
    expect(focused()).toBe("group-restore-error")
  })

  it("leaves the deleted groups out when there are none", async () => {
    await mount(<GroupsScreen {...defaults} />)
    expect(has("[data-e2e=deleted-groups]")).toBe(false)
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

const teamDraft: GroupDraft = { name: "Team", description: "", color: null, emoji: "" }

describe("GroupEditorScreen header", () => {
  const defaults: GroupEditorScreenProps = {
    group: team,
    current: true,
    loading: false,
    value: teamDraft,
    members: [owner, editor],
    transfer: () => <p data-e2e="transfer-body">transfer</p>,
  }

  it("shows the name, the role and that it is the current group", async () => {
    await mount(<GroupEditorScreen {...defaults} />)
    expect(find("[data-e2e=group-general-name]").textContent).toBe("Team")
    expect(find("[data-e2e=group-general-role]").textContent).toBe("Owner")
    expect(has("[data-e2e=group-current]")).toBe(true)
    await rerender(<GroupEditorScreen {...defaults} current={false} />)
    expect(has("[data-e2e=group-current]")).toBe(false)
  })

  it("offers Switch to this group in the menu only while the group is not the current one", async () => {
    const switched = spy<[]>()
    await mount(<GroupEditorScreen {...defaults} onSwitch={switched.fn} />)
    expect(has("[data-e2e=group-switch]")).toBe(false)
    await rerender(<GroupEditorScreen {...defaults} current={false} onSwitch={switched.fn} />)
    await click("[data-e2e=group-switch]")
    expect(switched.calls).toHaveLength(1)
  })

  it("orders the menu as switch, then transfer and move, then delete, a divider between each part", async () => {
    await mount(
      <GroupEditorScreen
        {...defaults}
        current={false}
        onSwitch={() => {}}
        moveTargets={[{ id: "g2", name: "Archive" }]}
        onMoveAll={() => {}}
      />,
    )
    const order = [
      ...root!.querySelectorAll(
        "[data-e2e=group-switch], [data-e2e=group-activity-open], [data-e2e=group-transfer-open], [data-e2e=group-move-all-open], [data-e2e=group-leave-open], [data-e2e=group-delete-open], [role=separator]",
      ),
    ].map((item) => item.getAttribute("data-e2e") ?? "divider")
    expect(order).toEqual([
      "group-switch",
      "divider",
      "group-transfer-open",
      "group-move-all-open",
      "divider",
      "group-delete-open",
    ])
  })

  it("draws no divider around a part of the menu that has nothing in it", async () => {
    // A viewer of the current group: no switch, no transfer, no move; only Leave.
    await mount(<GroupEditorScreen {...defaults} group={{ ...team, role: GroupRole.VIEWER }} />)
    expect(has("[role=separator]")).toBe(false)
    expect(has("[data-e2e=group-leave-open]")).toBe(true)
  })

  it("has no Open notes and no rename in place", async () => {
    await mount(<GroupEditorScreen {...defaults} current={false} />)
    expect(has("[data-e2e=group-open]")).toBe(false)
    expect(root!.textContent).not.toContain("Open notes")
    expect(has('button[aria-label="Rename Team"]')).toBe(false)
  })

  it("shows a viewer or an editor the details as text, with who may change them, and no form", async () => {
    const described = { ...team, description: "Our flat" }
    for (const role of [GroupRole.VIEWER, GroupRole.EDITOR]) {
      await mount(<GroupEditorScreen {...defaults} group={{ ...described, role }} dirty />)
      expect(has("[data-e2e=group-name]")).toBe(false)
      expect(has("[data-e2e=group-save]")).toBe(false)
      expect(find("[data-e2e=group-general-description]").textContent).toBe("Our flat")
      expect(find("[data-e2e=group-read-only]").textContent).toBe(
        "Only an admin or the owner can change this group's details.",
      )
      await act(() => render(null, root!))
    }
    await mount(<GroupEditorScreen {...defaults} group={{ ...team, role: GroupRole.ADMIN }} />)
    expect(has("[data-e2e=group-name]")).toBe(true)
    expect(has("[data-e2e=group-read-only]")).toBe(false)
  })

  it("gives the owner Transfer ownership and Delete group in the menu, and no Leave", async () => {
    await mount(<GroupEditorScreen {...defaults} />)
    expect(has("[data-e2e=group-transfer-open]")).toBe(true)
    expect(has("[data-e2e=group-delete-open]")).toBe(true)
    expect(has("[data-e2e=group-leave-open]")).toBe(false)
  })

  it("gives any other member Leave group in the menu, and neither Transfer nor Delete", async () => {
    await mount(<GroupEditorScreen {...defaults} group={{ ...team, role: GroupRole.ADMIN }} />)
    expect(has("[data-e2e=group-leave-open]")).toBe(true)
    expect(has("[data-e2e=group-transfer-open]")).toBe(false)
    expect(has("[data-e2e=group-delete-open]")).toBe(false)
  })

  it("leaves Transfer ownership out while nobody else is in the group", async () => {
    await mount(<GroupEditorScreen {...defaults} members={[owner]} />)
    expect(has("[data-e2e=group-transfer-open]")).toBe(false)
  })

  it("disables Delete group with the reason when it is the person's only group or still has a subscription", async () => {
    await mount(<GroupEditorScreen {...defaults} isLastGroup />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-delete-why]").textContent).toBe("It is your only group")
    await rerender(<GroupEditorScreen {...defaults} hasSubscription />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-delete-why]").textContent).toBe("Cancel its subscription first")
    await rerender(<GroupEditorScreen {...defaults} />)
    expect(find<HTMLButtonElement>("[data-e2e=group-delete-open]").disabled).toBe(false)
    expect(has("[data-e2e=group-delete-why]")).toBe(false)
  })

  it("disables Leave group with the reason on the person's only group", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    await mount(<GroupEditorScreen {...admin} isLastGroup />)
    expect(find<HTMLButtonElement>("[data-e2e=group-leave-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-leave-why]").textContent).toBe("It is your only group")
  })

  it("disables Transfer ownership with the reason while the group has a subscription", async () => {
    await mount(<GroupEditorScreen {...defaults} hasSubscription />)
    expect(find<HTMLButtonElement>("[data-e2e=group-transfer-open]").disabled).toBe(true)
    expect(find("[data-e2e=group-transfer-why]").textContent).toBe("Cancel its subscription first")
    await rerender(<GroupEditorScreen {...defaults} />)
    expect(find<HTMLButtonElement>("[data-e2e=group-transfer-open]").disabled).toBe(false)
    expect(has("[data-e2e=group-transfer-why]")).toBe(false)
  })

  it("asks before deleting, deletes on confirm, and keeps the dialog open with a refused delete's message focused", async () => {
    const remove = spy<[]>()
    await mount(<GroupEditorScreen {...defaults} onDelete={remove.fn} />)
    await click("[data-e2e=group-delete-open]")
    expect(remove.calls).toHaveLength(0)
    expect(find("[data-e2e=group-delete-confirmation]").textContent).toContain("30")
    await clickText("[data-e2e=group-delete-dialog]", "Delete group")
    expect(remove.calls).toHaveLength(1)
    await rerender(<GroupEditorScreen {...defaults} onDelete={remove.fn} deleting />)
    await rerender(
      <GroupEditorScreen {...defaults} onDelete={remove.fn} deleteError="It has a plan." />,
    )
    expect(find("[data-e2e=group-delete-dialog]").textContent).toContain("It has a plan.")
    expect(focused()).toBe("group-delete-error")
  })

  describe("move all data", () => {
    const targets = [{ id: "g2", name: "Archive" }, { id: "g3", name: "Home" }]
    const mover = { ...defaults, moveTargets: targets }

    it("offers the move to an editor with a group to move to, and to no one else", async () => {
      const move = spy<[string]>()
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen {...mover} onMoveAll={move.fn} {...props} />
      )
      await mount(screen({ group: { ...team, role: GroupRole.EDITOR } }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(true)
      await rerender(screen({ group: { ...team, role: GroupRole.VIEWER } }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
      await rerender(screen({ moveTargets: [] }))
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
      await rerender(<GroupEditorScreen {...mover} />)
      expect(has("[data-e2e=group-move-all-open]")).toBe(false)
    })

    it("moves to the group the person picks, and closes without moving on Cancel", async () => {
      const move = spy<[string]>()
      await mount(<GroupEditorScreen {...mover} onMoveAll={move.fn} />)
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
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen {...mover} onMoveAll={move.fn} {...props} />
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
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen {...mover} onMoveAll={() => {}} {...props} />
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
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen
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
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen
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

    it("names the tags a move took along, in the singular for one", async () => {
      const screen = (props: Partial<GroupEditorScreenProps>) => (
        <GroupEditorScreen {...mover} onMoveAll={() => {}} {...props} />
      )
      await mount(screen({}))
      await click("[data-e2e=group-move-all-open]")
      await rerender(screen({ moveAllResult: { count: 3, tags: 2, toName: "Archive" } }))
      expect(find("[data-e2e=group-move-all-done]").textContent).toContain(
        `Moved 3 notes and 2 tags from "Team" to "Archive"`,
      )
      await rerender(screen({ moveAllResult: { count: 0, tags: 1, toName: "Archive" } }))
      expect(find("[data-e2e=group-move-all-done]").textContent).toContain(
        `Moved 0 notes and 1 tag from "Team"`,
      )
    })

    it("offers no delete after the move when the group cannot be deleted, and keeping the group closes", async () => {
      const closed = spy<[]>()
      const result = { count: 1, toName: "Archive" }
      await mount(
        <GroupEditorScreen
          {...mover}
          onMoveAll={() => {}}
          onMoveAllClose={closed.fn}
          hasSubscription
        />,
      )
      await click("[data-e2e=group-move-all-open]")
      await rerender(
        <GroupEditorScreen
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
    await mount(<GroupEditorScreen {...defaults} onDelete={remove.fn} />)
    await click("[data-e2e=group-delete-open]")
    await clickText("[data-e2e=group-delete-dialog]", "Cancel")
    expect(has("[data-e2e=group-delete-dialog]")).toBe(false)
    expect(remove.calls).toHaveLength(0)
  })

  it("opens the delete dialog again without the message of an earlier refused delete", async () => {
    const screen = (props: Partial<GroupEditorScreenProps>) => (
      <GroupEditorScreen {...defaults} {...props} />
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
    await mount(<GroupEditorScreen {...admin} onLeave={leave.fn} />)
    await click("[data-e2e=group-leave-open]")
    expect(leave.calls).toHaveLength(0)
    await clickText("[data-e2e=group-leave-dialog]", "Leave group")
    expect(leave.calls).toHaveLength(1)
    await rerender(<GroupEditorScreen {...admin} onLeave={leave.fn} leaving />)
    await rerender(<GroupEditorScreen {...admin} onLeave={leave.fn} leaveError="No." />)
    expect(focused()).toBe("group-leave-error")
  })

  it("closes the leave dialog once the leave worked", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    await mount(<GroupEditorScreen {...admin} />)
    await click("[data-e2e=group-leave-open]")
    await rerender(<GroupEditorScreen {...admin} leaving />)
    expect(has("[data-e2e=group-leave-dialog]")).toBe(true)
    await rerender(<GroupEditorScreen {...admin} />)
    expect(has("[data-e2e=group-leave-dialog]")).toBe(false)
  })

  it("opens the leave dialog again without the message of an earlier refused leave", async () => {
    const admin = { ...defaults, group: { ...team, role: GroupRole.ADMIN } }
    const screen = (props: Partial<GroupEditorScreenProps>) => (
      <GroupEditorScreen {...admin} {...props} />
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
      <GroupEditorScreen
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
      <GroupEditorScreen
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
      <GroupEditorScreen
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

  it("offers Invite in the Members tab's header to the owner and admins only, as a link to the invitation page", async () => {
    const navigate = spy<[string]>()
    const members = { ...defaults, tab: GroupTab.MEMBERS }
    await mount(
      <GroupEditorScreen
        {...members}
        group={{ ...team, role: GroupRole.EDITOR }}
        navigate={navigate.fn}
      />,
    )
    expect(has("[data-e2e=invite-open]")).toBe(false)
    await rerender(<GroupEditorScreen {...defaults} navigate={navigate.fn} />)
    expect(has("[data-e2e=invite-open]")).toBe(false)
    await rerender(<GroupEditorScreen {...members} navigate={navigate.fn} />)
    expect(has("[data-e2e=page-header] [data-e2e=invite-open]")).toBe(true)
    expect(find("[data-e2e=invite-open]").getAttribute("href")).toBe(GROUP_PATHS.invite(team.id))
    await click("[data-e2e=invite-open]")
    expect(navigate.calls).toEqual([[GROUP_PATHS.invite(team.id)]])
    expect(has("dialog[open]")).toBe(false)
  })

  it("says a missing group may be deleted, with the way back to the groups", async () => {
    await mount(<GroupEditorScreen {...defaults} group={null} />)
    expect(root!.textContent).toContain("This group does not exist.")
    expect(find("[data-e2e=page-back]").getAttribute("href")).toBe(SCREEN_PATHS.groups)
    expect(has("[data-e2e=group-name]")).toBe(false)
  })

  it("draws a placeholder only after 300 ms while the group is read, says it is loading, and never says it is missing", async () => {
    await mount(<GroupEditorScreen {...defaults} group={null} loading />)
    expect(find("h1").textContent).toBe("Group")
    expect(has("[data-e2e=group-loading]")).toBe(false)
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(has("[data-e2e=group-loading]")).toBe(false)
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)))
    expect(find("[data-e2e=group-loading] [role=status]").textContent).toBe("Loading the group…")
    // The placeholder is the library's skeleton, which a screen reader skips.
    expect(
      root!.querySelectorAll("[data-e2e=group-loading] [aria-hidden=true] .animate-pulse").length,
    )
      .toBeGreaterThan(0)
    expect(root!.textContent).not.toContain("does not exist")
  })
})

describe("GroupEditorScreen tabs", () => {
  const defaults: GroupEditorScreenProps = {
    group: team,
    current: true,
    loading: false,
    value: teamDraft,
    members: [owner, editor],
    memberCount: 2,
    billing: <p data-e2e="billing-body">plan</p>,
    activity: <p data-e2e="activity-body">log</p>,
  }
  const tabs = () => [...root!.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)
  const selected = () => root!.querySelector("[role=tab][aria-selected=true]")?.textContent

  it("draws General, Members, Plan and billing and Activity, with the open tab's content only", async () => {
    await mount(<GroupEditorScreen {...defaults} />)
    expect(tabs()).toEqual(["General", "Members", "Plan and billing", "Activity"])
    expect(selected()).toBe("General")
    expect(has("[data-e2e=group-name]")).toBe(true)
    expect(has("[data-e2e=group-section-members]")).toBe(false)
    for (
      const [tab, label, part] of [
        [GroupTab.MEMBERS, "Members", "group-section-members"],
        [GroupTab.BILLING, "Plan and billing", "billing-body"],
        [GroupTab.ACTIVITY, "Activity", "activity-body"],
      ] as const
    ) {
      await rerender(<GroupEditorScreen {...defaults} tab={tab} />)
      expect(selected()).toBe(label)
      expect(has(`[role=tabpanel] [data-e2e=${part}]`)).toBe(true)
      expect(has("[data-e2e=group-name]")).toBe(false)
    }
  })

  it("follows a chosen tab to its own address", async () => {
    const navigate = spy<[string]>()
    await mount(<GroupEditorScreen {...defaults} navigate={navigate.fn} />)
    const [, members, billing, activity] = root!.querySelectorAll<HTMLElement>("[role=tab]")
    await act(() => members.click())
    await act(() => billing.click())
    await act(() => activity.click())
    expect(navigate.calls).toEqual([
      [GROUP_PATHS.members(team.id)],
      [GROUP_PATHS.billing(team.id)],
      [GROUP_PATHS.activity(team.id)],
    ])
  })

  it("leaves the Activity tab out for an editor or a viewer, unless its address is open", async () => {
    for (const role of [GroupRole.EDITOR, GroupRole.VIEWER]) {
      await mount(<GroupEditorScreen {...defaults} group={{ ...team, role }} />)
      expect(tabs()).toEqual(["General", "Members", "Plan and billing"])
      await rerender(
        <GroupEditorScreen {...defaults} group={{ ...team, role }} tab={GroupTab.ACTIVITY} />,
      )
      expect(selected()).toBe("Activity")
      await act(() => render(null, root!))
    }
  })

  it("links the member count to the Plan and billing tab, except on that tab", async () => {
    await mount(<GroupEditorScreen {...defaults} />)
    const count = find<HTMLAnchorElement>("a[data-e2e=group-member-count]")
    expect(count.textContent).toBe("2 members")
    expect(count.getAttribute("href")).toBe(GROUP_PATHS.billing(team.id))
    await rerender(<GroupEditorScreen {...defaults} tab={GroupTab.BILLING} />)
    expect(has("a[data-e2e=group-member-count]")).toBe(false)
    expect(find("[data-e2e=group-member-count]").textContent).toBe("2 members")
  })
})

describe("groupTabOf", () => {
  it("reads the tab an address names, General for none, and nothing for any other part", () => {
    expect(groupTabOf(undefined)).toBe(GroupTab.GENERAL)
    expect(groupTabOf("members")).toBe(GroupTab.MEMBERS)
    expect(groupTabOf("billing")).toBe(GroupTab.BILLING)
    expect(groupTabOf("activity")).toBe(GroupTab.ACTIVITY)
    for (const part of ["general", "pricing", "Members", ""]) {
      expect(groupTabOf(part), part).toBe(null)
    }
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
    const invite = <a href="/groups/g-1/invitations/new" data-e2e="invite-open">Invite people</a>
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

  it("gives the owner a link to the group's Plan and billing tab", async () => {
    await mount(<PlanRefusalNotice groupId={groupId} refusal={refusal} />)
    const link = find<HTMLAnchorElement>("[data-e2e=plan-refusal] a")
    expect(link.textContent).toBe("Open Plan and billing")
    expect(link.getAttribute("href")).toBe(GROUP_PATHS.billing(groupId))
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

  it("moves the role to one the plan allows again when the app resets its draft to the default", async () => {
    const drafts = spy<[InvitationDraft]>()
    await mount(<InviteForm {...defaults} memberRoles={false} onDraftChange={drafts.fn} />)
    // The app ignored the move and drew its default draft again, as a page that clears the store
    // as it opens does.
    await rerender(<InviteForm {...defaults} memberRoles={false} onDraftChange={drafts.fn} />)
    expect(drafts.calls).toEqual([
      [{ ...EMPTY_INVITATION_DRAFT, role: GroupRole.VIEWER }],
      [{ ...EMPTY_INVITATION_DRAFT, role: GroupRole.VIEWER }],
    ])
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

  it("shows a refusal for the creator's unverified address as a focused notice that leads to the profile", async () => {
    const message = "Verify your e-mail address in your profile before you invite anyone."
    const went: string[] = []
    await mount(<InviteForm {...defaults} navigate={(to) => went.push(to)} />)
    await rerender(
      <InviteForm {...defaults} navigate={(to) => went.push(to)} addressRefusal={message} />,
    )
    expect(focused()).toBe("invitation-error")
    expect(find("[data-e2e=invitation-error]").textContent).toContain(message)
    expect(find("[data-e2e=invitation-verify-email]").textContent).toBe("Verify e-mail")
    // A phone-sized touch target, as tall as the form's own controls.
    expect(find("[data-e2e=invitation-verify-email]").classList.contains("min-h-11")).toBe(true)
    // The address field is not blamed, and the form stays to send once the address is verified.
    expect(find("[data-e2e=invitation-email]").getAttribute("aria-invalid")).toBe(null)
    expect(has("[data-e2e=invitation-create]")).toBe(true)
    await click("[data-e2e=invitation-verify-email]")
    expect(went).toEqual([SCREEN_PATHS.email])
  })

  it("shows the created link in place of the form, its copy button focused, and calls onDone on Done", async () => {
    const done = spy<[]>()
    await mount(<InviteForm {...defaults} onDone={done.fn} />)
    await rerender(<InviteForm {...defaults} onDone={done.fn} created={created} />)
    expect(has("[data-e2e=invitation-form]")).toBe(false)
    expect(find("[data-e2e=invitation-created] code").textContent).toBe(created.link)
    expect(document.activeElement?.closest("[data-e2e=invitation-created]")).not.toBe(null)
    expect(document.activeElement?.tagName).toBe("BUTTON")
    await click("[data-e2e=invitation-done]")
    expect(done.calls).toHaveLength(1)
  })

  it("leaves through Cancel to the group's Members tab, and creates through Create invitation", async () => {
    const navigate = spy<[string]>()
    await mount(<InviteForm {...defaults} navigate={navigate.fn} />)
    expect(find("[data-e2e=invitation-create]").textContent).toBe("Create invitation")
    expect(find("[data-e2e=invitation-cancel]").getAttribute("href"))
      .toBe(GROUP_PATHS.members(groupId))
    await click("[data-e2e=invitation-cancel]")
    expect(navigate.calls).toEqual([[GROUP_PATHS.members(groupId)]])
  })

  it("gives Cancel, Create invitation and Done a 44 px tap target on a phone (class check: no layout here)", async () => {
    await mount(<InviteForm {...defaults} />)
    expect(tapTargets(["Cancel", "Create invitation"]))
      .toEqual({ "Cancel": true, "Create invitation": true })

    await rerender(<InviteForm {...defaults} created={created} />)
    expect(tapTargets(["Done"])).toEqual({ "Done": true })
  })

  it("shows why a create did not start above the buttons, and moves focus to it", async () => {
    await mount(<InviteForm {...defaults} />)
    await rerender(<InviteForm {...defaults} formError="No connection." />)
    expect(find("[data-e2e=invitation-error]").textContent).toContain("No connection.")
    expect(focused()).toBe("invitation-error")
  })
})

describe("InvitationNewScreen", () => {
  const page = {
    groupId,
    group: { name: "Team", role: GroupRole.ADMIN },
    loading: false,
    draft: EMPTY_INVITATION_DRAFT,
  }

  it("says it is offline above the form, and a refused submit's reason above the buttons", async () => {
    await mount(<InvitationNewScreen {...page} offline />)
    expect(find("[data-e2e=invitation-offline]").textContent).toContain("You are offline")
    expect(has("[data-e2e=invitation-error]")).toBe(false)
    await rerender(<InvitationNewScreen {...page} offline refusedOffline />)
    expect(find("[data-e2e=invitation-error]").textContent).toContain(INVITATION_OFFLINE)
  })

  it("draws a placeholder only after 300 ms while the group is read, and says it is loading", async () => {
    await mount(<InvitationNewScreen {...page} group={null} loading />)
    expect(has("[data-e2e=invitation-loading]")).toBe(false)
    expect(has("form")).toBe(false)
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)))
    expect(find("[data-e2e=invitation-loading] [role=status]").textContent)
      .toBe("Loading the group…")
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
        <a href="/groups/g-1/invitations/new" data-e2e="invite-open">Invite people</a>
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
        <a href="/groups/g-1/invitations/new" data-e2e="invite-open">Invite people</a>
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

  it("gives Accept, Decline and Go to your groups a 44 px tap target on a phone (class check: no layout here)", async () => {
    await mount(<InvitationScreen invitation={preview} loading={false} />)
    expect(tapTargets(["Accept invitation", "Decline"]))
      .toEqual({ "Accept invitation": true, "Decline": true })

    await rerender(<InvitationScreen invitation={null} loading={false} error="It expired." />)
    expect(tapTargets(["Go to your groups"])).toEqual({ "Go to your groups": true })
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

  it("moves focus to the next invitation when one was answered, and to the page's first link or button after the last", async () => {
    const second = { ...preview, id: "i-2", groupName: "Family" }
    const page = (invitations: InvitationPreviewRow[], answeringId: string | null = null) => (
      <div>
        <a href="/groups/new" data-e2e="page-action">New group</a>
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

  it("gives each invitation's Accept and Decline a 44 px tap target on a phone (class check: no layout here)", async () => {
    await mount(<MyInvitationsSection invitations={[preview]} />)
    expect(tapTargets(["Accept", "Decline"])).toEqual({ "Accept": true, "Decline": true })
  })

  it("draws nothing when there are none", async () => {
    await mount(<MyInvitationsSection invitations={[]} />)
    expect(root!.innerHTML).toBe("")
  })
})

describe("GroupEditorScreen form", () => {
  const owned = { ...team, description: "Our flat", color: "#15803d" as const, emoji: "🏠" }
  const saved: GroupDraft = { name: "Team", description: "Our flat", color: "#15803d", emoji: "🏠" }
  const settings: GroupEditorScreenProps = {
    group: owned,
    current: true,
    loading: false,
    value: saved,
    members: [],
    transfer: () => <p>transfer</p>,
  }
  const creating: GroupEditorScreenProps = {
    creating: true,
    group: null,
    current: false,
    loading: false,
    value: EMPTY_GROUP_DRAFT,
  }

  it("shows the group's emoji on its colour in the header, in a text colour that reads on it", async () => {
    await mount(<GroupEditorScreen {...settings} />)
    const mark = find<HTMLElement>("[data-e2e=page-header] [data-e2e=group-mark]")
    expect(mark.textContent).toBe("🏠")
    expect(mark.getAttribute("data-color")).toBe("#15803d")
    expect(mark.style.backgroundColor).toBe("#15803d")
    expect(mark.style.color).toBe("#ffffff")
  })

  it("updates the header's mark as the colour and emoji change, before they are saved", async () => {
    await mount(
      <GroupEditorScreen {...settings} value={{ ...saved, color: "#facc15", emoji: " 🏕️ " }} />,
    )
    const mark = find<HTMLElement>("[data-e2e=page-header] [data-e2e=group-mark]")
    expect(mark.getAttribute("data-color")).toBe("#facc15")
    expect(mark.textContent).toBe("🏕️")
    // Yellow is the one preset dark text reads on.
    expect(mark.style.color).toBe("#000000")
  })

  it("shows a viewer the group's saved mark, not the fields'", async () => {
    await mount(
      <GroupEditorScreen
        {...settings}
        group={{ ...owned, role: GroupRole.VIEWER }}
        value={{ ...saved, color: "#facc15" }}
      />,
    )
    expect(find("[data-e2e=page-header] [data-e2e=group-mark]").getAttribute("data-color"))
      .toBe("#15803d")
  })

  it("fills the fields with the group as saved and reports each change", async () => {
    const changes = spy<[GroupDraft]>()
    await mount(<GroupEditorScreen {...settings} onChange={changes.fn} />)
    expect(find<HTMLInputElement>("[data-e2e=group-name]").value).toBe("Team")
    expect(find<HTMLTextAreaElement>("[data-e2e=group-description]").value).toBe("Our flat")
    expect(find<HTMLInputElement>("input[name=color][value='#15803d']").checked).toBe(true)
    expect(find<HTMLInputElement>("[data-e2e=group-emoji]").value).toBe("🏠")

    await type("[data-e2e=group-name]", "Crew")
    await type("[data-e2e=group-description]", "Our new flat")
    await type("[data-e2e=group-emoji]", "🏕️")
    await click("input[name=color][value='#1d4ed8']")
    await click("input[name=color][value=none]")
    expect(changes.calls).toEqual([
      [{ ...saved, name: "Crew" }],
      [{ ...saved, description: "Our new flat" }],
      [{ ...saved, emoji: "🏕️" }],
      [{ ...saved, color: "#1d4ed8" }],
      [{ ...saved, color: null }],
    ])
  })

  it("offers No colour, the 16 presets and a custom colour, each named, in one radio group", async () => {
    await mount(<GroupEditorScreen {...settings} />)
    const fieldset = find("[data-e2e=group-color] fieldset")
    expect(fieldset.querySelector("legend")!.textContent).toContain("Colour")
    expect(fieldset.querySelector("legend")!.textContent).toContain("Optional")
    expect(fieldset.querySelectorAll("input[type=radio][name=color]")).toHaveLength(18)
    const names = texts("[data-e2e=group-color] label")
    expect(names[0]).toBe("No colour")
    expect(names.slice(1, 3)).toEqual(["Gray", "Red"])
    expect(names.at(-1)).toBe("Pick a custom colour")
  })

  it("takes a custom hex colour typed into the colour field", async () => {
    const changes = spy<[GroupDraft]>()
    await mount(<GroupEditorScreen {...settings} onChange={changes.fn} />)
    await click("input[name=color][value=custom]")
    await type("[data-e2e=group-color] input.font-mono", "#59168B")
    expect(changes.calls).toEqual([[{ ...saved, color: "#59168b" }]])
  })

  it("shows Discard and Save group only while a field differs from what is saved", async () => {
    const saves = spy<[]>()
    const discards = spy<[]>()
    const screen = (dirty: boolean) => (
      <GroupEditorScreen {...settings} dirty={dirty} onSave={saves.fn} onDiscard={discards.fn} />
    )
    await mount(screen(false))
    expect(has("[data-e2e=group-save]")).toBe(false)
    expect(has("[data-e2e=group-discard]")).toBe(false)

    await rerender(screen(true))
    expect(find("[data-e2e=group-save]").textContent).toBe("Save group")
    await click("[data-e2e=group-discard]")
    expect(discards.calls).toHaveLength(1)
    expect(await submit("[data-e2e=group-save]")).toBe(true)
    expect(saves.calls).toHaveLength(1)
  })

  it("keeps the fields and the footer in one narrow column, so they do not stretch across a wide page", async () => {
    await mount(<GroupEditorScreen {...settings} dirty />)
    const column = find("[data-e2e=group-name]").closest(".max-w-md")
    expect(column).not.toBe(null)
    expect(column!.contains(find("[data-e2e=group-save]"))).toBe(true)
  })

  it("says writing a group needs a connection while offline, in the words of each mode", async () => {
    await mount(<GroupEditorScreen {...settings} />)
    expect(has("[data-e2e=group-offline]")).toBe(false)
    await rerender(<GroupEditorScreen {...settings} offline />)
    expect(find("[data-e2e=group-offline]").textContent).toContain("You are offline")
    expect(find("[data-e2e=group-offline]").textContent).toContain(
      "This is the copy saved on this device. Saving changes needs a connection.",
    )
    await rerender(<GroupEditorScreen {...creating} offline />)
    expect(find("[data-e2e=group-offline]").textContent).toContain(
      "You can fill this in now. Creating the group needs a connection.",
    )
  })

  it("says on the create page whether a trial comes with the new group, and nothing with billing off", async () => {
    await mount(
      <GroupEditorScreen
        {...creating}
        trial={{ enabled: true, used: false, groupId: null, days: 14 }}
      />,
    )
    expect(find("[data-e2e=group-trial]").textContent).toContain(
      "Your 14-day free trial of a paid plan goes to the first group you choose a paid plan for.",
    )
    await rerender(
      <GroupEditorScreen
        {...creating}
        trial={{ enabled: true, used: true, groupId: "g-2", days: 14 }}
      />,
    )
    expect(find("[data-e2e=group-trial]").textContent).toContain(
      "You have used your free trial, so a paid plan here is charged from the first day.",
    )
    await rerender(
      <GroupEditorScreen
        {...creating}
        trial={{ enabled: false, used: true, groupId: "g-2", days: 14 }}
      />,
    )
    expect(has("[data-e2e=group-trial]")).toBe(false)
    await rerender(<GroupEditorScreen {...creating} />)
    expect(has("[data-e2e=group-trial]")).toBe(false)
  })

  it("moves focus to the name field when Discard takes the footer away", async () => {
    await mount(<GroupEditorScreen {...settings} value={{ ...saved, name: "Crew" }} dirty />)
    find("[data-e2e=group-discard]").focus()
    await rerender(<GroupEditorScreen {...settings} />)
    expect(has("[data-e2e=group-discard]")).toBe(false)
    expect(focused()).toBe("group-name")
  })

  it("moves focus to the name field once a save went through, not while it is still running", async () => {
    const changed = { ...saved, name: "Crew" }
    await mount(<GroupEditorScreen {...settings} value={changed} dirty />)
    find("[data-e2e=group-save]").focus()
    await rerender(<GroupEditorScreen {...settings} value={changed} saving />)
    expect(focused()).not.toBe("group-name")
    await rerender(<GroupEditorScreen {...settings} value={changed} />)
    expect(focused()).toBe("group-name")
  })

  it("leaves focus in the fields when typing puts the saved value back", async () => {
    await mount(<GroupEditorScreen {...settings} value={{ ...saved, name: "Crew" }} dirty />)
    find("[data-e2e=group-description]").focus()
    await rerender(<GroupEditorScreen {...settings} />)
    expect(focused()).toBe("group-description")
  })

  it("counts the description's characters as the server does, one per emoji", async () => {
    await mount(<GroupEditorScreen {...settings} />)
    expect(root!.textContent).toContain("8 of 500 characters")
    await rerender(<GroupEditorScreen {...settings} value={{ ...saved, description: "🏠🏠🏠" }} />)
    expect(root!.textContent).toContain("3 of 500 characters")
  })

  it("shows each refusal under its field and moves focus to the first one", async () => {
    await mount(<GroupEditorScreen {...settings} dirty />)
    await rerender(
      <GroupEditorScreen
        {...settings}
        dirty
        errors={{ description: "Use at most 500 characters.", emoji: "Use a single emoji." }}
      />,
    )
    expect(focused()).toBe("group-description")
    expect(find("[data-e2e=group-description]").getAttribute("aria-invalid")).toBe("true")
    expect(find("[data-e2e=group-emoji]").getAttribute("aria-invalid")).toBe("true")
    expect(root!.textContent).toContain("Use a single emoji.")
    expect(find("[data-e2e=group-name]").getAttribute("aria-invalid")).not.toBe("true")
  })

  it("moves focus to a refusal's message that names no field, under the form", async () => {
    await mount(<GroupEditorScreen {...settings} dirty />)
    await rerender(<GroupEditorScreen {...settings} dirty errors={{ form: "Not allowed." }} />)
    expect(find("[data-e2e=group-form-error]").textContent).toContain("Not allowed.")
    expect(focused()).toBe("group-form-error")
  })

  it("has no Preview block: the header's mark is the preview, on the create page too", async () => {
    await mount(<GroupEditorScreen {...settings} />)
    expect(has("[data-e2e=group-preview]")).toBe(false)
    expect(root!.textContent).not.toContain("Preview")
    await mount(
      <GroupEditorScreen {...creating} value={{ ...EMPTY_GROUP_DRAFT, color: "#0f766e" }} />,
    )
    expect(root!.textContent).not.toContain("Preview")
    expect(find("[data-e2e=page-header] [data-e2e=group-mark]").getAttribute("data-color"))
      .toBe("#0f766e")
    await rerender(<GroupEditorScreen {...creating} />)
    expect(has("[data-e2e=page-header] [data-e2e=group-mark]")).toBe(false)
  })

  it("draws the create page as the same form, empty, with Cancel and Create group", async () => {
    await mount(<GroupEditorScreen {...creating} />)
    expect(find("h1").textContent).toBe("New group")
    expect(find<HTMLInputElement>("[data-e2e=group-name]").value).toBe("")
    for (const field of ["group-description", "group-emoji"]) {
      expect(has(`[data-e2e=${field}]`)).toBe(true)
    }
    expect(has("[data-e2e=group-color] fieldset")).toBe(true)
    expect(find("[data-e2e=group-create]").textContent).toBe("Create group")
    expect(find("[data-e2e=group-cancel]").getAttribute("href")).toBe(SCREEN_PATHS.groups)
    // Nothing of an existing group: no menu, no members, no discard.
    expect(has("[data-e2e=group-menu]")).toBe(false)
    expect(has("[data-e2e=group-discard]")).toBe(false)
    expect(root!.textContent).not.toContain("Members")
  })

  it("creates through the app's callback, and refuses a second submit while it runs", async () => {
    const saves = spy<[]>()
    await mount(<GroupEditorScreen {...creating} onSave={saves.fn} />)
    expect(await submit("[data-e2e=group-create]")).toBe(true)
    expect(saves.calls).toHaveLength(1)
    await rerender(<GroupEditorScreen {...creating} onSave={saves.fn} saving />)
    expect(find("[data-e2e=group-create]").textContent).toContain("Creating…")
    await submit("[data-e2e=group-create]")
    expect(saves.calls).toHaveLength(1)
  })

  it("shows each group's mark and description in the groups list", async () => {
    await mount(
      <GroupsScreen
        groups={[owned, { id: "g-2", name: "Family", role: GroupRole.VIEWER }]}
        selectedId={groupId}
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

  it("shows the group's emoji mark before its name on the switcher and in its menu", async () => {
    await mount(
      <GroupPicker
        groups={[owned, { id: "g-2", name: "Family", role: GroupRole.VIEWER }]}
        selectedId={groupId}
        onSelect={() => {}}
      />,
    )
    expect(texts("[data-e2e=group-picker] [data-e2e=group-mark]")).toEqual(["🏠"])
    await act(() => {
      find("[data-e2e=group-picker]").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }) as unknown as Event,
      )
    })
    expect(texts(`[data-e2e=group-picker-${groupId}] [data-e2e=group-mark]`)).toEqual(["🏠"])
  })

  it("ends the switcher's menu with All groups, then New group, which links to the create page", async () => {
    await mount(
      <GroupPicker
        groups={[owned, { id: "g-2", name: "Family", role: GroupRole.VIEWER }]}
        selectedId={groupId}
        onSelect={() => {}}
      />,
    )
    await click("[data-e2e=group-picker]")
    const items = [...root!.querySelectorAll("[role^=menuitem]")]
    expect(items.map((item) => item.textContent!.trim()).slice(-2)).toEqual([
      "All groups",
      "New group",
    ])
    expect(find("[data-e2e=group-picker-new]").getAttribute("href")).toBe(NEW_GROUP_PATH)
    expect(NEW_GROUP_PATH).toBe("/groups/new")
  })

  it("draws no mark without a colour or an emoji, and a grey one for an emoji alone", async () => {
    await mount(<GroupMark />)
    expect(has("[data-e2e=group-mark]")).toBe(false)
    await rerender(<GroupMark emoji="🏠" />)
    expect(find("[data-e2e=group-mark]").hasAttribute("data-color")).toBe(false)
    expect(find<HTMLElement>("[data-e2e=group-mark]").getAttribute("style")).toBe(null)
    expect(find("[data-e2e=group-mark]").className).toContain("bg-track")
    await rerender(<GroupMark color="#b91c1c" />)
    expect(find("[data-e2e=group-mark]").getAttribute("data-color")).toBe("#b91c1c")
    expect(find<HTMLElement>("[data-e2e=group-mark]").style.backgroundColor).toBe("#b91c1c")
    expect(groupLabel({ name: "Team", emoji: "🏠" })).toBe("🏠 Team")
    expect(groupLabel({ name: "Team", emoji: null })).toBe("Team")
  })
})

describe("group editor, as the server draws it", () => {
  it("hides the mark and names each colour in one radio group", () => {
    const mark = renderToString(<GroupMark color="#15803d" emoji="🏠" />)
    expect(mark).toMatch(/<span [^>]*aria-hidden="true"[^>]*>🏠<\/span>/)

    const form = renderToString(
      <GroupEditorScreen
        creating
        group={null}
        current={false}
        loading={false}
        value={{ ...EMPTY_GROUP_DRAFT, color: "#1d4ed8" }}
      />,
    )
    const radios = form.match(/<input [^>]*type="radio"[^>]*>/g) ?? []
    // No colour, the 16 presets and Custom.
    expect(radios.length).toBe(18)
    for (const radio of radios) expect(radio).toContain(`name="color"`)
    for (const name of ["No colour", "Gray", "Yellow", "Pink", "Pick a custom colour"]) {
      expect(form).toMatch(new RegExp(`>${name}</`))
    }
  })
})
