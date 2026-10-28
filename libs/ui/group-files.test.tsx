/**
 * The group file screens driven in a browser DOM (happy-dom): the import page in each of its
 * steps, where focus goes as the steps change, and the menu items that lead to an export and to
 * the import page. The SPA draws these screens only, so every test runs them with their callbacks.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { GROUP_IMPORT_MAX_BYTES, GroupRole } from "@domain/groups"
import { type GroupDraft, GroupEditorScreen } from "./group-editor-screen.tsx"
import {
  fileContents,
  GroupImportScreen,
  type GroupImportScreenProps,
  type GroupImportState,
  problemText,
} from "./group-import-screen.tsx"
import { GroupsScreen } from "./groups-screen.tsx"
import { GROUP_PATHS } from "./progressive.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import appEn from "@i18n/app/en.json" with { type: "json" }

/** The screens' English, as an app without another language reads it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: appEn }] })

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
  DataTransfer: globalThis.DataTransfer,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
    // The file picker writes the chosen file back onto its input through a DataTransfer.
    DataTransfer: window.DataTransfer,
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

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return root?.querySelector(selector) != null
}

function texts(selector: string): string[] {
  return [...root!.querySelectorAll(selector)].map((element) => element.textContent!.trim())
}

async function click(selector: string): Promise<void> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    find(selector).dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")
  if (!form) throw new Error(`no form around ${selector}`)
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** Picks `file` in the page's file input the way the browser does: its files change, then `change`. */
async function pick(file: File): Promise<void> {
  const input = find<HTMLInputElement>("input[type=file]")
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: [file] })
  await act(() => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
  })
}

function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const parts = [
  { kind: "notes", count: 124, one: "note", other: "notes" },
  { kind: "tags", count: 1, one: "tag", other: "tags" },
]
const checked: GroupImportState = { step: "checked", summary: { name: "Family", parts } }

describe("GroupImportScreen", () => {
  const defaults: GroupImportScreenProps = {
    state: { step: "choose" },
    name: "",
    maxBytes: GROUP_IMPORT_MAX_BYTES,
  }

  it("asks for a file with its size limit, and hands the chosen one to the app", async () => {
    const chosen = spy<[File | null]>()
    await mount(<GroupImportScreen {...defaults} onFile={chosen.fn} />)
    expect(find("[data-e2e=group-import-title]").textContent).toBe("Import a group")
    expect(root!.textContent).toContain("A .json file exported from a group, up to 5 MB.")
    expect(has("[data-e2e=group-import-heading]")).toBe(false)
    const file = new window.File(["{}"], "family.json", {
      type: "application/json",
    }) as unknown as File
    await pick(file)
    expect(chosen.calls.at(-1)?.[0]?.name).toBe("family.json")
  })

  it("hands a file over the limit to the app and says the size only once", async () => {
    const chosen = spy<[File | null]>()
    await mount(<GroupImportScreen {...defaults} maxBytes={4} onFile={chosen.fn} />)
    await pick(
      new window.File(["12345"], "big.json", { type: "application/json" }) as unknown as File,
    )
    expect(chosen.calls.at(-1)?.[0]?.name).toBe("big.json")
    await rerender(
      <GroupImportScreen
        {...defaults}
        maxBytes={4}
        state={{ step: "refused", problems: [{ kind: "too_large", maxBytes: 4 }], total: 1 }}
      />,
    )
    expect(root!.textContent!.split("The file is larger than").length - 1).toBe(1)
  })

  it("says it is checking, then moves focus to what the file holds and prefills the name", async () => {
    await mount(<GroupImportScreen {...defaults} state={{ step: "checking" }} />)
    expect(find("[data-e2e=group-import-status]").textContent).toBe("Checking the file…")
    expect(focused()).toBe("group-import-heading")
    await rerender(<GroupImportScreen {...defaults} state={checked} name="Family" />)
    expect(find("[data-e2e=group-import-heading]").textContent).toBe(
      "Contains: 124 notes, 1 tag, settings.",
    )
    expect(focused()).toBe("group-import-heading")
    expect(find<HTMLInputElement>("[data-e2e=group-import-name]").value).toBe("Family")
  })

  it("imports through the app's callback with the name the person typed", async () => {
    const named = spy<[string]>()
    const imported = spy<[]>()
    await mount(
      <GroupImportScreen
        {...defaults}
        state={checked}
        name="Family"
        onNameChange={named.fn}
        onImport={imported.fn}
      />,
    )
    const field = find<HTMLInputElement>("[data-e2e=group-import-name]")
    field.value = "Family copy"
    await act(() => {
      field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
    })
    expect(named.calls.at(-1)).toEqual(["Family copy"])
    expect(await submit("[data-e2e=group-import-submit]")).toBe(true)
    expect(imported.calls).toHaveLength(1)
  })

  it("refuses a second submit while importing, and says a failed import saved nothing", async () => {
    const imported = spy<[]>()
    await mount(
      <GroupImportScreen {...defaults} state={checked} name="F" importing onImport={imported.fn} />,
    )
    expect(find<HTMLButtonElement>("[data-e2e=group-import-submit]").textContent).toContain(
      "Importing…",
    )
    await submit("[data-e2e=group-import-submit]")
    expect(imported.calls).toHaveLength(0)
    await rerender(<GroupImportScreen {...defaults} state={checked} name="F" importFailed />)
    expect(find("[data-e2e=group-import-failed]").textContent).toContain(
      "The import stopped and nothing was saved. Try again.",
    )
  })

  it("lists why a file was refused, five at most and how many more, with Choose another file", async () => {
    const problems = Array.from({ length: 7 }, (_, index) => ({
      kind: "invalid" as const,
      where: `Note ${index + 1}`,
      problem: "title must be a string",
    }))
    const another = spy<[]>()
    await mount(
      <GroupImportScreen
        {...defaults}
        state={{ step: "refused", problems, total: 23 }}
        onChooseAnother={another.fn}
      />,
    )
    expect(focused()).toBe("group-import-heading")
    expect(find("[data-e2e=group-import-heading]").textContent).toBe(
      "This file cannot be imported. Nothing was written.",
    )
    expect(texts("[data-e2e=group-import-problem]")).toHaveLength(5)
    expect(texts("[data-e2e=group-import-problem]")[0]).toBe("Note 1: title must be a string.")
    expect(find("[data-e2e=group-import-more]").textContent).toBe("and 18 more")
    expect(has("[data-e2e=group-import-submit]")).toBe(false)
    await click("[data-e2e=group-import-choose-another]")
    expect(another.calls).toHaveLength(1)
  })

  it("says a single reason as a sentence, not a list of one", async () => {
    await mount(
      <GroupImportScreen
        {...defaults}
        state={{ step: "refused", problems: [{ kind: "newer_version" }], total: 1 }}
      />,
    )
    expect(find("[data-e2e=group-import-problem]").tagName).toBe("P")
    expect(has("[data-e2e=group-import-refused] ul")).toBe(false)
  })

  it("moves focus to the new, empty picker when the page starts over", async () => {
    await mount(
      <GroupImportScreen {...defaults} state={{ step: "refused", problems: [], total: 0 }} />,
    )
    await rerender(<GroupImportScreen {...defaults} attempt={1} />)
    // A boolean, not the two nodes: a failed check would print a diff of two DOM trees.
    expect(document.activeElement === find("input[type=file]")).toBe(true)
  })

  it("explains a file over a new group's plan with the cap and the file's count", async () => {
    await mount(
      <GroupImportScreen
        {...defaults}
        state={{
          step: "plan",
          refusal: {
            code: "PLAN_LIMIT_REACHED",
            entitlement: "maxNotes",
            limit: 10,
            canUpgrade: true,
          },
          notes: 124,
        }}
      />,
    )
    expect(find("[data-e2e=plan-refusal]").textContent).toContain(
      "A new group starts on the free plan, which holds up to 10 notes. This file has 124.",
    )
    expect(has("[data-e2e=group-import-choose-another]")).toBe(true)
  })

  it("offers to check again after a check that did not answer, except offline", async () => {
    const retried = spy<[]>()
    await mount(
      <GroupImportScreen {...defaults} state={{ step: "unchecked" }} onRetryCheck={retried.fn} />,
    )
    await click("[data-e2e=group-import-retry]")
    expect(retried.calls).toHaveLength(1)
    await rerender(
      <GroupImportScreen
        {...defaults}
        state={{ step: "unchecked" }}
        offline
        onRetryCheck={retried.fn}
      />,
    )
    expect(find<HTMLButtonElement>("[data-e2e=group-import-retry]").disabled).toBe(true)
    expect(has("[data-e2e=group-import-offline]")).toBe(true)
  })

  it("keeps Import group disabled offline, with the offline notice in place of a failed import's", async () => {
    await mount(<GroupImportScreen {...defaults} state={checked} name="F" importFailed offline />)
    expect(find<HTMLButtonElement>("[data-e2e=group-import-submit]").disabled).toBe(true)
    expect(has("[data-e2e=group-import-offline]")).toBe(true)
    expect(has("[data-e2e=group-import-failed]")).toBe(false)
  })
})

describe("group file wording", () => {
  it("says a file's parts as a list and as a sentence", () => {
    expect(fileContents(EN, parts, "unit")).toBe("124 notes, 1 tag")
    expect(fileContents(EN, parts, "unit", true)).toBe("124 notes, 1 tag, settings")
    expect(fileContents(EN, [...parts, { kind: "x", count: 2, one: "x", other: "xs" }], "list"))
      .toBe("124 notes, 1 tag, and 2 xs")
  })

  it("says each refusal in words", () => {
    expect(problemText(EN, { kind: "not_export" })).toBe("This is not a group export file.")
    expect(problemText(EN, { kind: "too_large", maxBytes: GROUP_IMPORT_MAX_BYTES })).toBe(
      "The file is larger than 5 MB.",
    )
    expect(problemText(EN, { kind: "newer_version" })).toContain("newer version of the app")
  })
})

describe("group file menu items", () => {
  const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
  const team = { id: groupId, name: "Team", role: GroupRole.OWNER }
  const draft: GroupDraft = { name: "Team", description: "", color: null, emoji: "" }
  const editor = (props: Partial<Parameters<typeof GroupEditorScreen>[0]> = {}) => (
    <GroupEditorScreen
      group={team}
      current
      loading={false}
      value={draft}
      onExport={() => {}}
      {...props}
    />
  )

  it("gives only the owner Export group…, and exports through the app's callback", async () => {
    const exported = spy<[]>()
    await mount(editor({ onExport: exported.fn }))
    expect(find("[data-e2e=group-export]").textContent).toContain("Export group…")
    await click("[data-e2e=group-export]")
    expect(exported.calls).toHaveLength(1)
    for (const role of [GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.VIEWER]) {
      await rerender(editor({ group: { ...team, role } }))
      expect(has("[data-e2e=group-export]")).toBe(false)
    }
  })

  it("disables Export group… offline with the reason, and says Preparing… while it runs", async () => {
    await mount(editor({ offline: true }))
    expect(find<HTMLButtonElement>("[data-e2e=group-export]").disabled).toBe(true)
    expect(find("[data-e2e=group-export-why]").textContent).toBe("You are offline")
    await rerender(editor({ exporting: true }))
    expect(find<HTMLButtonElement>("[data-e2e=group-export]").disabled).toBe(true)
    expect(find("[data-e2e=group-export]").textContent).toContain("Preparing…")
  })

  it("says a failed export changed nothing, with Try again", async () => {
    const exported = spy<[]>()
    await mount(editor({ exportFailed: true, onExport: exported.fn }))
    expect(find("[data-e2e=group-export-failed]").textContent).toContain(
      "We could not prepare the file. Nothing in your group changed.",
    )
    await click("[data-e2e=group-export-failed] button")
    expect(exported.calls).toHaveLength(1)
  })

  it("puts Import a group… in the groups page's menu, leaving New group the one primary action", async () => {
    await mount(<GroupsScreen groups={[team]} selectedId={groupId} loading={false} error={null} />)
    const item = find("[data-e2e=group-import-open]")
    expect(item.getAttribute("href")).toBe(GROUP_PATHS.import)
    expect(item.textContent).toContain("Import a group…")
    expect(find("[data-e2e=groups-menu]")).toBeTruthy()
  })
})
