/**
 * The tags list, the tag editor, and the tags on the notes screens: the filter on the list, the
 * labels on its rows and the picker on the note page. What a person does in a browser DOM
 * (happy-dom): make, rename, recolour and delete a tag, pick tags for a note, filter the list, and
 * where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { NoteEditorScreen, type NoteEditorScreenProps } from "./note-editor-screen.tsx"
import { type NoteDraft, NotesScreen, type NotesScreenProps } from "./notes-screen.tsx"
import { TAG_PATHS } from "./progressive.tsx"
import { TagEditorScreen, type TagEditorScreenProps } from "./tag-editor-screen.tsx"
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
  it("heads the page as a main destination, with no back arrow to the notes", async () => {
    await mount(<TagsScreen {...tagsDefaults} />)
    expect(find("h1").textContent).toBe("Tags")
    expect(count("[data-e2e=page-back]")).toBe(0)
    expect(find("body").textContent).not.toContain("Back to notes")
  })

  it("draws an empty list as a message inside a solid card, not a dashed box", async () => {
    await mount(<TagsScreen {...tagsDefaults} tags={[]} />)
    const empty = find("[role=status]")
    expect(empty.textContent).toContain("No tags yet")
    expect(empty.closest(".pc-card")).not.toBeNull()
    expect(empty.className.split(" ")).not.toContain("border-dashed")
  })

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

  it("opens the create page from New tag and from the empty list, through the app's router", async () => {
    const navigate = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} navigate={navigate.fn} />)
    expect(find("[data-e2e=tag-new]").getAttribute("href")).toBe(TAG_PATHS.new)
    expect(await click("[data-e2e=tag-new]")).toBe(true)

    await mount(<TagsScreen {...tagsDefaults} tags={[]} navigate={navigate.fn} />)
    expect(find("[data-e2e=tag-new-empty]").getAttribute("href")).toBe(TAG_PATHS.new)
    expect(await click("[data-e2e=tag-new-empty]")).toBe(true)
    expect(navigate.calls).toEqual([[TAG_PATHS.new], [TAG_PATHS.new]])
    expect(count("[data-e2e=tag-dialog]")).toBe(0)
  })

  it("links each tag's name to its editor, named Edit and the tag's name", async () => {
    const navigate = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} navigate={navigate.fn} />)
    const link = find(`[data-e2e=tag-${home.id}] [data-e2e=tag-edit]`)
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe(TAG_PATHS.tag(home.id))
    expect(link.getAttribute("aria-label")).toBe("Edit Home")
    expect(await clickOn(link)).toBe(true)
    expect(navigate.calls).toEqual([[`/tags/${home.id}`]])
  })

  it("offers Edit tag in each row's menu, leading to the tag's page through the app's router", async () => {
    const navigate = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} navigate={navigate.fn} />)
    await click(`[data-e2e=tag-${home.id}] [data-e2e=tag-menu]`)
    const edit = find(`[data-e2e=tag-${home.id}] [data-e2e=tag-menu-edit]`)
    expect(edit.textContent?.trim()).toBe("Edit tag")
    expect(edit.getAttribute("href")).toBe(TAG_PATHS.tag(home.id))
    expect(await clickOn(edit)).toBe(true)
    expect(navigate.calls).toEqual([[TAG_PATHS.tag(home.id)]])
  })

  it("deletes a tag only after the person confirms, and says the notes stay", async () => {
    const remove = spy<[string]>()
    await mount(<TagsScreen {...tagsDefaults} onDelete={remove.fn} />)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-menu]`)
    await click(`[data-e2e=tag-${urgent.id}] [data-e2e=tag-delete]`)
    expect(remove.calls).toEqual([])
    const dialog = find("[data-e2e=tag-delete-dialog]").textContent
    expect(dialog).toContain(`Delete "Urgent"?`)
    expect(dialog).toContain("The notes stay as they are.")

    await clickText("Delete tag", "[data-e2e=tag-delete-dialog]")
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
      await clickText("Delete tag", "[data-e2e=tag-delete-dialog]")
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
    await clickText("Cancel", "[data-e2e=tag-delete-dialog]")
    expect(remove.calls).toEqual([])
    expect(count("[data-e2e=tag-delete-dialog]")).toBe(0)
  })

  it("shows the list's message above the tags", async () => {
    const message = "Could not delete the tag"
    await mount(<TagsScreen {...tagsDefaults} listError={message} />)
    expect(document.body.textContent).toContain(message)
  })

  it("invites an editor to make the first tag, and a viewer to nothing", async () => {
    await mount(<TagsScreen {...tagsDefaults} tags={[]} />)
    expect(count("[data-e2e=tag-new-empty]")).toBe(1)
    await rerender(<TagsScreen {...tagsDefaults} tags={[]} group={viewerOfTeam} />)
    expect(count("[data-e2e=tag-new-empty]")).toBe(0)
  })
})

const tagEditorDefaults: TagEditorScreenProps = {
  group: team,
  loading: false,
  notFound: false,
  tag: null,
  value: { name: "", color: "gray" },
  errors: { name: null, form: null },
  saving: false,
  dirty: false,
}

/** The editor of the saved tag Home, as the app draws it once the tag is read. */
const editHome: TagEditorScreenProps = {
  ...tagEditorDefaults,
  tag: home,
  value: { name: home.name, color: home.color },
  onDelete: () => {},
}

describe("TagEditorScreen", () => {
  it("titles the create page New tag, with Create tag and a Cancel that leads back to the tags", async () => {
    const navigate = spy<[string]>()
    await mount(<TagEditorScreen {...tagEditorDefaults} navigate={navigate.fn} />)
    expect(find("h1").textContent).toBe("New tag")
    expect(find("[data-e2e=tags-group]").textContent).toBe("Team")
    expect(find("[data-e2e=tag-save]").textContent).toBe("Create tag")
    expect(find("[data-e2e=page-back]").getAttribute("href")).toBe(TAG_PATHS.list)
    expect(count("[data-e2e=tag-editor-menu]")).toBe(0)
    expect(find("body").textContent).toContain("Everyone in Team sees this tag.")
    expect(await click("[data-e2e=tag-cancel]")).toBe(true)
    expect(navigate.calls).toEqual([[TAG_PATHS.list]])
  })

  it("names the colours in British English, Grey first", async () => {
    await mount(<TagEditorScreen {...tagEditorDefaults} />)
    const labels = [...document.querySelectorAll("[data-e2e=tag-color] label")]
      .map((label) => label.textContent?.trim())
    expect(labels).toEqual(["Grey", "Red", "Orange", "Green", "Blue", "Purple"])
    expect(find("[data-e2e=tag-color] legend").textContent).toBe("Colour")
  })

  it("reports the typed name and the picked colour", async () => {
    const change = spy<[{ name: string; color: string }]>()
    await mount(<TagEditorScreen {...tagEditorDefaults} onChange={change.fn} />)
    await type("[data-e2e=tag-name]", "Errands")
    expect(change.calls).toEqual([[{ name: "Errands", color: "gray" }]])

    await click("[name=color][value=green]")
    expect(change.calls.at(-1)).toEqual([{ name: "", color: "green" }])
  })

  it("submits through the app's callback and keeps the browser from posting the form", async () => {
    const save = spy<[]>()
    const value = { name: "Errands", color: "gray" as const }
    await mount(<TagEditorScreen {...tagEditorDefaults} value={value} onSave={save.fn} />)
    expect(await submit("[data-e2e=tag-name]")).toBe(true)
    expect(save.calls).toHaveLength(1)
  })

  it("refuses a second submit while the tag is being created, and says Creating…", async () => {
    const save = spy<[]>()
    const value = { name: "Errands", color: "gray" as const }
    await mount(<TagEditorScreen {...tagEditorDefaults} value={value} saving onSave={save.fn} />)
    await submit("[data-e2e=tag-name]")
    expect(save.calls).toHaveLength(0)
    expect(find("[data-e2e=tag-save]").textContent).toContain("Creating…")
  })

  it("titles an existing tag's page with its saved name, not the one being typed", async () => {
    await mount(<TagEditorScreen {...editHome} value={{ name: "Hom", color: "blue" }} dirty />)
    expect(find("h1").textContent).toBe("Home")
    expect(find<HTMLInputElement>("[data-e2e=tag-name]").value).toBe("Hom")
  })

  it("shows Save tag and Cancel on an existing tag only once a field changed, and Cancel puts it back", async () => {
    const revert = spy<[]>()
    await mount(<TagEditorScreen {...editHome} onRevert={revert.fn} />)
    expect(count("[data-e2e=tag-save]")).toBe(0)
    expect(count("[data-e2e=tag-cancel]")).toBe(0)

    await rerender(
      <TagEditorScreen
        {...editHome}
        value={{ name: "Hom", color: "blue" }}
        dirty
        onRevert={revert.fn}
      />,
    )
    expect(find("[data-e2e=tag-save]").textContent).toBe("Save tag")
    await click("[data-e2e=tag-cancel]")
    expect(revert.calls).toHaveLength(1)
  })

  it("puts focus on the name field when the name is refused, and ties the message to it", async () => {
    const value = { name: "Home", color: "gray" as const }
    await mount(<TagEditorScreen {...tagEditorDefaults} value={value} />)
    await rerender(
      <TagEditorScreen
        {...tagEditorDefaults}
        value={value}
        errors={{ name: "Taken.", form: null }}
      />,
    )
    expect(focused()).toBe("tag-name")
    const described = find("[data-e2e=tag-name]").getAttribute("aria-describedby") ?? ""
    const ids = described.split(" ").filter(Boolean)
    expect(ids.map((id) => document.getElementById(id)?.textContent).join(" ")).toContain("Taken.")
  })

  it("shows an error that no field owns under the form", async () => {
    await mount(
      <TagEditorScreen
        {...editHome}
        errors={{ name: null, form: "Could not save the tag. Try again." }}
      />,
    )
    const form = find("form")
    expect(form.textContent).toContain("Could not save the tag. Try again.")
  })

  it("deletes the tag from the page's menu only after the person confirms", async () => {
    const remove = spy<[]>()
    await mount(<TagEditorScreen {...editHome} onDelete={remove.fn} />)
    await click("[data-e2e=tag-editor-menu]")
    await click("[data-e2e=tag-editor-delete]")
    expect(remove.calls).toEqual([])
    const dialog = find("[data-e2e=tag-delete-dialog]").textContent
    expect(dialog).toContain(`Delete "Home"?`)
    expect(dialog).toContain("The notes stay as they are.")

    await clickText("Cancel", "[data-e2e=tag-delete-dialog]")
    expect(remove.calls).toEqual([])

    await click("[data-e2e=tag-editor-menu]")
    await click("[data-e2e=tag-editor-delete]")
    await clickText("Delete tag", "[data-e2e=tag-delete-dialog]")
    expect(remove.calls).toHaveLength(1)
  })

  it("says the tag does not exist, with the way back to the tags", async () => {
    await mount(<TagEditorScreen {...tagEditorDefaults} notFound />)
    const missing = find("[data-e2e=tag-not-found]")
    expect(missing.textContent).toContain("This tag does not exist.")
    expect(missing.textContent).toContain("It may have been deleted.")
    expect(missing.querySelector("a")?.getAttribute("href")).toBe(TAG_PATHS.list)
    expect(count("form")).toBe(0)
  })

  it("draws a placeholder for the form only after 300 ms, so a quick read never flickers, and says it is loading", async () => {
    await mount(<TagEditorScreen {...tagEditorDefaults} loading />)
    expect(find("h1").textContent).toBe("Tag")
    expect(count("[data-e2e=tag-loading]")).toBe(0)
    expect(count("form")).toBe(0)
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(count("[data-e2e=tag-loading]")).toBe(0)
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)))
    expect(find("[data-e2e=tag-loading] [role=status]").textContent).toBe("Loading the tag…")
    // The placeholder is the library's skeleton, which a screen reader skips.
    expect(count("[data-e2e=tag-loading] [aria-hidden=true] .animate-pulse")).toBeGreaterThan(0)
  })

  it("moves focus to the name field when Cancel takes the footer away", async () => {
    const changed = { name: "Hom", color: "blue" as const }
    await mount(<TagEditorScreen {...editHome} value={changed} dirty />)
    find("[data-e2e=tag-cancel]").focus()
    await rerender(<TagEditorScreen {...editHome} />)
    expect(count("[data-e2e=tag-cancel]")).toBe(0)
    expect(focused()).toBe("tag-name")
  })

  it("moves focus to the name field once a save went through, not while it is still running", async () => {
    const changed = { name: "Hom", color: "blue" as const }
    await mount(<TagEditorScreen {...editHome} value={changed} dirty />)
    find("[data-e2e=tag-save]").focus()
    await rerender(<TagEditorScreen {...editHome} value={changed} saving />)
    expect(focused()).not.toBe("tag-name")
    await rerender(<TagEditorScreen {...editHome} value={changed} />)
    expect(focused()).toBe("tag-name")
  })

  it("leaves focus in the fields when typing puts the saved name back", async () => {
    await mount(<TagEditorScreen {...editHome} value={{ name: "Hom", color: "blue" }} dirty />)
    find("[name=color][value=red]").focus()
    await rerender(<TagEditorScreen {...editHome} />)
    expect(document.activeElement?.getAttribute("value")).toBe("red")
  })

  it("does nothing on Enter in an existing tag with nothing changed", async () => {
    const save = spy<[]>()
    await mount(<TagEditorScreen {...editHome} onSave={save.fn} />)
    await submit("[data-e2e=tag-name]")
    expect(save.calls).toHaveLength(0)
  })

  it("keeps the fields to a form's width, with the footer under them, on a wide column", async () => {
    await mount(<TagEditorScreen {...editHome} value={{ name: "Hom", color: "blue" }} dirty />)
    const column = find("[data-e2e=tag-name]").closest(".max-w-md")
    expect(column).not.toBeNull()
    expect(column?.contains(find("[data-e2e=tag-save]"))).toBe(true)
  })

  it("shows a viewer the tag read-only, with who may change it, and no actions", async () => {
    await mount(<TagEditorScreen {...editHome} group={viewerOfTeam} dirty />)
    expect(find("[data-e2e=tag-read-only]").textContent).toBe(
      "Only an editor can change tags in this group.",
    )
    expect(find<HTMLInputElement>("[data-e2e=tag-name]").closest("fieldset")?.disabled).toBe(true)
    expect(count("[data-e2e=tag-save]")).toBe(0)
    expect(count("[data-e2e=tag-editor-menu]")).toBe(0)
  })

  it("says the changes stay on the device while it is offline", async () => {
    await mount(<TagEditorScreen {...tagEditorDefaults} offline />)
    expect(find("[data-e2e=tag-offline]").textContent).toContain(
      "Your changes are saved on this device and sent when you are back online.",
    )
    await rerender(<TagEditorScreen {...tagEditorDefaults} />)
    expect(count("[data-e2e=tag-offline]")).toBe(0)
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

  it("opens the tags page from the header's menu through the app's router, not a page load", async () => {
    const navigate = spy<[string]>()
    await mount(<NotesScreen {...notesDefaults} navigate={navigate.fn} />)
    await click("[data-e2e=notes-menu]")
    expect(find("[data-e2e=notes-tags]").getAttribute("href")).toBe(TAG_PATHS.list)
    expect(await click("[data-e2e=notes-tags]")).toBe(true)
    expect(navigate.calls).toEqual([[TAG_PATHS.list]])
  })

  it("lays the filter out as one row that scrolls sideways on a phone and wraps from sm up", async () => {
    await mount(<NotesScreen {...notesDefaults} />)
    const row = find("[data-e2e=notes-tag-filter] [role=group]").className.split(" ")
    expect(row).toEqual(
      expect.arrayContaining(["flex-nowrap", "overflow-x-auto", "*:shrink-0", "sm:flex-wrap"]),
    )
    expect(row).not.toContain("flex-wrap")
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
