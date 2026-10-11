/**
 * The tags screen, and the tags on the notes screens: the filter on the list, the labels on its
 * rows and the picker on the note page. What a person does in a browser DOM (happy-dom): make,
 * rename, recolour and delete a tag, pick tags for a note, filter the list, and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { type NoteDraft, NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"
import { TagsScreen, type TagsScreenProps } from "./tags-screen.tsx"

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

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const team = { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002", name: "Team", canWrite: true }
const viewerOfTeam = { ...team, canWrite: false }
const urgent = { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112001", name: "Urgent", color: "red" as const }
const home = { id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112002", name: "Home", color: "blue" as const }
const tags = [urgent, home]
const groceries = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  title: "Groceries",
  body: "milk",
  version: 3,
  updatedAt: "2026-10-01T10:00:00.000Z",
  tagIds: [urgent.id, home.id],
}
const trip = {
  ...groceries,
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111005",
  title: "Trip",
  tagIds: [home.id],
}
const plan = { ...groceries, id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111006", title: "Plan", tagIds: [] }

const tagsDefaults: TagsScreenProps = {
  group: team,
  tags,
  loading: false,
  listError: null,
  form: null,
  errors: { name: null, form: null },
  saving: false,
  onNew: () => {},
  onEdit: () => {},
  onDelete: () => {},
}

const notesDefaults: NotesScreenProps = {
  group: team,
  notes: [groceries, trip, plan],
  loading: false,
  listError: null,
  tags,
  tagFilter: [],
  onTagFilterChange: () => {},
}

const editorDefaults: NoteEditorScreenProps = {
  group: team,
  loading: false,
  notFound: false,
  note: { id: groceries.id, version: 3, conflict: false },
  value: { title: "Groceries", body: "milk", tagIds: [urgent.id] },
  errors: { title: null, form: null },
  saving: false,
  deleting: false,
  tags,
}

describe("TagsScreen", () => {
  it("lists the tags, with New tag in the header, and a viewer gets the tags and no controls", async () => {
    await mount(<TagsScreen {...tagsDefaults} />)
    expect(count("[data-e2e=tag-list] li")).toBe(2)
    expect(find("[data-e2e=tag-new]").textContent).toContain("New tag")
    expect(count("[data-e2e=tag-menu]")).toBe(2)

    await rerender(<TagsScreen {...tagsDefaults} group={viewerOfTeam} />)
    expect(count("[data-e2e=tag-list] li")).toBe(2)
    expect(count("[data-e2e=tag-new]")).toBe(0)
    expect(count("[data-e2e=tag-edit]")).toBe(0)
    expect(count("[data-e2e=tag-menu]")).toBe(0)
    expect(count("[data-e2e=tags-read-only]")).toBe(1)
  })

  it("opens the form for a new tag and reports the typed name and the picked colour", async () => {
    const open = spy<[]>()
    await mount(<TagsScreen {...tagsDefaults} onNew={open.fn} />)
    await click("[data-e2e=tag-new]")
    expect(open.calls).toHaveLength(1)

    const change = spy<[{ id: string | null; name: string; color: string }]>()
    const form = { id: null, name: "", color: "gray" as const }
    await mount(<TagsScreen {...tagsDefaults} form={form} onFormChange={change.fn} />)
    await type("[data-e2e=tag-name]", "Errands")
    expect(change.calls).toEqual([[{ id: null, name: "Errands", color: "gray" }]])

    await click("[name=color][value=green]")
    expect(change.calls.at(-1)).toEqual([{ id: null, name: "", color: "green" }])
  })

  it("submits the form through the app's callback and keeps the browser from posting it", async () => {
    const save = spy<[]>()
    const form = { id: null, name: "Errands", color: "gray" as const }
    await mount(<TagsScreen {...tagsDefaults} form={form} onSave={save.fn} />)
    expect(await submit("[data-e2e=tag-name]")).toBe(true)
    expect(save.calls).toHaveLength(1)
  })

  it("opens a tag for renaming when its name is clicked, and shows the form as an edit", async () => {
    const edit = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} onEdit={edit.fn} />)
    await click(`[data-e2e=tag-${home.id}] [data-e2e=tag-edit]`)
    expect(edit.calls).toEqual([[home.id]])

    const form = { id: home.id, name: "Home", color: "blue" as const }
    await mount(<TagsScreen {...tagsDefaults} form={form} />)
    expect(find("[data-e2e=tag-dialog]").textContent).toContain("Edit tag")
    expect(find("[data-e2e=tag-save]").textContent).toContain("Save tag")
  })

  it("deletes a tag only after the person confirms, and says the notes stay", async () => {
    const remove = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} onDelete={remove.fn} />)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-menu]`)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-delete]`)
    expect(remove.calls).toEqual([])
    expect(find("[data-e2e=tag-delete-dialog]").textContent).toContain(
      "The notes stay as they are.",
    )

    await clickText("Delete", "[data-e2e=tag-delete-dialog]")
    expect(remove.calls).toEqual([[urgent.id]])
    expect(count("[data-e2e=tag-delete-dialog]")).toBe(0)
  })

  it("moves focus to the next row's menu, else the previous row's, else the New tag action, once a tag is deleted", async () => {
    const row = () => document.activeElement?.closest("li")?.getAttribute("data-e2e")
    const third = { ...home, id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112003", name: "Work" }
    const three = [urgent, home, third]
    const remove = async (id: string) => {
      await click(`[data-e2e=tag-${id}] [data-e2e=tag-menu]`)
      await click(`[data-e2e=tag-${id}] [data-e2e=tag-delete]`)
      await clickText("Delete", "[data-e2e=tag-delete-dialog]")
    }

    await mount(<TagsScreen {...tagsDefaults} tags={three} />)
    await remove(home.id)
    await rerender(<TagsScreen {...tagsDefaults} tags={[urgent, third]} />)
    expect([focused(), row()]).toEqual(["tag-menu", `tag-${third.id}`])

    await remove(third.id)
    await rerender(<TagsScreen {...tagsDefaults} tags={[urgent]} />)
    expect([focused(), row()]).toEqual(["tag-menu", `tag-${urgent.id}`])

    await remove(urgent.id)
    await rerender(<TagsScreen {...tagsDefaults} tags={[]} />)
    expect(focused()).toBe("tag-new")
  })

  it("deletes nothing when the person keeps the tag", async () => {
    const remove = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} onDelete={remove.fn} />)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-menu]`)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-delete]`)
    await clickText("Keep it", "[data-e2e=tag-delete-dialog]")
    expect(remove.calls).toEqual([])
    expect(count("[data-e2e=tag-delete-dialog]")).toBe(0)
  })

  it("puts focus on the name field when the name is refused, and shows the message there", async () => {
    const form = { id: null, name: "Home", color: "gray" as const }
    await mount(<TagsScreen {...tagsDefaults} form={form} />)
    await rerender(
      <TagsScreen {...tagsDefaults} form={form} errors={{ name: "Taken.", form: null }} />,
    )
    expect(focused()).toBe("tag-name")
    expect(find("[data-e2e=tag-name]").getAttribute("aria-describedby")).toBeTruthy()
    expect(find("[data-e2e=tag-dialog]").textContent).toContain("Taken.")
  })

  it("shows the list's message above the tags when no dialog is open", async () => {
    const message = "Someone changed this tag. Their version is shown."
    await mount(<TagsScreen {...tagsDefaults} listError={message} />)
    expect(count("[data-e2e=tag-dialog]")).toBe(0)
    expect(document.body.textContent).toContain(message)
  })

  it("refuses a second submit while the tag is saving", async () => {
    const save = spy<[]>()
    const form = { id: null, name: "Errands", color: "gray" as const }
    await mount(<TagsScreen {...tagsDefaults} form={form} saving onSave={save.fn} />)
    await submit("[data-e2e=tag-name]")
    expect(save.calls).toHaveLength(0)
  })

  it("invites an editor to make the first tag, and a viewer to nothing", async () => {
    await mount(<TagsScreen {...tagsDefaults} tags={[]} />)
    expect(count("[data-e2e=tag-new-empty]")).toBe(1)
    await rerender(<TagsScreen {...tagsDefaults} tags={[]} group={viewerOfTeam} />)
    expect(count("[data-e2e=tag-new-empty]")).toBe(0)
  })
})

describe("NotesScreen tags", () => {
  const row = (note: { id: string }) => `[data-e2e=note-${note.id}]`

  it("labels each note with its tags and leaves an untagged note bare", async () => {
    await mount(<NotesScreen {...notesDefaults} />)
    expect(find(`${row(groceries)} [data-e2e=note-tags]`).textContent).toContain("Urgent")
    expect(count(`${row(trip)} [data-e2e=note-tag]`)).toBe(1)
    expect(count(`${row(plan)} [data-e2e=note-tags]`)).toBe(0)
  })

  it("shows only the notes that have every filtered tag", async () => {
    await mount(<NotesScreen {...notesDefaults} tagFilter={[home.id]} />)
    expect(count(row(groceries))).toBe(1)
    expect(count(row(trip))).toBe(1)
    expect(count(row(plan))).toBe(0)

    await rerender(<NotesScreen {...notesDefaults} tagFilter={[home.id, urgent.id]} />)
    expect(count(row(groceries))).toBe(1)
    expect(count(row(trip))).toBe(0)
  })

  it("reports the filter the person picks, and says so when no note has the tags", async () => {
    const change = spy<[string[]]>()
    await mount(<NotesScreen {...notesDefaults} onTagFilterChange={change.fn} />)
    await clickText("Urgent", "[data-e2e=notes-tag-filter]")
    expect(change.calls).toEqual([[[urgent.id]]])

    const clear = spy<[string[]]>()
    await mount(
      <NotesScreen
        {...notesDefaults}
        notes={[plan]}
        tagFilter={[urgent.id]}
        onTagFilterChange={clear.fn}
      />,
    )
    expect(find("body").textContent).toContain("No notes have all these tags.")
    await click("[data-e2e=notes-tag-filter-clear]")
    expect(clear.calls).toEqual([[[]]])
  })

  it("ignores a filtered tag that no longer exists instead of hiding every note", async () => {
    await mount(<NotesScreen {...notesDefaults} tagFilter={["gone"]} />)
    expect(count(row(groceries))).toBe(1)
    expect(count(row(plan))).toBe(1)
  })

  it("offers the tags page from the header's menu", async () => {
    await mount(<NotesScreen {...notesDefaults} />)
    expect(count("[data-e2e=notes-tags]")).toBe(1)
  })
})

describe("NoteEditorScreen tags", () => {
  it("shows the group's tags as a picker and reports the tags the person ticks", async () => {
    const change = spy<[NoteDraft]>()
    await mount(<NoteEditorScreen {...editorDefaults} onChange={change.fn} />)
    await clickText("Home", "[data-e2e=note-tags-picker]")
    expect(change.calls).toEqual([[{
      title: "Groceries",
      body: "milk",
      tagIds: [urgent.id, home.id],
    }]])
  })

  it("takes a tag off when the person unticks it", async () => {
    const change = spy<[NoteDraft]>()
    await mount(<NoteEditorScreen {...editorDefaults} onChange={change.fn} />)
    await clickText("Urgent", "[data-e2e=note-tags-picker]")
    expect(change.calls[0][0].tagIds).toEqual([])
  })

  it("offers no picker in a group without tags, and a viewer sees the labels only", async () => {
    await mount(<NoteEditorScreen {...editorDefaults} tags={[]} />)
    expect(count("[data-e2e=note-tags-picker]")).toBe(0)

    await mount(<NoteEditorScreen {...editorDefaults} group={viewerOfTeam} />)
    expect(count("[data-e2e=note-tags-picker]")).toBe(0)
    expect(find("[data-e2e=note-tags]").textContent).toContain("Urgent")
  })
})
