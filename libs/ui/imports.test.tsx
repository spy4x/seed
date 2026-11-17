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
import { type ImportKindView, importKindView } from "./import-kinds.ts"
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

const WORDS = { account: `Account` }
const ACCOUNTS = [[``, `Choose`], [`a1`, `Main`]]

/** A product's kind with upload options and a review, as a bank statement has. */
const BANK: ImportKindView = {
  ...NOTES,
  limits: { ...NOTES.limits, id: `bank` },
  options: {
    initial: { accountId: `` },
    // The test kind's own words come from a variable: the product's kind takes its catalog's.
    render: ({ value, onChange, disabled }) => (
      <label>
        {WORDS.account}
        <select
          id="bank-account"
          value={value.accountId}
          disabled={disabled}
          onChange={(event) => onChange({ accountId: event.currentTarget.value })}
        >
          {ACCOUNTS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
    ),
    ready: (value) => value.accountId !== ``,
  },
  review: {
    // A control for the category only: the transfer falls back to its suggestion as text.
    choice: (field, { id, label, value, onChange, disabled }) =>
      field === `category`
        ? (
          <select
            id={id}
            aria-label={label}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            {CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        )
        : undefined,
  },
}
const CATEGORIES = [``, `food`, `rent`]

/** A statement read with a header: date, amount and payee, and two choice fields. */
function bankSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return summary({
    kind: `bank`,
    fileName: `bank.csv`,
    fields: [
      { key: `date`, label: `Date`, required: true },
      { key: `amount`, label: `Amount`, required: true },
      { key: `payee`, label: `Payee` },
      { key: `category`, label: `Category`, choice: true },
      { key: `transfer`, label: `Transfer`, choice: true },
    ],
    preview: {
      columns: [`Date`, `Amount`, `Payee`],
      sample: [[`2026-11-01`, `-12.50`, `Cafe`]],
      mapping: { date: 0, amount: 1, payee: 2 },
    },
    rowCount: 3,
    ...overrides,
  })
}

/** Row 1 is saved, row 2 was saved before, row 3 matches a transfer the person may override. */
const REVIEWED: ImportCheckResult = {
  rowCount: 3,
  valid: 3,
  withErrors: 0,
  rows: [],
  reviews: [
    {
      row: 1,
      cells: [`2026-11-01`, `-12.50`, `Cafe`],
      skip: null,
      suggestions: { category: `food` },
      overridable: false,
    },
    {
      row: 2,
      cells: [`2026-11-02`, `-900.00`, `Landlord`],
      skip: `Saved before`,
      suggestions: {},
      overridable: false,
    },
    {
      row: 3,
      cells: [`2026-11-03`, `-50.00`, `Savings`],
      skip: `Matches a transfer`,
      suggestions: { transfer: `t1` },
      overridable: true,
    },
  ],
}

/** `count` reviewed rows, every one saved. */
function manyReviewed(count: number): ImportCheckResult {
  return {
    rowCount: count,
    valid: count,
    withErrors: 0,
    rows: [],
    reviews: Array.from({ length: count }, (_, index) => ({
      row: index + 1,
      cells: [`2026-11-01`, `-1.00`, `Payee ${index + 1}`],
      skip: null,
      suggestions: {},
      overridable: false,
    })),
  }
}

function bankScreen(overrides: Partial<ImportScreenProps> = {}): VNode {
  return screen({
    kind: BANK,
    summary: bankSummary(),
    mapping: { date: 0, amount: 1, payee: 2, category: null, transfer: null },
    check: REVIEWED,
    ...overrides,
  })
}

/** Presses the filter's segment named `name`. */
async function filterBy(name: string): Promise<void> {
  const segment = [...document.querySelectorAll(`[role=radio]`)]
    .find((element) => element.textContent!.trim() === name)
  if (!segment) throw new Error(`no segment ${name}`)
  await act(async () => {
    segment.dispatchEvent(new window.MouseEvent(`click`, { bubbles: true }) as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Sets a native select or checkbox the way a person does: the value, then `change`. */
async function change(selector: string, set: (element: HTMLInputElement) => void): Promise<void> {
  const element = find<HTMLInputElement>(selector)
  set(element)
  await act(async () => {
    element.dispatchEvent(new window.Event(`change`, { bubbles: true }) as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

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
    const chosen: [string, unknown][] = []
    await mount(picker({ onFile: (file, options) => chosen.push([file.name, options]) }))
    expect(find(`#import-file`).getAttribute(`accept`)).toBe(`.csv,.txt`)
    expect(document.body.textContent).toContain(
      `A .csv or .txt file, up to 2 MB and 5,000 rows. The first row can name the columns.`,
    )
    await pick(new window.File([`Title\nA`], `notes.csv`, { type: `text/csv` }) as unknown as File)
    expect(chosen).toEqual([[`notes.csv`, undefined]])
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

  it("shows the notes picker with no options form and the picker open", async () => {
    await mount(picker())
    expect(has(`[data-e2e="import-options"]`)).toBe(false)
    expect(find<HTMLInputElement>(`#import-file`).disabled).toBe(false)
    expect(document.body.textContent).not.toContain(`Fill in the fields above first.`)
  })

  it("refuses a file chosen before the kind's options are ready, then hands them on", async () => {
    const set: Record<string, string>[] = []
    const chosen: [string, unknown][] = []
    await mount(picker({
      kind: BANK,
      onOptions: (value) => set.push(value),
      onFile: (file, options) => chosen.push([file.name, options]),
    }))
    expect(find<HTMLSelectElement>(`#bank-account`).value).toBe(``)
    // The picker stays open, so it keeps its full contrast; a file chosen now is not uploaded.
    expect(find<HTMLInputElement>(`#import-file`).disabled).toBe(false)
    expect(find(`#import-file-hint`).textContent).toBe(
      `A .csv or .txt file, up to 2 MB and 5,000 rows. The first row can name the columns.`,
    )
    expect(has(`#import-file-error`)).toBe(false)
    const first = find<HTMLInputElement>(`#import-file`)
    await pick(new window.File([`Date\n1`], `bank.csv`, { type: `text/csv` }) as unknown as File)
    expect(chosen).toEqual([])
    // A fresh picker lists no file, so choosing the same one again fires a change.
    expect(find<HTMLInputElement>(`#import-file`)).not.toBe(first)
    expect(find(`#import-file-error`).textContent).toBe(`Fill in the fields above first.`)
    expect(document.activeElement?.id).toBe(`bank-account`)
    const account = find<HTMLSelectElement>(`#bank-account`)
    account.value = `a1`
    await act(() => {
      account.dispatchEvent(new window.Event(`change`, { bubbles: true }) as unknown as Event)
    })
    expect(set).toEqual([{ accountId: `a1` }])
    await rerender(picker({
      kind: BANK,
      options: { accountId: `a1` },
      onFile: (file, options) => chosen.push([file.name, options]),
    }))
    expect(has(`#import-file-error`)).toBe(false)
    await pick(new window.File([`Date\n1`], `bank.csv`, { type: `text/csv` }) as unknown as File)
    expect(chosen).toEqual([[`bank.csv`, { accountId: `a1` }]])
  })

  it("disables the kind's options while a file uploads", async () => {
    await mount(picker({ kind: BANK, options: { accountId: `a1` }, uploading: `bank.csv` }))
    expect(find<HTMLSelectElement>(`#bank-account`).disabled).toBe(true)
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

describe("one import's review", () => {
  it("shows no review for a check without one, as the notes have", async () => {
    await mount(screen())
    expect(has(`[data-e2e="import-review"]`)).toBe(false)
  })

  it("lists each reviewed row with its line, values, status and the kind's choices", async () => {
    await mount(bankScreen())
    expect(find(`#import-review`).textContent).toBe(`Check the rows`)
    expect(find(`[data-e2e="import-review-summary"]`).textContent).toBe(
      `1 to import · 2 skipped`,
    )
    // The header is line 1, so row 1 is line 2.
    expect(texts(`[data-e2e="import-review-line"]`)).toEqual([`Line 2`, `Line 3`, `Line 4`])
    expect(texts(`[data-e2e="import-review-row"] bdi`).slice(0, 3)).toEqual([
      `2026-11-01`,
      `-12.50`,
      `Cafe`,
    ])
    expect(texts(`[data-e2e="import-review-status"]`)).toEqual([
      `Will be imported`,
      `Saved before`,
      `Matches a transfer`,
    ])
    const category = find<HTMLSelectElement>(`#import-choice-1-category`)
    expect(category.value).toBe(`food`)
    expect(category.getAttribute(`aria-label`)).toBe(`Category, line 2`)
    // The kind draws no transfer control, and row 1 has no transfer suggestion: nothing shows.
    expect(has(`[data-e2e="import-suggestion"]`)).toBe(false)
    expect(find(`[data-e2e="import-submit"]`).textContent).toContain(`Import 1 note`)
  })

  it("offers Import anyway only on an overridable skip, with no choices on it", async () => {
    await mount(bankScreen())
    expect(has(`#import-keep-1`)).toBe(false)
    expect(has(`#import-keep-2`)).toBe(false)
    const keep = find<HTMLInputElement>(`#import-keep-3`)
    expect(keep.checked).toBe(false)
    expect(keep.getAttribute(`aria-label`)).toBe(`Import anyway, line 4`)
    expect(keep.closest(`label`)!.textContent).toBe(`Import anyway`)
    expect(has(`#import-choice-2-category`)).toBe(false)
    expect(has(`#import-choice-3-category`)).toBe(false)
  })

  it("keeps a row the person ticks, counts it, and shows its choices", async () => {
    const kept: [number, boolean][] = []
    await mount(bankScreen({ onKeep: (row, on) => kept.push([row, on]) }))
    await change(`#import-keep-3`, (box) => (box.checked = true))
    expect(kept).toEqual([[3, true]])
    await rerender(bankScreen({ keep: [3], onKeep: (row, on) => kept.push([row, on]) }))
    expect(find<HTMLInputElement>(`#import-keep-3`).checked).toBe(true)
    expect(find(`[data-e2e="import-review-summary"]`).textContent).toBe(`2 to import · 1 skipped`)
    expect(find(`[data-e2e="import-submit"]`).textContent).toContain(`Import 2 notes`)
    expect(has(`#import-choice-3-category`)).toBe(true)
    expect(texts(`[data-e2e="import-suggestion"]`)).toEqual([`t1`])
    await change(`#import-keep-3`, (box) => (box.checked = false))
    expect(kept).toEqual([[3, true], [3, false]])
  })

  it("hands on a changed choice and shows the person's value over the suggestion", async () => {
    const chosen: [number, string, string][] = []
    const onChoose = (row: number, field: string, value: string) => chosen.push([row, field, value])
    await mount(bankScreen({ onChoose }))
    await change(`#import-choice-1-category`, (select) => (select.value = `rent`))
    expect(chosen).toEqual([[1, `category`, `rent`]])
    await rerender(bankScreen({ onChoose, choices: { "1": { category: `rent` } } }))
    expect(find<HTMLSelectElement>(`#import-choice-1-category`).value).toBe(`rent`)
  })

  it("disables the review's controls while the save runs or offline", async () => {
    await mount(bankScreen({ keep: [3], offline: true }))
    expect(find<HTMLInputElement>(`#import-keep-3`).disabled).toBe(true)
    expect(find<HTMLSelectElement>(`#import-choice-1-category`).disabled).toBe(true)
    await rerender(bankScreen({ keep: [3], committing: true }))
    expect(find<HTMLInputElement>(`#import-keep-3`).disabled).toBe(true)
  })

  it("filters the rows to import or the skipped ones, and says when none match", async () => {
    await mount(bankScreen())
    await filterBy(`Skipped`)
    expect(texts(`[data-e2e="import-review-line"]`)).toEqual([`Line 3`, `Line 4`])
    await filterBy(`To import`)
    expect(texts(`[data-e2e="import-review-line"]`)).toEqual([`Line 2`])
    await filterBy(`All`)
    expect(texts(`[data-e2e="import-review-line"]`)).toEqual([`Line 2`, `Line 3`, `Line 4`])
    await rerender(bankScreen({ check: manyReviewed(2) }))
    await filterBy(`Skipped`)
    expect(has(`[data-e2e="import-review-row"]`)).toBe(false)
    expect(find(`[data-e2e="import-review-none"]`).textContent).toBe(`No rows here.`)
  })

  it("shows 50 rows at a time and moves focus to the first row each press adds", async () => {
    await mount(bankScreen({ check: manyReviewed(120) }))
    expect(document.querySelectorAll(`[data-e2e="import-review-row"]`).length).toBe(50)
    expect(find(`[data-e2e="import-review-more"]`).textContent).toBe(`Show 50 more`)
    await click(`[data-e2e="import-review-more"]`)
    expect(document.querySelectorAll(`[data-e2e="import-review-row"]`).length).toBe(100)
    // Row 51 is line 52: the header is line 1.
    expect(document.activeElement?.id).toBe(`import-review-line-51`)
    expect(find(`[data-e2e="import-review-more"]`).textContent).toBe(`Show 20 more`)
    await click(`[data-e2e="import-review-more"]`)
    expect(document.querySelectorAll(`[data-e2e="import-review-row"]`).length).toBe(120)
    expect(document.activeElement?.id).toBe(`import-review-line-101`)
    expect(has(`[data-e2e="import-review-more"]`)).toBe(false)
  })

  it("starts a filter over at its first 50 rows", async () => {
    await mount(bankScreen({ check: manyReviewed(120) }))
    await click(`[data-e2e="import-review-more"]`)
    await filterBy(`To import`)
    expect(document.querySelectorAll(`[data-e2e="import-review-row"]`).length).toBe(50)
  })

  it("blocks the save when every row is skipped, until one is kept", async () => {
    let commits = 0
    const skipped = {
      ...REVIEWED,
      reviews: REVIEWED.reviews!.map((review) => ({ ...review, skip: `Saved before` })),
    }
    await mount(bankScreen({ check: skipped, onCommit: () => commits++ }))
    expect(find(`[data-e2e="import-submit"]`).textContent).toContain(`Import 0 notes`)
    await submit(`[data-e2e="import-submit"]`)
    expect(commits).toBe(0)
    expect(find(`[data-e2e="import-no-valid"]`).textContent).toContain(
      `Every row is skipped, so nothing would be imported.`,
    )
    expect(document.activeElement?.getAttribute(`data-e2e`)).toBe(`import-no-valid`)
    // Keeping a row makes one to save: the press goes through.
    await rerender(bankScreen({ check: skipped, keep: [3], onCommit: () => commits++ }))
    expect(has(`[data-e2e="import-no-valid"]`)).toBe(false)
    await submit(`[data-e2e="import-submit"]`)
    expect(commits).toBe(1)
  })

  it("counts the save in progress without the skipped rows", async () => {
    await mount(
      bankScreen({ summary: bankSummary({ status: ImportStatus.COMMITTING }), keep: [3] }),
    )
    expect(find(`[data-e2e="import-heading"]`).textContent).toBe(`Importing 2 notes…`)
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
