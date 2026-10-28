/**
 * The System screen (#429), driven in a browser DOM (happy-dom): each card's state, and the queue
 * card's way to the Jobs module.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { AdminHealth, type AdminSystemSnapshot } from "@domain/identity"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { AdminSystemScreen, type AdminSystemScreenProps } from "./admin-system-screen.tsx"
import { ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"

const window = new Window({ url: "http://admin.localhost/system" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    // A link hands a click to `navigate` only for an address of the page's own origin.
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
  fileStore: { health: AdminHealth.OK, reachable: true, latencyMs: 4 },
  queue: {
    health: AdminHealth.WARNING,
    due: 1,
    oldestDueAt: "2026-10-16T08:50:00.000Z",
    scheduled: 2,
    running: 0,
    retrying: 0,
    failed: 2,
  },
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
    navigate: (href) => calls.push(["navigate", href]),
    ...overrides,
  }
}

describe("system screen", () => {
  it("badges each part of the stack OK, Warning or Error, in words", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    expect(state("admin-system-database")).toBe("ok")
    expect(state("admin-system-cache")).toBe("error")
    expect(state("admin-system-files")).toBe("ok")
    expect(find("[data-e2e=admin-system-files]").textContent).toContain("Yes, in 4 ms")
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

  it("caps the build card's fact list so each label sits beside its value", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    const list = find("[data-e2e=admin-system-build] [data-e2e=fact-list]")
    expect(list.getAttribute("class")).toContain("max-w-xl")
  })

  it("opens Jobs at its failed runs from the queue card while any failed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminSystemScreen {...props(calls)} />)
    expect(find("[data-e2e=admin-system-open-jobs]").getAttribute("href")).toBe(
      "/jobs?state=failed",
    )
    await click("[data-e2e=admin-system-open-jobs]")
    expect(calls).toEqual([["navigate", "/jobs?state=failed"]])

    const healthy = { ...snapshot, queue: { ...snapshot.queue, failed: 0 } }
    await mount(<AdminSystemScreen {...props([], { snapshot: healthy })} />)
    expect(find("[data-e2e=admin-system-open-jobs]").getAttribute("href")).toBe("/jobs")
  })

  it("lists no job cards: the jobs are the Jobs module's", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    expect(has("[data-e2e=admin-system-jobs]")).toBe(false)
    expect(has("[data-e2e=admin-system-failed]")).toBe(false)
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

  it("keeps each part's hint after its list of facts, never inside it", async () => {
    await mount(<AdminSystemScreen {...props([])} />)

    expect(document.querySelectorAll("dl p")).toHaveLength(0)
    const hints = [...document.querySelectorAll("dl + p")].map((hint) => hint.textContent)
    expect(hints).toHaveLength(2)
  })
})

describe("system screen in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    const page = await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminSystemScreen {...props([])} />
      </I18nContext.Provider>,
    )
    expect(englishLeft(page, [`Postgres`, `Deno`, snapshot.migrations.latest!, `abc1234def56`]))
      .toEqual([])
    expect(page.textContent).toContain(ADMIN_PSEUDO.t(`AdminSystem.queueHint`, { count: 5 }))
  })
})
