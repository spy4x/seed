/**
 * The admin pages that name notes, wired as `app.tsx` wires them, with the API's module list on,
 * off and not read yet: the dashboard's Notes card, the group list's Notes column and the audit
 * filter's note, tag and file events. Until the list is read each page draws as with the notes on.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { signal } from "@preact/signals"
import { Route, Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { createLeaveGuard } from "@spy4x/preact-ui/unsaved-guard"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import type { AdminGroupListResponse } from "@domain/groups"
import { type AdminStats, type User, UserRole } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../state.ts"
import type { AdminContext, AdminModule } from "./types.ts"
import { auditModule } from "./audit/module.tsx"
import { dashboardModule } from "./dashboard/module.tsx"
import { groupsModule } from "./groups/module.tsx"

const window = new Window({ url: `http://admin.localhost/` })
const own = { document: globalThis.document, window: globalThis.window }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document, window })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ``
  root = null
})

const days = Array.from({ length: 30 }, (_, index) => ({
  day: `2026-09-${String(index + 1).padStart(2, `0`)}`,
  count: 1,
}))
const stats: AdminStats = {
  generatedAt: `2026-09-30T12:00:00.000Z`,
  people: 10,
  blocked: 0,
  newThisWeek: { current: 1, previous: 1 },
  activeToday: { current: 1, previous: 1 },
  activeThisWeek: { current: 1, previous: 1 },
  groups: 4,
  notes: 9,
  signUpsPerDay: days,
  activePerDay: days,
}
const groups: AdminGroupListResponse = {
  groups: [{
    id: `0199c3a0-0000-7000-8000-000000000001`,
    name: `Family`,
    emoji: null,
    timeZone: `Europe/Berlin`,
    color: null,
    owner: { id: 42, name: `Ada Lovelace`, email: `ada@example.com` },
    memberCount: 3,
    noteCount: 12,
    planId: `free`,
    createdAt: `2026-10-01T10:00:00.000Z`,
    lastActivityAt: `2026-10-14T10:00:00.000Z`,
    deletedAt: null,
  }],
  total: 1,
  page: 1,
  pageSize: 25,
}

/** What the API answers, by the start of the path; anything else fails. */
const ANSWERS: [string, unknown][] = [
  [`/api/admin/stats`, stats],
  [`/api/admin/groups`, groups],
]

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** Opens `path` of `module` with `moduleIds` as the API's module list (`null`: not read yet). */
async function open(module: AdminModule, path: string, moduleIds: ReadonlySet<string> | null) {
  const request = ((asked: string) => {
    const answer = ANSWERS.find(([start]) => asked.startsWith(start))
    return Promise.resolve(
      answer
        ? { ok: true, status: 200, data: answer[1] }
        : { ok: false, status: 500, error: { message: `not in this test` } },
    ) as Promise<AdminApiResult<unknown>>
  }) as AdminFetch
  const memory = memoryLocation({ path })
  const context: AdminContext = {
    request,
    signedOut: () => {},
    toasts: createToastStore(),
    operator: { id: 7, role: UserRole.OPERATOR } as User,
    navigate: memory.navigate,
    leaveGuard: createLeaveGuard(),
    personTabs: [],
    moduleIds: signal(moduleIds),
    format: () => ({}) as Formatters,
  }
  const route = module.routes.find((candidate) => candidate.path === path)!
  root = document.createElement(`div`)
  document.body.append(root)
  await act(() =>
    render(
      <FormatContext.Provider
        value={createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })}
      >
        <Router hook={memory.hook}>
          <Route path={route.path}>
            {(params) => <route.View context={context} params={params as Record<string, string>} />}
          </Route>
        </Router>
      </FormatContext.Provider>,
      root!,
    )
  )
  await settle()
}

const ON = new Set([`notes`])
const OFF = new Set([`groups`])
const NAMES_NOTES = /\b(notes?|tags?|files?)\b/i
const text = (selector: string) => document.querySelector(selector)?.textContent ?? ``
const headers = () =>
  [...document.querySelectorAll(`[data-e2e=admin-groups-list] th`)].map((th) => th.textContent)
const eventValues = () =>
  [...document.querySelectorAll<HTMLOptionElement>(`[data-e2e=admin-audit-event] option`)]
    .map((option) => option.value)

describe(`the admin pages with the notes on, off and not known yet`, () => {
  it(`shows the dashboard's Notes card with the notes on or not known yet`, async () => {
    for (const moduleIds of [ON, null]) {
      await open(dashboardModule, `/`, moduleIds)
      expect(text(`[data-e2e=admin-dashboard-stats]`)).toContain(`Notes`)
      await act(() => render(null, root!))
    }
  })

  it(`leaves the dashboard's Notes card out with the notes off`, async () => {
    await open(dashboardModule, `/`, OFF)
    expect(text(`[data-e2e=admin-dashboard-stats]`)).toContain(`Groups`)
    expect(text(`[data-e2e=admin-dashboard-stats]`)).not.toMatch(NAMES_NOTES)
  })

  it(`shows the group list's Notes column with the notes on or not known yet`, async () => {
    for (const moduleIds of [ON, null]) {
      await open(groupsModule, `/groups`, moduleIds)
      expect(headers()).toContain(`Notes`)
      await act(() => render(null, root!))
    }
  })

  it(`leaves the group list's Notes column out with the notes off`, async () => {
    await open(groupsModule, `/groups`, OFF)
    expect(headers()).toContain(`Members`)
    expect(headers().some((header) => NAMES_NOTES.test(header ?? ``))).toBe(false)
  })

  it(`offers the note events in the audit filter with the notes on or not known yet`, async () => {
    for (const moduleIds of [ON, null]) {
      await open(auditModule, `/audit`, moduleIds)
      expect(eventValues()).toContain(`activity:note.created`)
      await act(() => render(null, root!))
    }
  })

  it(`offers no note, tag or file event in the audit filter with the notes off`, async () => {
    await open(auditModule, `/audit`, OFF)
    expect(eventValues()).toContain(`activity:group.renamed`)
    expect(eventValues().some((value) => /^activity:(note\.|tag\.|operator\.file_)/.test(value)))
      .toBe(false)
  })
})
