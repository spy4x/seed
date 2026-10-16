/**
 * The notes screens, `NotesScreen` and `NoteEditorScreen`: what they render (server-rendered
 * HTML) and what a person does on them in a browser DOM (happy-dom): open a row's menu, confirm a
 * delete, tick notes and move them, save, and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import type { PlanRefusal } from "@domain/billing"
import { BILLING_PATHS } from "./billing-screen.tsx"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { type NoteRow, NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"
import { NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do. A link is routed only when it points at the page's own origin
  // (`location`), and a dialog locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
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

/** Renders `node` into a fresh element in the page, effects run. */
async function mount(node: VNode): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

/** The one element `selector` finds in the page, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** How many elements `selector` finds in the page. */
function count(selector: string): number {
  return document.querySelectorAll(selector).length
}

/** Types `value` into a field the way a person does: the value changes, then `input` fires. */
async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Clicks `element` and returns whether its default action was cancelled. */
async function clickOn(element: Element): Promise<boolean> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(() => {
    element.dispatchEvent(event as unknown as Event)
  })
  return event.defaultPrevented
}

/** Clicks the element `selector` finds. */
function click(selector: string): Promise<boolean> {
  return clickOn(find(selector))
}

/** Clicks the button or link of the page whose text is `label`, inside `within`. */
async function clickText(label: string, within = "body"): Promise<void> {
  const target = [...find(within).querySelectorAll("button, a")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!target) throw new Error(`no button or link reads ${label} in ${within}`)
  await clickOn(target)
}

/** Ticks or unticks a checkbox the way a person does. */
async function tick(selector: string, on = true): Promise<void> {
  const box = find<HTMLInputElement>(selector)
  box.checked = on
  await act(() => {
    box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
  })
}

/** Submits the form that holds the element `selector` finds, and lets its callback run. */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")!
  form.querySelector<HTMLButtonElement>("button[type=submit]")?.focus()
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** What has focus: its `data-e2e`, or its tag name when it has none. */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** The row of the list that holds what has focus: its `data-e2e`. */
function focusedRow(): string | null | undefined {
  return document.activeElement?.closest("li")?.getAttribute("data-e2e")
}

/** The opening tag of the element marked `data-e2e="<hook>"` in `html`, or a failure naming it. */
function tagOf(html: string, hook: string): string {
  const tag = html.match(new RegExp(`<[a-z]+\\b[^>]*data-e2e="${hook}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`no element has data-e2e="${hook}"`)
  return tag
}

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const team = { id: groupId, name: "Team", canWrite: true }
const viewerOfTeam = { ...team, canWrite: false }
const groceries = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  title: "Groceries",
  body: "milk",
  version: 3,
  updatedAt: "2026-10-01T10:00:00.000Z",
}
const trip = { ...groceries, id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111005", title: "Trip", body: "" }
const plan = { ...groceries, id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111006", title: "Plan", body: "" }
const targets = [
  { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003", name: "Family" },
  { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111004", name: "Work" },
]

const listDefaults: NotesScreenProps = {
  group: team,
  notes: [groceries, trip],
  loading: false,
  listError: null,
  moveTargets: targets,
  onMove: () => {},
  onDelete: () => {},
}

describe("NotesScreen", () => {
  it("heads the page with Notes, the group's name under it, and New note opening the create page", () => {
    const html = renderToString(<NotesScreen {...listDefaults} />)

    expect(html).toMatch(/<h1\b[^>]*><span\b[^>]*>Notes<\/span><\/h1>/)
    expect(html).toMatch(/data-e2e="notes-group"[^>]*>Team</)
    expect(tagOf(html, "note-new")).toContain(`href="${NOTE_PATHS.new}"`)
    // The button is an icon on a phone; its name stays "New note" for a screen reader.
    expect(html).toContain(`<span class="sr-only sm:not-sr-only">New note</span>`)
    expect(html).toContain(`aria-label="More actions"`)
  })

  it("shows each note as a row with a link to its page, its text and when it changed", () => {
    const html = renderToString(<NotesScreen {...listDefaults} />)

    expect(html).toContain(`href="${NOTE_PATHS.note(groceries.id)}"`)
    expect(html).toMatch(/data-e2e="note-item-body"[^>]*>milk</)
    expect(html).toContain(`datetime="${groceries.updatedAt}"`)
    expect(html).toContain(`aria-label="Actions for Groceries"`)
  })

  it("never clips the list card, so a row's menu opens in full over the rows below", async () => {
    await mount(<NotesScreen {...listDefaults} />)

    const card = find(`[data-e2e=note-list]`).parentElement as HTMLElement
    expect(card.className.split(" ")).not.toContain("overflow-hidden")
  })

  it("shows an empty list as an empty state whose one action is New note", () => {
    const html = renderToString(<NotesScreen {...listDefaults} notes={[]} />)

    expect(html).toContain("No notes yet.")
    expect(tagOf(html, "note-new-empty")).toContain(`href="${NOTE_PATHS.new}"`)
    expect(html).not.toContain(`data-e2e="note-list"`)
  })

  it("shows a long title on up to two lines, with the time on the line under it", async () => {
    const long = { ...groceries, title: "Q4 roadmap: onboarding, billing and more" }
    await mount(<NotesScreen {...listDefaults} notes={[long]} />)

    const title = find(`[data-e2e=note-${long.id}] [data-e2e=note-item-title]`)
    expect(title.textContent).toBe(long.title)
    expect(title.className.split(" ")).toContain("line-clamp-2")
    expect(title.className.split(" ")).not.toContain("truncate")
    // The time sits in the meta line, never on the title's line, where it would squeeze the title.
    const time = find(`[data-e2e=note-${long.id}] time`)
    expect(title.contains(time)).toBe(false)
    expect(time.parentElement?.contains(title)).toBe(false)
  })

  it("draws an empty list as a message inside a solid card, not a dashed box", async () => {
    await mount(<NotesScreen {...listDefaults} notes={[]} />)

    const empty = [...document.querySelectorAll("[role=status]")]
      .find((element) => element.textContent?.includes("No notes yet."))
    if (!empty) throw new Error("no status says No notes yet.")
    expect(empty.closest(".pc-card")).not.toBeNull()
    expect(empty.className.split(" ")).not.toContain("border-dashed")
  })

  it("sets no width of its own, so it fills the column the app's frame gives it", () => {
    for (
      const html of [
        renderToString(<NotesScreen {...listDefaults} />),
        renderToString(<NoteEditorScreen {...editorDefaults} />),
      ]
    ) {
      expect(html).not.toMatch(/\bmax-w-(?:2xl|3xl|5xl)\b/)
    }
  })

  it("shows a viewer the notes with no way to add, move or delete one", () => {
    const html = renderToString(<NotesScreen {...listDefaults} group={viewerOfTeam} />)

    expect(html).toContain("Only an editor can change them.")
    expect(html).toContain("Groceries")
    expect(html).not.toContain(`data-e2e="note-new"`)
    expect(html).not.toContain(`data-e2e="note-menu"`)
    expect(html).not.toContain(`data-e2e="notes-select"`)
  })

  it("gives rows no menu when there is nowhere to move a note and no delete", () => {
    const html = renderToString(
      <NotesScreen {...listDefaults} moveTargets={[]} onDelete={undefined} />,
    )

    expect(html).not.toContain(`data-e2e="note-menu"`)
  })

  it("says the group was not found once loading is over, with a way back to the groups", () => {
    expect(renderToString(<NotesScreen {...listDefaults} group={null} loading />)).toContain(
      "Loading the group...",
    )
    const html = renderToString(<NotesScreen {...listDefaults} group={null} />)
    expect(html).toContain("This group was not found.")
    expect(html).toContain(`href="${SCREEN_PATHS.groups}"`)
  })
})

describe("NotesScreen in the browser", () => {
  const row = (note: { id: string }) => `[data-e2e=note-${note.id}]`

  it("deletes a note from its row's menu only after the person confirms, at the version shown", async () => {
    const remove = spy<[{ id: string; version: number }]>()
    await mount(<NotesScreen {...listDefaults} onDelete={remove.fn} />)

    await click(`${row(trip)} [data-e2e=note-menu]`)
    await click(`${row(trip)} [data-e2e=note-delete]`)
    expect(remove.calls).toEqual([])
    expect(find("[data-e2e=note-delete-dialog]").textContent).toContain(
      `"Trip" will be deleted for everyone in Team.`,
    )

    await clickText("Delete", "[data-e2e=note-delete-dialog]")
    expect(remove.calls).toEqual([[{ id: trip.id, version: trip.version }]])
    expect(count("[data-e2e=note-delete-dialog]")).toBe(0)
  })

  it("deletes nothing when the person keeps the note", async () => {
    const remove = spy<[{ id: string; version: number }]>()
    await mount(<NotesScreen {...listDefaults} onDelete={remove.fn} />)
    await click(`${row(groceries)} [data-e2e=note-menu]`)
    await click(`${row(groceries)} [data-e2e=note-delete]`)

    await clickText("Keep it", "[data-e2e=note-delete-dialog]")

    expect(remove.calls).toEqual([])
    expect(count("[data-e2e=note-delete-dialog]")).toBe(0)
  })

  it("moves one note from its row's menu to the group the person picks", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...listDefaults} onMove={move.fn} />)

    await click(`${row(groceries)} [data-e2e=note-menu]`)
    await clickText("Move to Work", row(groceries))

    expect(move.calls).toEqual([[{ toGroupId: targets[1].id, noteIds: [groceries.id] }]])
  })

  it("shows tick boxes and the move bar only after the person asks to select notes", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    expect(count("[data-e2e=note-select]")).toBe(0)
    expect(count("[data-e2e=notes-move]")).toBe(0)

    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")

    expect(count("[data-e2e=note-select]")).toBe(2)
    expect(count("[data-e2e=note-menu]")).toBe(0)
    expect(find("[data-e2e=notes-move]").textContent).toContain("Tick the notes to move")
    // Nothing ticked yet: nothing to move, so no group to pick and no move button.
    expect(count("[data-e2e=notes-move-submit]")).toBe(0)
  })

  it("pins the move bar to the bottom only from md up, where no tab bar covers it", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    const classes = find("[data-e2e=notes-move]").className.split(" ")
    expect(classes).not.toContain("sticky")
    expect(classes).toContain("md:sticky")
  })

  it("moves the ticked notes to the chosen group, and cancels the native post", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...listDefaults} onMove={move.fn} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")

    await tick(`${row(trip)} [data-e2e=note-select]`)
    expect(find("[data-e2e=notes-move]").textContent).toContain("1 selected")
    const select = find<HTMLSelectElement>("[data-e2e=notes-move-to]")
    select.value = targets[1].id
    await act(() => {
      select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })

    expect(await submit("[data-e2e=notes-move-to]")).toBe(true)
    expect(move.calls).toEqual([[{ toGroupId: targets[1].id, noteIds: [trip.id] }]])
  })

  it("refuses a second move while the first is pending", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...listDefaults} onMove={move.fn} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    await tick(`${row(trip)} [data-e2e=note-select]`)
    await rerender(<NotesScreen {...listDefaults} onMove={move.fn} moving />)

    expect(await submit("[data-e2e=notes-move-to]")).toBe(true)
    expect(move.calls).toEqual([])
  })

  it("ends the selection when the person cancels, or once a move goes through", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    await click("[data-e2e=notes-select-cancel]")
    expect(count("[data-e2e=note-select]")).toBe(0)

    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    await rerender(<NotesScreen {...listDefaults} moving />)
    await rerender(<NotesScreen {...listDefaults} moving={false} />)
    expect(count("[data-e2e=note-select]")).toBe(0)
  })

  it("keeps the selection and shows the refusal in the move bar when a move is refused", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    await rerender(<NotesScreen {...listDefaults} moving />)
    await rerender(<NotesScreen {...listDefaults} moveError="Could not move the notes" />)

    expect(count("[data-e2e=note-select]")).toBe(2)
    expect(find("[data-e2e=notes-move]").textContent).toContain("Could not move the notes")
  })
  it("moves focus to the next row's menu after a confirmed delete, else the previous row's, else More actions", async () => {
    const listOf = (notes: NoteRow[]) => <NotesScreen {...listDefaults} notes={notes} />
    const deleteRow = async (note: NoteRow) => {
      await click(`${row(note)} [data-e2e=note-menu]`)
      await click(`${row(note)} [data-e2e=note-delete]`)
      await clickText("Delete", "[data-e2e=note-delete-dialog]")
    }
    await mount(listOf([groceries, trip, plan]))

    await deleteRow(trip)
    await rerender(listOf([groceries, plan]))
    expect(focusedRow()).toBe(`note-${plan.id}`)

    await deleteRow(plan)
    await rerender(listOf([groceries]))
    expect(focusedRow()).toBe(`note-${groceries.id}`)

    await deleteRow(groceries)
    await rerender(listOf([]))
    expect(focused()).toBe("notes-menu")
  })

  it("moves focus to the next row's menu once a move from a row's menu goes through", async () => {
    await mount(<NotesScreen {...listDefaults} />)

    await click(`${row(groceries)} [data-e2e=note-menu]`)
    await clickText("Move to Work", row(groceries))
    await rerender(<NotesScreen {...listDefaults} notes={[trip]} />)

    expect(focusedRow()).toBe(`note-${trip.id}`)
    expect(focused()).toBe("note-menu")
  })

  it("leaves focus where the person put it when a refused delete's note leaves the list later", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click(`${row(trip)} [data-e2e=note-menu]`)
    await click(`${row(trip)} [data-e2e=note-delete]`)
    await clickText("Delete", "[data-e2e=note-delete-dialog]")
    await rerender(<NotesScreen {...listDefaults} listError="Could not delete the note" />)

    find<HTMLElement>("[data-e2e=note-new]").focus()
    // Someone else deletes it, and the live update drops it from the list.
    await rerender(<NotesScreen {...listDefaults} notes={[groceries]} />)

    expect(focused()).toBe("note-new")
  })

  it("leaves focus where the person put it when a refused move's note leaves the list later", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click(`${row(groceries)} [data-e2e=note-menu]`)
    await clickText("Move to Work", row(groceries))
    await rerender(<NotesScreen {...listDefaults} moveError="Could not move the note" />)

    find<HTMLElement>("[data-e2e=note-new]").focus()
    await rerender(<NotesScreen {...listDefaults} notes={[trip]} />)

    expect(focused()).toBe("note-new")
  })

  it("moves focus to More actions when the selection ends by Cancel or by a move", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")

    // A click focuses the button it lands on, and Cancel then leaves the page.
    find<HTMLElement>("[data-e2e=notes-select-cancel]").focus()
    await click("[data-e2e=notes-select-cancel]")
    expect(focused()).toBe("notes-menu")

    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")
    find<HTMLElement>("[data-e2e=note-select]").focus()
    await rerender(<NotesScreen {...listDefaults} moving />)
    await rerender(<NotesScreen {...listDefaults} moving={false} />)
    expect(focused()).toBe("notes-menu")
  })

  it("ticks a note from a tap anywhere on its row while selecting, and opens nothing", async () => {
    await mount(<NotesScreen {...listDefaults} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-select]")

    expect(count(`${row(trip)} a`)).toBe(0)
    await click(`${row(trip)} [data-e2e=note-item-title]`)

    expect(find<HTMLInputElement>(`${row(trip)} [data-e2e=note-select]`).checked).toBe(true)
    expect(find("[data-e2e=notes-move]").textContent).toContain("1 selected")
  })

  it("disables Move in a row's menu while a move is pending", async () => {
    const move = spy<[{ toGroupId: string; noteIds: string[] }]>()
    await mount(<NotesScreen {...listDefaults} onMove={move.fn} moving />)

    await click(`${row(groceries)} [data-e2e=note-menu]`)

    const items = document.querySelectorAll<HTMLButtonElement>(
      `${row(groceries)} [data-e2e=note-move]`,
    )
    expect([...items].map((item) => item.disabled)).toEqual([true, true])
  })
})

describe("NotesScreen deleted notes", () => {
  const row = (note: { id: string }) => `[data-e2e=note-${note.id}]`
  const deletedDefaults: NotesScreenProps = {
    ...listDefaults,
    showDeleted: true,
    onShowDeletedChange: () => {},
    deletedNotes: [trip, plan],
    onRestore: () => {},
  }
  const limitReached: PlanRefusal = {
    code: "PLAN_LIMIT_REACHED",
    entitlement: "maxNotes",
    limit: 10,
    canUpgrade: true,
  }

  it("offers Show deleted notes in the header's menu, and only when the app can show them", async () => {
    await mount(<NotesScreen {...listDefaults} onShowDeletedChange={() => {}} />)
    await click("[data-e2e=notes-menu]")
    expect(find("[data-e2e=notes-show-deleted]").textContent?.trim()).toBe("Show deleted notes")
    await rerender(<NotesScreen {...listDefaults} />)
    expect(count("[data-e2e=notes-show-deleted]")).toBe(0)
  })

  it("turns the filter on from the menu and back off from the menu or the banner", async () => {
    const change = spy<[boolean]>()
    await mount(<NotesScreen {...listDefaults} onShowDeletedChange={change.fn} />)
    await click("[data-e2e=notes-menu]")
    await click("[data-e2e=notes-show-deleted]")
    await rerender(<NotesScreen {...deletedDefaults} onShowDeletedChange={change.fn} />)

    await click("[data-e2e=notes-show-live]")
    await click("[data-e2e=notes-menu]")
    expect(find("[data-e2e=notes-show-deleted]").textContent?.trim()).toBe("Show notes")
    await click("[data-e2e=notes-show-deleted]")

    expect(change.calls).toEqual([[true], [false], [false]])
  })

  it("lists the deleted notes in place of the live ones, with the 30 day notice", () => {
    const html = renderToString(<NotesScreen {...deletedDefaults} />)

    expect(html).toContain(`data-e2e="deleted-note-list"`)
    expect(html).not.toContain(`data-e2e="note-list"`)
    expect(html).toContain("Trip")
    expect(html).not.toContain("Groceries")
    expect(html).toContain("stay here for 30 days")
    expect(html).not.toContain(`data-e2e="note-menu"`)
  })

  it("restores a note from its row", async () => {
    const restore = spy<[{ id: string }]>()
    await mount(<NotesScreen {...deletedDefaults} onRestore={restore.fn} />)

    await click(`${row(plan)} [data-e2e=note-restore]`)

    expect(restore.calls).toEqual([[{ id: plan.id }]])
  })

  it("names each Restore button after its note, so a screen reader can tell them apart", () => {
    const html = renderToString(<NotesScreen {...deletedDefaults} />)

    expect(html).toContain(`aria-label="Restore Trip"`)
    expect(html).toContain(`aria-label="Restore Plan"`)
  })

  it("shows a viewer the deleted notes with no Restore", () => {
    const html = renderToString(<NotesScreen {...deletedDefaults} group={viewerOfTeam} />)

    expect(html).toContain("Trip")
    expect(html).not.toContain(`data-e2e="note-restore"`)
  })

  it("disables every Restore while one note is being restored", async () => {
    await mount(<NotesScreen {...deletedDefaults} restoring={trip.id} />)

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-e2e=note-restore]")]

    expect(buttons.map((button) => button.disabled)).toEqual([true, true])
  })

  it("says there are no deleted notes, and that they are loading", () => {
    expect(renderToString(<NotesScreen {...deletedDefaults} deletedNotes={[]} />)).toContain(
      "No deleted notes.",
    )
    expect(
      renderToString(<NotesScreen {...deletedDefaults} deletedNotes={[]} deletedLoading />),
    ).toContain("Loading deleted notes...")
  })

  it("shows a refused restore under the banner, and the plan's limit as an upgrade prompt", async () => {
    await mount(
      <NotesScreen
        {...deletedDefaults}
        restoreError={{ title: null, form: "Could not restore the note" }}
      />,
    )
    expect(find("[data-e2e=notes-deleted-banner]").parentElement!.textContent).toContain(
      "Could not restore the note",
    )

    await rerender(
      <NotesScreen
        {...deletedDefaults}
        restoreError={{ title: null, form: "Limit", plan: limitReached }}
      />,
    )
    expect(find("[data-e2e=plan-refusal]").getAttribute("data-entitlement")).toBe("maxNotes")
    expect(focused()).toBe("plan-refusal")
  })

  it("shows a refused Undo in the live list, where the person is", async () => {
    await mount(
      <NotesScreen
        {...listDefaults}
        notes={[]}
        restoreError={{
          title: null,
          form: "Restoring a note needs a connection. Try again when you are back online.",
        }}
      />,
    )
    expect(document.body.textContent).toContain("Restoring a note needs a connection.")

    await rerender(
      <NotesScreen
        {...listDefaults}
        notes={[]}
        restoreError={{ title: null, form: "Limit", plan: limitReached }}
      />,
    )
    expect(find("[data-e2e=plan-refusal]").getAttribute("data-entitlement")).toBe("maxNotes")
  })

  it("after Undo, moves focus to the restored note's row, or to More actions when it failed", async () => {
    let handled = 0
    const props = { onUndoFocused: () => handled++ }
    await mount(<NotesScreen {...listDefaults} notes={[]} />)
    await rerender(
      <NotesScreen
        {...listDefaults}
        notes={[trip, plan]}
        undoOutcome={{ id: plan.id, restored: true }}
        {...props}
      />,
    )
    expect(focusedRow()).toBe(`note-${plan.id}`)
    expect(handled).toBe(1)

    await rerender(
      <NotesScreen
        {...listDefaults}
        notes={[trip]}
        undoOutcome={{ id: plan.id, restored: false }}
        {...props}
      />,
    )
    expect(focused()).toBe("notes-menu")
    expect(handled).toBe(2)
  })

  it("moves focus to the next Restore after a restore, else More actions", async () => {
    const listOf = (notes: NoteRow[]) => <NotesScreen {...deletedDefaults} deletedNotes={notes} />
    await mount(listOf([trip, plan]))

    await click(`${row(trip)} [data-e2e=note-restore]`)
    await rerender(listOf([plan]))
    expect(focusedRow()).toBe(`note-${plan.id}`)

    await click(`${row(plan)} [data-e2e=note-restore]`)
    await rerender(listOf([]))
    expect(focused()).toBe("notes-menu")
  })
})

const editorDefaults: NoteEditorScreenProps = {
  group: team,
  loading: false,
  notFound: false,
  note: null,
  value: { title: "", body: "" },
  errors: { title: null, form: null },
  saving: false,
  deleting: false,
}
const existing = { id: groceries.id, version: 3, conflict: false }
const editing: NoteEditorScreenProps = {
  ...editorDefaults,
  note: existing,
  value: groceries,
  moveTargets: targets,
  onMove: () => {},
  onDelete: () => {},
}

describe("NoteEditorScreen", () => {
  it("heads the page with a back button to the list and the group's name, and has no menu when creating", () => {
    const html = renderToString(
      <NoteEditorScreen
        {...editorDefaults}
        moveTargets={targets}
        onMove={() => {}}
        onDelete={() => {}}
      />,
    )

    expect(html).toMatch(/<h1\b[^>]*><span\b[^>]*>New note<\/span><\/h1>/)
    expect(html).toMatch(/data-e2e="notes-group"[^>]*>Team</)
    expect(tagOf(html, "page-back")).toContain(`href="${NOTE_PATHS.list}"`)
    expect(tagOf(html, "page-back")).toContain(`aria-label="Back to notes"`)
    expect(html).not.toContain(`aria-label="More actions"`)
    expect(html).toContain("Add note")
  })

  it("puts Move and Delete of an existing note in the page's menu, not on the page", () => {
    const html = renderToString(<NoteEditorScreen {...editing} />)

    expect(html).toMatch(/<h1\b[^>]*><span\b[^>]*>Edit note<\/span><\/h1>/)
    expect(html).toContain(`aria-label="More actions"`)
    expect(html).toContain("Move to Family")
    expect(html).toContain("Move to Work")
    // Inside the menu, which stays closed until the person opens it.
    expect(html).toMatch(/<details\b[^>]*>(?:(?!<\/details>)[\s\S])*data-e2e="note-delete"/)
    expect(html).toContain("Save note")
  })

  it("shows a viewer the note as text, with no form and no way to change it", () => {
    const html = renderToString(<NoteEditorScreen {...editing} group={viewerOfTeam} />)

    expect(html).toMatch(/data-e2e="note-read-title"[^>]*><span\b[^>]*>Groceries</)
    expect(html).toContain("milk")
    expect(html).toContain("Only an editor can change it.")
    expect(html).not.toContain("<form")
    expect(html).not.toContain(`aria-label="More actions"`)
  })

  it("tells a viewer on the create page that only an editor can add notes", () => {
    const html = renderToString(<NoteEditorScreen {...editorDefaults} group={viewerOfTeam} />)

    expect(html).not.toContain("<form")
    expect(html).toContain("Only an editor can add notes")
  })

  it("says the note was not found, with a way back to the list and no form", () => {
    const html = renderToString(<NoteEditorScreen {...editorDefaults} notFound />)

    expect(html).toContain("Note not found")
    expect(html).toContain("There is no such note in Team")
    expect(html).toContain(`href="${NOTE_PATHS.list}"`)
    expect(html).not.toContain("<form")
  })

  it("names the other group of a note and switches only when the person presses the button", async () => {
    const switched = spy<[]>()
    await mount(
      <NoteEditorScreen
        {...editorDefaults}
        notFound
        elsewhere={{ name: "Family" }}
        onSwitchGroup={switched.fn}
      />,
    )

    expect(find("[data-e2e=note-elsewhere]").textContent).toContain("Family")
    expect(find("h1").textContent).not.toContain("not found")
    expect(count("[data-e2e=note-not-found]")).toBe(0)
    expect(switched.calls).toHaveLength(0)
    expect(find("[data-e2e=note-switch-group]").classList.contains("min-h-11")).toBe(true)

    await click("[data-e2e=note-switch-group]")

    expect(find("[data-e2e=note-switch-group]").textContent).toBe("Switch to Family")
    expect(switched.calls).toHaveLength(1)
  })

  it("keeps the plain not-found page when no other group holds the note", () => {
    const html = renderToString(<NoteEditorScreen {...editorDefaults} notFound elsewhere={null} />)

    expect(html).toContain("There is no such note in Team")
    expect(html).not.toContain("note-switch-group")
  })

  it("shows the error of a refused read instead of claiming the note does not exist", () => {
    const html = renderToString(
      <NoteEditorScreen {...editorDefaults} notFound errors={{ title: null, form: "Offline" }} />,
    )

    expect(html).toContain("Offline")
    expect(html).not.toContain("There is no such note")
  })

  it("shows the owner the note cap with a link to the group's pricing page", () => {
    const capped: PlanRefusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: true,
    }
    const html = renderToString(
      <NoteEditorScreen
        {...editorDefaults}
        errors={{ title: null, form: "Upgrade", plan: capped }}
      />,
    )

    expect(html).toContain(`data-e2e="plan-refusal"`)
    expect(html).toContain("up to 10 notes")
    expect(html).toContain(`href="${BILLING_PATHS.pricing(groupId)}"`)
  })

  it("tells a member who cannot upgrade to ask the owner, and gives no pricing link", () => {
    const capped: PlanRefusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    const html = renderToString(
      <NoteEditorScreen
        {...editorDefaults}
        errors={{ title: null, form: "Upgrade", plan: capped }}
      />,
    )

    expect(html).toContain("Ask the group's owner to upgrade the plan.")
    expect(html).not.toContain(BILLING_PATHS.pricing(groupId))
  })

  it("ties the title error to its field and tells a stale edit where the latest version is", () => {
    const html = renderToString(
      <NoteEditorScreen
        {...editing}
        note={{ ...existing, conflict: true }}
        value={{ title: "Mine", body: "" }}
        errors={{ title: "Enter a title", form: "The note was changed by someone else" }}
      />,
    )

    expect(html).toMatch(/aria-describedby="note-title-error"/)
    expect(html).toContain("Enter a title")
    expect(html).toContain("The note was changed by someone else")
    // The unsaved-text guard lets this link through: it acts on the page and leaves nothing.
    expect(html).toMatch(/<a\b[^>]*data-unsaved-ok="true"[^>]*>Load the latest version/)
  })

  it("says the group was not found once loading is over", () => {
    expect(renderToString(<NoteEditorScreen {...editorDefaults} group={null} loading />))
      .toContain("Loading the group...")
    expect(renderToString(<NoteEditorScreen {...editorDefaults} group={null} />)).toContain(
      "This group was not found.",
    )
  })

  it("says the note is loading while it is read", () => {
    const html = renderToString(<NoteEditorScreen {...editorDefaults} loading />)

    expect(html).toContain("Loading the note...")
    expect(html).not.toContain("<form")
  })
})

describe("NoteEditorScreen in the browser", () => {
  it("puts Save last in the form's footer: full width on a phone, at the right from sm up", async () => {
    await mount(<NoteEditorScreen {...editorDefaults} />)

    const save = find("[data-e2e=note-save]")
    const footer = save.parentElement!
    expect([...footer.children].map((child) => child.getAttribute("data-e2e")))
      .toEqual(["note-cancel", "note-save"])
    expect(save.className.split(" ")).toEqual(expect.arrayContaining(["w-full", "sm:w-auto"]))
    expect(footer.className.split(" ")).toEqual(
      expect.arrayContaining(["flex-col-reverse", "sm:flex-row", "sm:justify-end"]),
    )
  })

  it("reports the typed title and creates the note through the app's callbacks", async () => {
    const change = spy<[{ title: string; body: string }]>()
    const save = spy<[]>()
    await mount(<NoteEditorScreen {...editorDefaults} onChange={change.fn} onSave={save.fn} />)

    await type("[data-e2e=note-title]", "Trip")

    expect(change.calls).toEqual([[{ title: "Trip", body: "" }]])
    expect(await submit("[data-e2e=note-title]")).toBe(true)
    expect(save.calls).toHaveLength(1)
  })

  it("asks before deleting from the page's menu, and deletes only when the person confirms", async () => {
    const remove = spy<[]>()
    await mount(<NoteEditorScreen {...editing} onDelete={remove.fn} />)

    await click("[data-e2e=note-menu]")
    await click("[data-e2e=note-delete]")
    expect(remove.calls).toEqual([])
    expect(find("[data-e2e=note-delete-dialog]").textContent).toContain("Delete this note?")

    await clickText("Delete", "[data-e2e=note-delete-dialog]")
    expect(remove.calls).toHaveLength(1)
  })

  it("deletes nothing when the person keeps the note", async () => {
    const remove = spy<[]>()
    await mount(<NoteEditorScreen {...editing} onDelete={remove.fn} />)
    await click("[data-e2e=note-menu]")
    await click("[data-e2e=note-delete]")

    await clickText("Keep it", "[data-e2e=note-delete-dialog]")

    expect(remove.calls).toEqual([])
    expect(count("[data-e2e=note-delete-dialog]")).toBe(0)
  })

  it("moves the note to the group the person picks in the page's menu", async () => {
    const move = spy<[string]>()
    await mount(<NoteEditorScreen {...editing} onMove={move.fn} />)

    await click("[data-e2e=note-menu]")
    await clickText("Move to Family")

    expect(move.calls).toEqual([[targets[0].id]])
  })

  it("moves focus to the title when it gets an error", async () => {
    await mount(<NoteEditorScreen {...editorDefaults} />)

    await rerender(
      <NoteEditorScreen {...editorDefaults} errors={{ title: "Enter a title", form: null }} />,
    )

    expect(focused()).toBe("note-title")
  })

  it("moves focus to the plan's refusal and follows its upgrade link through navigate", async () => {
    const navigate = spy<[string]>()
    const refusal: PlanRefusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: true,
    }
    await mount(<NoteEditorScreen {...editorDefaults} navigate={navigate.fn} />)

    await rerender(
      <NoteEditorScreen
        {...editorDefaults}
        navigate={navigate.fn}
        errors={{ title: null, form: "Upgrade", plan: refusal }}
      />,
    )

    expect(focused()).toBe("plan-refusal")
    expect(await click("[data-e2e=plan-refusal] a")).toBe(true)
    expect(navigate.calls).toEqual([[BILLING_PATHS.pricing(groupId)]])
  })

  it("disables Delete in the page's menu while a delete is pending", async () => {
    await mount(<NoteEditorScreen {...editing} deleting />)

    await click("[data-e2e=note-menu]")

    expect(find<HTMLButtonElement>("[data-e2e=note-delete]").disabled).toBe(true)
  })
})
