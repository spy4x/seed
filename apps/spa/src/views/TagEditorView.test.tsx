/**
 * The tag editor wired to the real stores, in a browser DOM (happy-dom): the form is built again
 * when the store drops it, so typing always reaches it, and a fresh read of the groups leaves the
 * form on screen. The group's tags are put in the store first, so the page never reads the server.
 */
import "@preact/signals"
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { GroupRole } from "@domain/groups"
import { groupsStore } from "../state/groups.ts"
import { selectionStore } from "../state/selection.ts"
import { type TagItem, tagsStore } from "../state/tags.ts"
import { TagEditorView } from "./TagEditorView.tsx"

const window = new Window({ url: "http://app.localhost/tags/new" })
const NAMES = ["document", "location", "history", "getComputedStyle"] as const
const own = Object.fromEntries(
  NAMES.map((name) => [name, (globalThis as Record<string, unknown>)[name]]),
)

beforeAll(() => {
  // Preact draws into `document`, the router reads `location` and `history`, and a dialog reads
  // the page's style.
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    history: window.history,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const home: TagItem = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002",
  groupId,
  name: "Home",
  color: "#1d4ed8",
  version: 1,
  changeSequence: "1",
  createdByUserId: 1,
  updatedByUserId: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
}

let root: HTMLElement | null = null

beforeEach(() => {
  groupsStore.groups.value = [{
    id: groupId,
    name: "Team",
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: "1",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }]
  groupsStore.loading.value = false
  selectionStore.groupId.value = groupId
  // The group is open already, so `open` returns at once and reads nothing.
  tagsStore.groupId.value = groupId
  tagsStore.tags.value = [home]
})

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  root?.remove()
  root = null
  tagsStore.reset()
  groupsStore.reset()
  selectionStore.groupId.value = null
})

async function mount(tagId: string | null): Promise<void> {
  root = window.document.createElement("div") as unknown as HTMLElement
  window.document.body.appendChild(root as never)
  await act(() => render(<TagEditorView tagId={tagId} />, root!))
}

/** The name field, or a failure saying the page shows none. */
function nameField(): HTMLInputElement {
  const field = root!.querySelector<HTMLInputElement>("[data-e2e=tag-name]")
  if (!field) throw new Error("the page shows no name field")
  return field
}

/** Types `value` into the name field the way a person does: the value changes, then `input`. */
async function typeName(value: string): Promise<void> {
  const field = nameField()
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

describe("TagEditorView", () => {
  it("builds the create form again after the store dropped it, so typing still reaches it", async () => {
    await mount(null)
    expect(tagsStore.form.value?.id).toBe(null)

    // A group change or a discard drops the form while the page stays open.
    await act(() => tagsStore.closeForm())
    await typeName("Work")

    expect(tagsStore.form.value?.name).toBe("Work")
    expect(tagsStore.unsaved.value).toBe(true)
  })

  it("builds the edit form again from the tag after the store dropped it", async () => {
    await mount(home.id)
    await act(() => tagsStore.closeForm())

    expect(tagsStore.form.value?.id).toBe(home.id)
    expect(nameField().value).toBe("Home")
    await typeName("House")
    expect(tagsStore.form.value?.name).toBe("House")
  })

  it("keeps the create form on screen while the groups are read again", async () => {
    await mount(null)
    await typeName("Work")

    // A reconnect reads the groups again; the person's group is known all along.
    await act(() => {
      groupsStore.loading.value = true
    })

    expect(nameField().value).toBe("Work")
    expect(tagsStore.form.value?.name).toBe("Work")
  })
})
