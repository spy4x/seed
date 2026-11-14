/**
 * One group's page in the admin app with the notes on, off and not known yet, driven in a browser
 * DOM (happy-dom): which API calls it makes and what it draws. With the notes off the API mounts
 * no widget or file route, so the page must ask for none.
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
import { type AdminGroupDetail, GroupRole } from "@domain/groups"
import { type User, UserRole } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import type { AdminContext } from "../types.ts"
import { groupsModule } from "./module.tsx"

const window = new Window({ url: `http://admin.localhost/` })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  Element: globalThis.Element,
  HTMLAnchorElement: globalThis.HTMLAnchorElement,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    Element: window.Element,
    HTMLAnchorElement: window.HTMLAnchorElement,
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
  document.body.innerHTML = ``
  root = null
})

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const ada = { id: 42, name: `Ada Lovelace`, email: `ada@example.com` }

const detail: AdminGroupDetail = {
  group: {
    id: GROUP_ID,
    name: `Family`,
    emoji: null,
    timeZone: `Europe/Berlin`,
    color: null,
    owner: ada,
    memberCount: 1,
    noteCount: 0,
    planId: `free`,
    createdAt: `2026-10-01T10:00:00.000Z`,
    lastActivityAt: `2026-10-14T10:00:00.000Z`,
    deletedAt: null,
  },
  counts: { notes: 0, deletedNotes: 0, tags: 0, pendingInvitations: 0, files: 0, fileBytes: 0 },
  billing: null,
  members: [{
    ...ada,
    role: GroupRole.OWNER,
    userRole: UserRole.VIEWER,
    blocked: false,
    joinedAt: `2026-10-01T10:00:00.000Z`,
  }],
  invitations: [],
  activity: [],
  imported: null,
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/**
 * The group page on `/groups/:id?tab=files`, wired as `app.tsx` wires it, with `moduleIds` as the
 * API's module list (`null`: not read yet). Every path the page asks for lands in `paths`; only the
 * group answers, so a widget or the files show their failure, which these tests do not look at.
 */
async function openGroup(moduleIds: ReadonlySet<string> | null) {
  const paths: string[] = []
  const request = ((path: string) => {
    paths.push(path)
    return Promise.resolve(
      path === `/api/admin/groups/${GROUP_ID}`
        ? { ok: true, status: 200, data: detail }
        : { ok: false, status: 500, error: { message: `not in this test` } },
    ) as Promise<AdminApiResult<unknown>>
  }) as AdminFetch
  const memory = memoryLocation({ path: `/groups/${GROUP_ID}?tab=files` })
  const modules = signal(moduleIds)
  const context: AdminContext = {
    request,
    signedOut: () => {},
    toasts: createToastStore(),
    operator: { id: 7, role: UserRole.OPERATOR } as User,
    navigate: memory.navigate,
    leaveGuard: createLeaveGuard(),
    personTabs: [],
    moduleIds: modules,
    format: () => ({}) as Formatters,
  }
  const View = groupsModule.routes.find((route) => route.path === `/groups/:id`)!.View
  root = document.createElement(`div`)
  document.body.append(root)
  await act(() =>
    render(
      <FormatContext.Provider
        value={createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })}
      >
        <Router hook={memory.hook}>
          <Route path="/groups/:id">
            {(params) => <View context={context} params={params as Record<string, string>} />}
          </Route>
        </Router>
      </FormatContext.Provider>,
      root!,
    )
  )
  await settle()
  return { paths, modules }
}

const asked = (paths: string[], part: string) => paths.filter((path) => path.includes(part))
/** Every widget the page asked for, once each: it asks again once the group's zone is known. */
const widgetIds = (paths: string[]) =>
  [...new Set(asked(paths, `/widgets/`).map((path) => path.split(`/widgets/`)[1].split(`?`)[0]))]
    .sort()
const NOTE_WIDGET_IDS = [`notes.added`, `notes.over-time`, `notes.total`]
const tabNames = () => [...document.querySelectorAll(`[role=tab]`)].map((tab) => tab.textContent)
const hasFilesTab = () => tabNames().some((name) => name?.startsWith(`Files`))
const noWidgetsCard = () =>
  document.querySelector(`[data-e2e=admin-group-overview] [data-e2e=overview-no-widgets]`)

describe(`one group's page in the admin app`, () => {
  it(`asks for no widget and no files with the notes off, and shows the empty overview and no Files tab`, async () => {
    const { paths } = await openGroup(new Set([`groups`]))

    expect(paths).toEqual([`/api/admin/groups/${GROUP_ID}`])
    expect(noWidgetsCard()).not.toBe(null)
    expect(document.querySelectorAll(`[data-widget-status]`)).toHaveLength(0)
    expect(hasFilesTab()).toBe(false)
    expect(document.querySelector(`[role=tabpanel] [data-e2e=admin-group-members]`)).not.toBe(null)
  })

  it(`asks for every note widget and the files with the notes on`, async () => {
    const { paths } = await openGroup(new Set([`groups`, `notes`]))

    expect(widgetIds(paths)).toEqual(NOTE_WIDGET_IDS)
    expect(asked(paths, `/files`)).toHaveLength(1)
    expect(noWidgetsCard()).toBe(null)
    expect(hasFilesTab()).toBe(true)
  })

  it(`asks for nothing of the notes until the module list is read, drawing them as loading`, async () => {
    const { paths, modules } = await openGroup(null)

    expect(paths).toEqual([`/api/admin/groups/${GROUP_ID}`])
    expect(document.querySelectorAll(`[data-widget-status=loading]`)).toHaveLength(3)
    expect(hasFilesTab()).toBe(true)

    await act(() => {
      modules.value = new Set([`groups`, `notes`])
    })
    await settle()

    expect(widgetIds(paths)).toEqual(NOTE_WIDGET_IDS)
    expect(asked(paths, `/files`)).toHaveLength(1)
    expect(document.querySelectorAll(`[data-widget-status]`)).toHaveLength(3)
  })

  it(`still asks for nothing of the notes once the list arrives without them`, async () => {
    const { paths, modules } = await openGroup(null)

    await act(() => {
      modules.value = new Set([`groups`])
    })
    await settle()

    expect(paths).toEqual([`/api/admin/groups/${GROUP_ID}`])
    expect(noWidgetsCard()).not.toBe(null)
    expect(hasFilesTab()).toBe(false)
  })
})
