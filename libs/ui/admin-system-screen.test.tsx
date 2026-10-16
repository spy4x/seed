/**
 * The System screen (#429), driven in a browser DOM (happy-dom): each card's state, the failed
 * jobs and the confirmation that runs one again.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { type AdminFailedJob, AdminHealth, type AdminSystemSnapshot } from "@domain/identity"
import { AdminSystemScreen, type AdminSystemScreenProps } from "./admin-system-screen.tsx"

const window = new Window({ url: "http://admin.localhost/system" })
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

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The word on a card's badge: `ok`, `warning` or `error`. */
function state(card: string): string | null | undefined {
  return document.querySelector(`[data-e2e=${card}] [data-health]`)?.getAttribute("data-health")
}

const mailJob: AdminFailedJob = {
  id: "01927f3e-6b2a-7c3d-8e4f-5a6b7c8d9e0f",
  kind: "mail.password_reset",
  attempts: 20,
  errorCode: "MailSendError",
  failedAt: "2026-10-16T08:00:00.000Z",
  retryable: true,
}

const noteChange: AdminFailedJob = {
  ...mailJob,
  id: "01927f3e-6b2a-7c3d-8e4f-5a6b7c8d9e10",
  kind: "note.created",
  retryable: false,
}

const snapshot: AdminSystemSnapshot = {
  health: AdminHealth.ERROR,
  checkedAt: "2026-10-16T09:00:00.000Z",
  database: {
    health: AdminHealth.OK,
    reachable: true,
    latencyMs: 3,
    sizeBytes: 9_437_184,
    version: "18.6",
    startedAt: "2026-10-10T00:00:00.000Z",
  },
  cache: { health: AdminHealth.ERROR, reachable: false, latencyMs: 2000 },
  queue: {
    health: AdminHealth.WARNING,
    due: 1,
    oldestDueAt: "2026-10-16T08:50:00.000Z",
    scheduled: 2,
    running: 0,
    retrying: 0,
    failed: 2,
  },
  jobs: [{
    kind: "outbox.cleanup",
    lastRunAt: "2026-10-16T03:00:00.000Z",
    lastFailed: false,
    nextRunAt: "2026-10-17T03:00:00.000Z",
  }],
  failedJobs: [mailJob, noteChange],
  backup: { health: AdminHealth.OK, succeededAt: "2026-10-16T03:00:00.000Z" },
  migrations: {
    health: AdminHealth.OK,
    applied: 60,
    latest: "2026_11_14_0001_backup_status",
    latestAt: "2026-10-15T00:00:00.000Z",
  },
  build: {
    version: "v1.2.3",
    commit: "abc1234def5678",
    runtime: "Deno/2.9.7",
    startedAt: "2026-10-16T08:00:00.000Z",
  },
}

function props(
  calls: unknown[][],
  overrides: Partial<AdminSystemScreenProps> = {},
): AdminSystemScreenProps {
  return {
    snapshot,
    error: null,
    pending: false,
    onRefresh: () => calls.push(["refresh"]),
    retrying: null,
    retryError: null,
    retryPending: false,
    onOpenRetry: (job) => calls.push(["open", job.id]),
    onCloseRetry: () => calls.push(["close"]),
    onRetry: (job) => calls.push(["retry", job.id]),
    ...overrides,
  }
}

describe("system screen", () => {
  it("badges each part of the stack OK, Warning or Error, in words", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    expect(state("admin-system-database")).toBe("ok")
    expect(state("admin-system-cache")).toBe("error")
    expect(state("admin-system-queue")).toBe("warning")
    expect(state("admin-system-backup")).toBe("ok")
    expect(state("admin-system-migrations")).toBe("ok")
    expect(find("[data-e2e=admin-system-cache]").textContent).toContain("Error")
    expect(find("[data-e2e=admin-system-summary]").textContent).toContain("Something is broken")
  })

  it("shows the database's size, the newest migration and the build", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    expect(find("[data-e2e=admin-system-database]").textContent).toContain("9 MB")
    expect(find("[data-e2e=admin-system-migrations]").textContent).toContain(
      "2026_11_14_0001_backup_status",
    )
    const build = find("[data-e2e=admin-system-build]").textContent
    expect(build).toContain("v1.2.3")
    expect(build).toContain("abc1234def56")
    expect(build).not.toContain("abc1234def5678")
  })

  it("lists the failed jobs, and offers Run again only for one that may run again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminSystemScreen {...props(calls)} />)
    const failed = find("[data-e2e=admin-system-failed]")

    expect(failed.textContent).toContain("MailSendError")
    expect(has(`[data-e2e=admin-retry-${noteChange.id}]`)).toBe(false)
    expect(failed.textContent).toContain("Cannot be run again")
    await click(`[data-e2e=admin-retry-${mailJob.id}]`)
    expect(calls).toEqual([["open", mailJob.id]])
  })

  it("runs the job again only once the dialog is confirmed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminSystemScreen {...props(calls, { retrying: mailJob })} />)

    expect(find("[data-e2e=admin-retry-dialog]").textContent).toContain("mail.password_reset")
    expect(calls).toEqual([])
    await click("[data-e2e=admin-retry-confirm]")
    expect(calls).toEqual([["retry", mailJob.id]])
  })

  it("shows why the API refused inside the dialog", async () => {
    const message = "A newer run of this job is already waiting, so this one is not run again."
    await mount(<AdminSystemScreen {...props([], { retrying: mailJob, retryError: message })} />)

    expect(find("[data-e2e=admin-retry-error]").textContent).toContain(message)
  })

  it("reads the stack again on Check again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminSystemScreen {...props(calls)} />)
    await click("[data-e2e=admin-system-refresh]")

    expect(calls).toEqual([["refresh"]])
  })

  it("shows a loading state, then the error with a way to try again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminSystemScreen {...props(calls, { snapshot: null })} />)
    expect(has("[data-e2e=admin-system-loading]")).toBe(true)

    await mount(<AdminSystemScreen {...props(calls, { snapshot: null, error: "Down." })} />)
    expect(has("[data-e2e=admin-system-loading]")).toBe(false)
    expect(find("[data-e2e=admin-system-error]").textContent).toContain("Down.")
  })

  it("says so when no job failed", async () => {
    await mount(
      <AdminSystemScreen {...props([], { snapshot: { ...snapshot, failedJobs: [] } })} />,
    )

    expect(find("[data-e2e=admin-system-failed]").textContent).toContain("No job failed")
  })
})
