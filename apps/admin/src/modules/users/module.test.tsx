/**
 * One person's page in the admin app, driven in a browser DOM (happy-dom): what it keeps for the
 * palette's "Recent" once the person has loaded, and that a bad address or a failed load keeps
 * nothing.
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
import type { Formatters } from "@spy4x/time/format"
import { type AdminUserDetail, DEFAULT_PREFERENCES, type User, UserRole } from "@domain/identity"
import type { OpenedRecord } from "@platform/palette-recent.ts"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import type { AdminContext } from "../types.ts"
import { usersModule } from "./module.tsx"

const window = new Window({ url: `http://admin.localhost/` })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
  HTMLAnchorElement: globalThis.HTMLAnchorElement,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
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

const detail: AdminUserDetail = {
  user: {
    id: 42,
    firstName: `Ada`,
    lastName: `Lovelace`,
    email: `ada@example.com`,
    role: UserRole.VIEWER,
    blockedAt: null,
    createdAt: `2026-10-01T10:00:00.000Z`,
    lastSeenAt: null,
  },
  methods: [],
  sessions: [],
  groups: [],
  audits: [],
  trialUsedAt: null,
  preferences: {
    value: DEFAULT_PREFERENCES,
    version: 0,
    updatedAt: null,
    firstTimeZone: null,
    firstLocale: null,
  },
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/**
 * The person page at `path`, wired as `app.tsx` wires it. Only `/api/admin/users/42` answers, and
 * only while `fails` is off. Returns the records the page kept for the palette.
 */
async function openUser(path: string, fails = false): Promise<OpenedRecord[]> {
  const opened: OpenedRecord[] = []
  const request = ((asked: string) =>
    Promise.resolve(
      asked === `/api/admin/users/42` && !fails
        ? { ok: true, status: 200, data: detail }
        : { ok: false, status: 500, error: { message: `not in this test` } },
    ) as Promise<AdminApiResult<unknown>>) as AdminFetch
  const memory = memoryLocation({ path })
  const context: AdminContext = {
    request,
    signedOut: () => {},
    toasts: createToastStore(),
    operator: { id: 7, role: UserRole.OPERATOR } as User,
    navigate: memory.navigate,
    leaveGuard: createLeaveGuard(),
    personTabs: [],
    moduleIds: signal(new Set([`users`])),
    format: () => ({}) as Formatters,
    opened: (record) => void opened.push(record),
  }
  const View = usersModule.routes.find((route) => route.path === `/users/:id`)!.View
  root = document.createElement(`div`)
  document.body.append(root)
  await act(() =>
    render(
      <Router hook={memory.hook}>
        <Route path="/users/:id">
          {(params) => <View context={context} params={params as Record<string, string>} />}
        </Route>
      </Router>,
      root!,
    )
  )
  await settle()
  return opened
}

describe(`one person's page in the admin app`, () => {
  it(`keeps the loaded person, by their id and name, for the palette's Recent`, async () => {
    expect(await openUser(`/users/42`)).toEqual([{ kind: `user`, id: `42`, name: `Ada Lovelace` }])
  })

  it(`keeps nothing for an address that is no user id`, async () => {
    expect(await openUser(`/users/not-a-number`)).toEqual([])
  })

  it(`keeps nothing when the person fails to load`, async () => {
    expect(await openUser(`/users/42`, true)).toEqual([])
  })
})
