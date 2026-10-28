/**
 * The operator area's Jobs list and one job's page (#394), driven in a browser DOM (happy-dom):
 * the search and state chips, which actions each run offers, the confirmations a mail job asks
 * for, and where focus goes once an action went through.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import {
  ADMIN_JOB_NO_FILTER,
  type AdminJobDetail,
  type AdminJobListResponse,
  AdminJobState,
  type AdminRepeatingJob,
} from "@domain/identity"
import {
  AdminJobScreen,
  type AdminJobScreenProps,
  AdminJobsScreen,
  type AdminJobsScreenProps,
} from "./admin-jobs-screen.tsx"

import { I18nContext } from "@spy4x/preact-ui/i18n"
import { ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"
const window = new Window({ url: "http://admin.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
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

async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

const has = (selector: string) => document.querySelector(selector) !== null
const text = (selector: string) => find(selector).textContent?.replace(/\s+/g, " ").trim() ?? ""

async function click(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const ID = "01920000-0000-7000-8000-000000000001"

const failedJob: AdminJobDetail = {
  id: ID,
  kind: "auth.password-reset-mail",
  label: "Password reset email",
  state: AdminJobState.Failed,
  attempts: 20,
  maxAttempts: 20,
  createdAt: "2026-10-20T10:00:00.000Z",
  dueAt: "2026-10-20T10:00:00.000Z",
  startedAt: "2026-10-20T10:30:00.000Z",
  finishedAt: "2026-10-20T11:00:00.000Z",
  errorCode: "MailSendError",
  repeats: null,
  sendsMail: true,
  cancellable: true,
  about: null,
  keptUntil: "2026-10-27T11:00:00.000Z",
}

const list: AdminJobListResponse = {
  jobs: [failedJob],
  counts: { all: 3, failed: 1, retrying: 0, scheduled: 2, running: 0, done: 0, cancelled: 0 },
  total: 3,
  page: 1,
  pageSize: 50,
  keptDays: 7,
}

const cleanup: AdminRepeatingJob = {
  kind: "outbox.cleanup",
  label: "Nightly cleanup",
  schedule: "Every day",
  sendsMail: false,
  lastRunAt: null,
  lastFailed: false,
  nextId: ID,
  nextRunAt: "2026-10-21T03:00:00.000Z",
  running: false,
}

type Events = unknown[][]

/** `node` in a British, 24-hour format, so a clock time reads `03:00` whatever the machine's. */
function inGB(node: VNode): VNode {
  return (
    <FormatContext.Provider
      value={createFormatters({ locale: "en-GB", timeZone: "UTC", hourCycle: null })}
    >
      {node}
    </FormatContext.Provider>
  )
}

/** The list with `overrides`, recording every search, ask and run it reports. */
function jobsPage(overrides: Partial<AdminJobsScreenProps> = {}) {
  const events: Events = []
  const props: AdminJobsScreenProps = {
    tab: "runs",
    onTab: (tab) => events.push(["tab", tab]),
    filter: ADMIN_JOB_NO_FILTER,
    list,
    pending: false,
    error: null,
    onSearch: (filter) => events.push(["search", filter]),
    onPage: (page) => events.push(["page", page]),
    onReload: () => events.push(["reload"]),
    repeating: [cleanup],
    repeatingError: null,
    onReloadRepeating: () => events.push(["reloadRepeating"]),
    starting: null,
    onRunRepeating: (job) => events.push(["run", job.kind]),
    confirm: null,
    confirmPending: false,
    confirmError: null,
    onOpenConfirm: (confirm) => events.push(["ask", confirm]),
    onCloseConfirm: () => events.push(["close"]),
    onConfirm: (confirm) => events.push(["confirm", confirm.kind]),
    ...overrides,
  }
  return { node: <AdminJobsScreen {...props} />, events }
}

/** One job's page with `overrides`, recording every dialog and action it reports. */
function jobPage(overrides: Partial<AdminJobScreenProps> = {}) {
  const events: Events = []
  const props: AdminJobScreenProps = {
    job: failedJob,
    error: null,
    onReload: () => events.push(["reload"]),
    dialog: null,
    pending: false,
    dialogError: null,
    onOpenDialog: (action) => events.push(["ask", action]),
    onCloseDialog: () => events.push(["close"]),
    onAction: (action) => events.push(["act", action]),
    onCopyId: (id) => events.push(["copy", id]),
    ...overrides,
  }
  return { node: <AdminJobScreen {...props} />, events }
}

describe("admin jobs list", () => {
  it("searches by the typed words on page 1, keeping the state chip", async () => {
    const filter = { query: "", state: "failed" as const, page: 4 }
    const { node, events } = jobsPage({ filter })
    await mount(node)
    await type(`[data-e2e="admin-jobs-search"]`, "  reset mail ")
    await submit(`[data-e2e="admin-jobs-search"]`)

    expect(events).toEqual([["search", { query: "reset mail", state: "failed", page: 1 }]])
  })

  it("filters by state on page 1, each chip counting its runs", async () => {
    const { node, events } = jobsPage({ filter: { ...ADMIN_JOB_NO_FILTER, page: 2 } })
    await mount(node)

    expect(find(`[data-e2e="admin-jobs-chip-scheduled"]`).closest("label")?.textContent)
      .toContain("Scheduled 2")
    await click(find(`[data-e2e="admin-jobs-chip-failed"]`))
    expect(events).toEqual([["search", { query: "", state: "failed", page: 1 }]])
  })

  it("says nothing failed when the failed chip finds no run", async () => {
    const empty = { ...list, jobs: [], total: 0, counts: { ...list.counts, all: 0, failed: 0 } }
    await mount(jobsPage({ list: empty, filter: { ...ADMIN_JOB_NO_FILTER, state: "failed" } }).node)

    expect(has(`[data-e2e="admin-jobs-none-failed"]`)).toBe(true)
    expect(has(`[data-e2e="admin-jobs-retry-all"]`)).toBe(false)
  })

  it("says the list could not be read in place of it, with a way to try again", async () => {
    const { node, events } = jobsPage({ list: null, error: "Something went wrong." })
    await mount(node)

    expect(text(`[data-e2e="admin-jobs-error"]`)).toContain("Jobs could not be loaded.")
    await click(find(`[data-e2e="admin-jobs-error"] button`))
    expect(events).toEqual([["reload"]])
  })

  it("asks before running every failed job again, naming how many", async () => {
    const confirm = { kind: "retryAll", count: 1 } as const
    const { node, events } = jobsPage({ confirm })
    await mount(node)

    expect(text(`[data-e2e="admin-jobs-confirm"]`)).toContain("Run 1 failed job again?")
    await click(find(`[data-e2e="admin-jobs-confirm-ok"]`))
    expect(events).toEqual([["confirm", "retryAll"]])
  })

  it("moves focus to the run count once the failed jobs started again", async () => {
    const confirm = { kind: "retryAll", count: 1 } as const
    await mount(jobsPage({ confirm, confirmPending: true }).node)
    await mount(jobsPage({ confirm: null }).node)
    expect(document.activeElement === find(`[data-e2e="admin-jobs-count"]`)).toBe(true)
  })

  it("leaves focus alone when the confirmation was cancelled or refused", async () => {
    const confirm = { kind: "retryAll", count: 1 } as const
    await mount(jobsPage({ confirm }).node)
    await mount(jobsPage({ confirm: null }).node)
    expect(document.activeElement === find(`[data-e2e="admin-jobs-count"]`)).toBe(false)

    await mount(jobsPage({ confirm, confirmPending: true }).node)
    await mount(jobsPage({ confirm, confirmError: "That did not work." }).node)
    expect(document.activeElement === find(`[data-e2e="admin-jobs-count"]`)).toBe(false)
  })
})

describe("admin repeating jobs", () => {
  it("runs a job that sends no mail at once, and asks first for one that does", async () => {
    const mail = { ...cleanup, kind: "billing.digest", label: "Digest", sendsMail: true }
    const { node, events } = jobsPage({ tab: "repeating", repeating: [cleanup, mail] })
    await mount(node)
    await click(find(`[data-e2e="admin-repeating-run-outbox.cleanup"]`))
    await click(find(`[data-e2e="admin-repeating-run-billing.digest"]`))

    expect(events).toEqual([["run", "outbox.cleanup"], ["ask", {
      kind: "runRepeating",
      job: mail,
    }]])
  })

  it("says the UTC clock time a repeating job would have run at when asked to run it now", async () => {
    const confirm = { kind: "runRepeating", job: { ...cleanup, sendsMail: true } } as const
    await mount(inGB(jobsPage({ tab: "repeating", confirm }).node))

    expect(text(`[data-e2e="admin-jobs-confirm"]`)).toContain(
      "runs now instead of at 21 Oct, 03:00 UTC.",
    )
  })

  it("shows Running in place of Run now while a worker holds the run", async () => {
    await mount(jobsPage({ tab: "repeating", repeating: [{ ...cleanup, running: true }] }).node)

    expect(has(`[data-e2e="admin-repeating-run-outbox.cleanup"]`)).toBe(false)
    expect(text(`[data-e2e="admin-repeating"]`)).toContain("Running")
  })
})

describe("admin job page", () => {
  it("offers Run again on a failed run, asking first because it sends mail", async () => {
    const { node, events } = jobPage()
    await mount(node)

    expect(text(`[data-e2e="admin-job-error-code"]`)).toBe("MailSendError")
    expect(has(`[data-e2e="admin-job-cancel"]`)).toBe(false)
    await click(find(`[data-e2e="admin-job-retry"]`))
    expect(events).toEqual([["ask", "retry"]])
  })

  it("runs a waiting job that sends no mail now without asking, and offers cancel", async () => {
    const waiting = {
      ...failedJob,
      state: AdminJobState.Scheduled,
      sendsMail: false,
      finishedAt: null,
      errorCode: null,
    }
    const { node, events } = jobPage({ job: waiting })
    await mount(node)

    expect(has(`[data-e2e="admin-job-retry"]`)).toBe(false)
    expect(has(`[data-e2e="admin-job-cancel"]`)).toBe(true)
    await click(find(`[data-e2e="admin-job-run-now"]`))
    expect(events).toEqual([["act", "runNow"]])
  })

  it("offers no Cancel for a waiting job the admin may not cancel", async () => {
    const waiting = {
      ...failedJob,
      state: AdminJobState.Scheduled,
      sendsMail: false,
      cancellable: false,
      finishedAt: null,
      errorCode: null,
    }
    const { node } = jobPage({ job: waiting })
    await mount(node)

    expect(has(`[data-e2e="admin-job-run-now"]`)).toBe(true)
    expect(has(`[data-e2e="admin-job-cancel"]`)).toBe(false)
  })

  it("says how far ahead a waiting run is due, never that it ran a moment ago", async () => {
    const waiting = {
      ...failedJob,
      state: AdminJobState.Scheduled,
      dueAt: "2030-03-04T03:00:00.000Z",
      finishedAt: null,
      errorCode: null,
    }
    await mount(jobPage({ job: waiting }).node)

    const due = find(`[data-e2e="admin-job-facts"] time[datetime="2030-03-04T03:00:00.000Z"]`)
    expect(due.textContent).toMatch(/^in \d+ years?$/)
    expect(due.getAttribute("title")).toContain("2030")
  })

  it("says the UTC clock time a waiting run was due at when asked to run it now", async () => {
    const waiting = {
      ...failedJob,
      state: AdminJobState.Scheduled,
      dueAt: "2030-03-04T03:00:00.000Z",
    }
    await mount(inGB(jobPage({ job: waiting, dialog: "runNow" }).node))

    expect(text(`[data-e2e="admin-job-dialog"]`)).toContain(
      "runs now instead of at 4 Mar, 03:00 UTC.",
    )
  })

  it("offers no action but copying the id on a finished run", async () => {
    await mount(jobPage({ job: { ...failedJob, state: AdminJobState.Done, errorCode: null } }).node)

    expect(has(`[data-e2e="admin-job-retry"]`)).toBe(false)
    expect(has(`[data-e2e="admin-job-run-now"]`)).toBe(false)
    expect(has(`[data-e2e="admin-job-cancel"]`)).toBe(false)
    expect(has(`[data-e2e="admin-job-copy-id"]`)).toBe(true)
  })

  it("confirms a cancel in a danger dialog that keeps the job by default", async () => {
    const { node, events } = jobPage({
      job: { ...failedJob, state: AdminJobState.Scheduled },
      dialog: "cancel",
    })
    await mount(node)

    const dialog = text(`[data-e2e="admin-job-dialog"]`)
    expect(dialog).toContain("Cancel this job?")
    expect(dialog).toContain("Password reset email will not run.")
    const keep = [...find(`[data-e2e="admin-job-dialog"]`).querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Keep it")!
    await click(keep)
    await click(find(`[data-e2e="admin-job-dialog-confirm"]`))
    expect(events).toEqual([["close"], ["act", "cancel"]])
  })

  it("shows why an action failed inside its dialog", async () => {
    await mount(jobPage({ dialog: "retry", dialogError: "That did not work." }).node)
    expect(text(`[data-e2e="admin-job-dialog-error"]`)).toContain("That did not work.")
  })

  it("moves focus to the details once an action went through, not after a refusal", async () => {
    await mount(jobPage({ dialog: "retry", pending: true }).node)
    await mount(jobPage({ job: { ...failedJob, state: AdminJobState.Due } }).node)
    expect(document.activeElement === find(`[data-e2e="admin-job-facts"]`)).toBe(true)

    await mount(jobPage({ dialog: "retry" }).node)
    find<HTMLElement>(`[data-e2e="admin-job-retry"]`).focus()
    await mount(jobPage({ dialog: "retry", pending: true }).node)
    await mount(jobPage({ dialog: "retry", dialogError: "That did not work." }).node)
    expect(document.activeElement === find(`[data-e2e="admin-job-facts"]`)).toBe(false)
  })
})

describe("the jobs screens in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        {jobsPage().node}
        {jobsPage({ tab: "repeating" }).node}
        {jobPage({ dialog: "retry" }).node}
      </I18nContext.Provider>,
    )
    expect(englishLeft(document.body, [
      // Names, kinds, schedules and errors as the server sends them.
      ...[`Password reset email`, `auth.password-reset-mail`, `MailSendError`],
      ...[`Nightly cleanup`, `outbox.cleanup`, `Every day`],
    ])).toEqual([])
  })
})
