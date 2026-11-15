/**
 * The import pages driven in a browser DOM (happy-dom): the picker with its kind's limits and the
 * recent list, then one import in each of its states, the main button's checks, where focus goes,
 * and the confirmed undo. The SPA draws these screens only, so every test runs them with their
 * callbacks.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type ImportCheckResult, ImportStatus, type ImportSummary } from "@domain/imports"
import { NOTE_RESTORE_DAYS } from "@domain/notes"
import { importKindView } from "./import-kinds.ts"
import {
  IMPORT_MAPPER_ID,
  ImportNewScreen,
  type ImportNewScreenProps,
  ImportScreen,
  type ImportScreenProps,
} from "./import-screen.tsx"

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
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return document.querySelector(selector) != null
}

function texts(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((element) => element.textContent!.trim())
}

async function click(selector: string): Promise<void> {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    find(selector).dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")
  if (!form) throw new Error(`no form around ${selector}`)
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Picks `file` in the page's file input the way the browser does: its files change, then `change`. */
async function pick(file: File): Promise<void> {
  const input = find<HTMLInputElement>("input[type=file]")
  Object.defineProperty(input, "files", { configurable: true, writable: true, value: [file] })
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    // The picker says a refusal on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const NOTES = importKindView(`notes`, true)!

function summary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: `0190a000-0000-7000-8000-000000000001`,
    groupId: `0190a000-0000-7000-8000-0000000000aa`,
    kind: `notes`,
    status: ImportStatus.READY,
    userId: 1,
    fileName: `notes.csv`,
    fileSize: 120,
    fields: [
      { key: `title`, label: `Title`, required: true },
      { key: `body`, label: `Body` },
    ],
    preview: {
      columns: [`Title`, `Body`],
      sample: [[`First`, `one`], [``, `two`], [`Third`, `three`]],
      mapping: { title: 0, body: 1 },
    },
    rowCount: 30,
    savedCount: null,
    errorCount: null,
    skippedCount: null,
    options: null,
    failure: null,
    createdAt: new Date(`2026-11-15T10:00:00Z`),
    readAt: new Date(`2026-11-15T10:00:01Z`),
    failedAt: null,
    commitRequestedAt: null,
    committedAt: null,
    undoneAt: null,
    ...overrides,
  }
}

/** A check that refused the sample's second row and two rows further down. */
const CHECK: ImportCheckResult = {
  rowCount: 30,
  valid: 27,
  withErrors: 3,
  rows: [
    { row: 2, errors: [`Give the note a title.`] },
    { row: 9, errors: [`Give the note a title.`] },
    { row: 14, errors: [`The title is too long.`] },
  ],
}

function screen(overrides: Partial<ImportScreenProps> = {}): VNode {
  return (
    <ImportScreen
      kind={NOTES}
      groupName="Family"
      summary={summary()}
      mapping={{ title: 0, body: 1 }}
      check={CHECK}
      {...overrides}
    />
  )
}

function picker(overrides: Partial<ImportNewScreenProps> = {}): VNode {
  return <ImportNewScreen kind={NOTES} groupName="Family" recent={[]} {...overrides} />
}

describe("the import picker", () => {
  it("knows the notes kind only while the notes are on, and no unknown kind", () => {
    expect(NOTES.limits.id).toBe(`notes`)
    expect(importKindView(`notes`, false)).toBeNull()
    expect(importKindView(`bank`, true)).toBeNull()
    expect(importKindView(null, true)).toBeNull()
  })

  it("says the kind's limits and hands over a file of its type", async () => {
    const chosen: File[] = []
    await mount(picker({ onFile: (file) => chosen.push(file) }))
    expect(find(`#import-file`).getAttribute(`accept`)).toBe(`.csv,.txt`)
    expect(document.body.textContent).toContain(
      `A .csv or .txt file, up to 2 MB and 5,000 rows. The first row can name the columns.`,
    )
    await pick(new window.File([`Title\nA`], `notes.csv`, { type: `text/csv` }) as unknown as File)
    expect(chosen.map((file) => file.name)).toEqual([`notes.csv`])
  })

  it("refuses a file of another type itself, so it never reaches the app", async () => {
    const chosen: File[] = []
    await mount(picker({ onFile: (file) => chosen.push(file) }))
    await pick(
      new window.File([`{}`], `group.json`, { type: `application/json` }) as unknown as File,
    )
    expect(chosen).toEqual([])
    // The picker isolates the file's name (U+2068 … U+2069), so a right-to-left name stays whole.
    expect(document.body.textContent).toContain(`⁨group.json⁩ is not a .csv or .txt file.`)
  })

  it("shows a viewer why they cannot import, with no picker", async () => {
    await mount(picker({ forbidden: true }))
    expect(has(`input[type=file]`)).toBe(false)
    expect(find(`[data-e2e="import-viewer"]`).textContent).toContain(
      `You're a viewer in Family. Ask an admin or the owner for the editor role.`,
    )
  })

  it("lists the person's recent imports of this kind only, each a link to its page", async () => {
    await mount(picker({
      recent: [
        summary({ status: ImportStatus.COMMITTED }),
        summary({ id: `0190a000-0000-7000-8000-000000000002`, kind: `bank`, fileName: `bank.csv` }),
      ],
    }))
    expect(texts(`[data-e2e="import-recent-item"] bdi`)).toEqual([`notes.csv`])
    expect(find(`[data-e2e="import-recent-item"]`).getAttribute(`href`)).toBe(
      `/imports/0190a000-0000-7000-8000-000000000001`,
    )
    expect(find(`[data-e2e="import-recent-item"]`).textContent).toContain(`Imported`)
  })

  it("says which file is uploading and takes no second one meanwhile", async () => {
    await mount(picker({ uploading: `notes.csv` }))
    expect(find(`[data-e2e="import-upload"]`).textContent).toBe(`Uploading notes.csv…`)
    expect(find<HTMLInputElement>(`#import-file`).disabled).toBe(true)
  })
})

describe("one import, ready to save", () => {
  it("numbers lines as a spreadsheet does and puts the check's problems on them", async () => {
    await mount(screen())
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Match the columns`)
    // Row 2 of the data is line 3: the header is line 1.
    // The mapper marks the row and says its problem in a row under it.
    const problemRow = find(`#${IMPORT_MAPPER_ID}-line-3`).closest(`tr`)!
    expect(problemRow.textContent).toContain(`Problem`)
    expect(problemRow.nextElementSibling!.textContent).toContain(`Give the note a title.`)
    expect(find(`#${IMPORT_MAPPER_ID}-line-2`).closest(`tr`)!.textContent).toContain(`First`)
    expect(texts(`[data-e2e="import-line"]`)).toEqual([`10`, `15`])
    expect(texts(`[data-e2e="import-problem"]`)).toEqual([
      `Give the note a title.`,
      `The title is too long.`,
    ])
    expect(find(`[data-e2e="import-check"]`).textContent).toBe(`27 of 30 rows can be imported.`)
    expect(find(`[data-e2e="import-submit"]`).textContent).toContain(`Import 27 notes`)
  })

  it("counts lines from 1 when the file has no header", async () => {
    await mount(screen({
      summary: summary({ preview: { ...summary().preview!, columns: null } }),
    }))
    expect(texts(`[data-e2e="import-line"]`)).toEqual([`9`, `14`])
  })

  it("ends the list with how many refused rows the check did not list", async () => {
    await mount(screen({ check: { ...CHECK, withErrors: 140 } }))
    expect(find(`[data-e2e="import-more"]`).textContent).toBe(`and 137 more`)
  })

  it("moves focus to a required field left unmapped instead of saving", async () => {
    let commits = 0
    await mount(screen({ mapping: { title: null, body: 1 }, onCommit: () => commits++ }))
    await submit(`[data-e2e="import-submit"]`)
    expect(commits).toBe(0)
    expect(document.activeElement?.id).toBe(`${IMPORT_MAPPER_ID}-title`)
  })

  it("says every row has a problem instead of saving nothing", async () => {
    let commits = 0
    await mount(screen({ check: { ...CHECK, valid: 0 }, onCommit: () => commits++ }))
    await submit(`[data-e2e="import-submit"]`)
    expect(commits).toBe(0)
    expect(find(`[data-e2e="import-no-valid"]`).textContent).toContain(
      `Every row has a problem. Fix the file, or change the columns.`,
    )
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`import-no-valid`)
  })

  it("saves with the problems left in, since the server leaves those rows out", async () => {
    let commits = 0
    await mount(screen({ onCommit: () => commits++ }))
    await submit(`[data-e2e="import-submit"]`)
    expect(commits).toBe(1)
  })
})

describe("one import's other states", () => {
  it("tells a failed read from a failed save, each with its way on", async () => {
    await mount(screen({
      summary: summary({ status: ImportStatus.FAILED, failure: `The file has no rows.` }),
    }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Could not read this file`)
    expect(find(`[data-e2e="import-failure"]`).textContent).toBe(`The file has no rows.`)
    expect(find(`[data-e2e="import-another"]`).textContent).toBe(`Choose another file`)
    expect(find(`[data-e2e="import-another"]`).getAttribute(`href`)).toBe(
      `/imports/new?kind=notes`,
    )
    await rerender(screen({
      summary: summary({
        status: ImportStatus.FAILED,
        failure: `The plan has no room.`,
        commitRequestedAt: new Date(),
      }),
    }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Nothing was imported`)
    expect(find(`[data-e2e="import-another"]`).textContent).toBe(`Import another file`)
  })

  it("counts the save in progress from the last check, and says so without one", async () => {
    await mount(screen({ summary: summary({ status: ImportStatus.COMMITTING }) }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Importing 27 notes…`)
    expect(document.body.textContent).toContain(`You can leave this page. The import keeps going.`)
    await rerender(screen({ summary: summary({ status: ImportStatus.COMMITTING }), check: null }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Importing the notes…`)
  })

  it("moves focus to the heading when the step changes, not on the first one", async () => {
    await mount(screen({ summary: summary({ status: ImportStatus.READING }) }))
    expect(document.activeElement?.getAttribute(`data-e2e`)).not.toBe(`import-heading`)
    expect(find(`[data-e2e="import-status"]`).textContent).toBe(`Reading notes.csv…`)
    await rerender(screen())
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`import-heading`)
    expect(find(`[data-e2e="import-status"]`).textContent).toBe(`Match the columns`)
  })

  it("undoes a saved import only once the person confirms, in the kind's words", async () => {
    let undos = 0
    const saved = summary({ status: ImportStatus.COMMITTED, savedCount: 27, errorCount: 3 })
    await mount(screen({ summary: saved, onUndo: () => undos++ }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`27 notes imported`)
    expect(find(`[data-e2e="import-left-out"]`).textContent).toBe(
      `3 rows were left out because of problems.`,
    )
    expect(find(`[data-e2e="import-go"]`).getAttribute(`href`)).toBe(`/notes`)
    await click(`[data-e2e="import-undo"]`)
    const dialog = find(`[data-e2e="import-undo-dialog"]`)
    expect(dialog.textContent).toContain(`Delete the 27 notes from this import?`)
    expect(dialog.textContent).toContain(
      `anyone in the group can restore them for ${NOTE_RESTORE_DAYS} days`,
    )
    await click(`[data-e2e="confirm-dialog-cancel"]`)
    expect(undos).toBe(0)
    expect(has(`[data-e2e="import-undo-dialog"]`)).toBe(false)
    await click(`[data-e2e="import-undo"]`)
    await click(`[data-e2e="confirm-dialog-confirm"]`)
    expect(undos).toBe(1)
  })

  it("says where the undone records went, and offers to show them", async () => {
    let shown = 0
    await mount(screen({
      summary: summary({ status: ImportStatus.UNDONE, savedCount: 27 }),
      onShowRemoved: () => shown++,
    }))
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Import undone`)
    expect(find(`[data-e2e="import-undone"]`).textContent).toBe(`27 notes moved to deleted notes.`)
    await click(`[data-e2e="import-show-removed"]`)
    expect(shown).toBe(1)
  })

  it("shows a member whose role was lowered why the save was refused", async () => {
    await mount(screen({ forbidden: true }))
    expect(has(`[data-e2e="import-submit"]`)).toBe(false)
    expect(find(`[data-e2e="import-viewer"]`).textContent).toContain(`You can't import notes here`)
  })

  it("says offline why nothing can be saved, and the save button waits", async () => {
    await mount(screen({ offline: true }))
    expect(find(`[data-e2e="import-offline"]`).textContent).toContain(
      `You're offline. You need a connection to import a file.`,
    )
    expect(find<HTMLButtonElement>(`[data-e2e="import-submit"]`).disabled).toBe(true)
  })
})
