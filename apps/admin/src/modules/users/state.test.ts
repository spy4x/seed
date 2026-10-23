import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import {
  ADMIN_NO_FILTER,
  type AdminUserDetail,
  type AdminUserFilter,
  UserRole,
} from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { createUsersState } from "./state.ts"

const grace = {
  id: 42,
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@example.com",
  role: UserRole.VIEWER,
  blockedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: null,
}
const detail = { user: grace } as AdminUserDetail

const ok = <T>(data: T, status = 200) => ({ ok: true, status, data }) as AdminApiResult<T>
const fail = <T>(status: number, message: string) =>
  ({ ok: false, status, error: { message } }) as AdminApiResult<T>

type Answer = (path: string, init?: RequestInit) => Promise<AdminApiResult<unknown>> | undefined

/** A `request` that answers from `answer` (or a plain success) and records each call and body. */
function fakeRequest(answer: Answer = () => undefined) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const body = init?.body === undefined ? "" : ` ${init.body}`
    calls.push(`${init?.method ?? "GET"} ${path}${body}`)
    const fallback = path.endsWith(`/users/42`)
      ? ok(detail)
      : path.startsWith(`/api/admin/users?`) || path === `/api/admin/users`
      ? ok({ users: [], total: 0, page: 1, pageSize: 25 })
      : ok({ user: grace })
    return answer(path, init) ?? Promise.resolve(fallback)
  }) as AdminFetch
  return { request, calls }
}

/** A users state with person 42 open and the block dialog showing. */
async function withDialog(request: AdminFetch) {
  const toasts = createToastStore()
  const state = createUsersState(request, toasts)
  await state.loadPerson(42)
  state.openDialog("block")
  return { state, toasts }
}

it("reads the list with the filter and sort in the query", async () => {
  const { request, calls } = fakeRequest()
  const state = createUsersState(request, createToastStore())
  await state.loadList({
    ...ADMIN_NO_FILTER,
    query: "ada",
    sort: [{ key: "role", direction: "asc" }],
  })
  expect(calls).toEqual([`GET /api/admin/users?q=ada&sort=role%3Aasc`])
})

it("an answer for a filter the page has left is dropped", async () => {
  let answerFirst: (value: AdminApiResult<unknown>) => void = () => {}
  const first: AdminUserFilter = { ...ADMIN_NO_FILTER, query: "ada" }
  const { request } = fakeRequest((path) =>
    path.includes("q=ada")
      ? new Promise((resolve) => answerFirst = resolve)
      : Promise.resolve(ok({ users: [], total: 3, page: 1, pageSize: 25 }))
  )
  const state = createUsersState(request, createToastStore())
  const late = state.loadList(first)
  await state.loadList(ADMIN_NO_FILTER)
  answerFirst(ok({ users: [], total: 99, page: 1, pageSize: 25 }))
  await late
  expect(state.list.value.list?.total).toBe(3)
  expect(state.list.value.filter).toBe(ADMIN_NO_FILTER)
})

it("a list that cannot be read keeps the last page and shows the API's message", async () => {
  const { request } = fakeRequest(() => Promise.resolve(fail(500, "The database is down")))
  const state = createUsersState(request, createToastStore())
  await state.loadList(ADMIN_NO_FILTER)
  expect(state.list.value).toEqual({
    filter: ADMIN_NO_FILTER,
    list: null,
    pending: false,
    error: "The database is down",
  })
})

it("a confirmed action asks for no password, closes the dialog, toasts and reads the person again", async () => {
  const { request, calls } = fakeRequest()
  const { state, toasts } = await withDialog(request)
  await state.act()
  expect(calls).toEqual([
    `GET /api/admin/users/42`,
    `POST /api/admin/users/42/block`,
    `GET /api/admin/users/42`,
  ])
  expect(state.dialog.value).toEqual({ action: null, sessionId: null, error: null, pending: false })
  expect(toasts.list.value.map((toast) => [toast.type, toast.body])).toEqual([
    ["success", "Grace Hopper is blocked and signed out everywhere."],
  ])
})

it("a refused action keeps the dialog open with the API's message and no toast", async () => {
  const message = "You cannot do this to someone whose role is yours or higher"
  const { request } = fakeRequest((_path, init) =>
    init?.method === "POST" ? Promise.resolve(fail(403, message)) : undefined
  )
  const { state, toasts } = await withDialog(request)
  await state.act()
  expect(state.dialog.value).toEqual({
    action: "block",
    sessionId: null,
    error: message,
    pending: false,
  })
  expect(toasts.list.value).toEqual([])
})

it("a second confirm while the action is on its way sends nothing more", async () => {
  let answer: (value: AdminApiResult<unknown>) => void = () => {}
  const { request, calls } = fakeRequest((_path, init) =>
    init?.method === "POST" ? new Promise((resolve) => answer = resolve) : undefined
  )
  const { state } = await withDialog(request)
  const first = state.act()
  await state.act()
  answer(ok({ user: grace }))
  await first
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
    `POST /api/admin/users/42/block`,
  ])
})

it("ends the one session the dialog was opened for, and toasts it", async () => {
  const { request, calls } = fakeRequest()
  const { state, toasts } = await withDialog(request)
  state.openDialog("end-session", 9)
  await state.act()
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
    `POST /api/admin/users/42/sessions/9/end`,
  ])
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([
    "One session of Grace Hopper has ended.",
  ])
})

it("sends the role picked in the dialog as the body of a role change", async () => {
  const { request, calls } = fakeRequest()
  const { state, toasts } = await withDialog(request)
  state.openDialog("change-role")
  await state.act({ role: UserRole.OPERATOR })
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
    `POST /api/admin/users/42/role {"role":2}`,
  ])
  expect(toasts.list.value.map((toast) => toast.body)).toEqual(["Grace Hopper is now operator."])
})

it("sends nothing for a role change without a role", async () => {
  const { request, calls } = fakeRequest()
  const { state } = await withDialog(request)
  state.openDialog("change-role")
  await state.act()
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([])
  expect(state.dialog.value.action).toBe("change-role")
})

it("asks the API to mail a password-reset link, and toasts it", async () => {
  const { request, calls } = fakeRequest()
  const { state, toasts } = await withDialog(request)
  state.openDialog("password-reset")
  await state.act()
  expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
    `POST /api/admin/users/42/password-reset`,
  ])
  expect(toasts.list.value.map((toast) => toast.body)).toEqual([
    "A password-reset link is on its way to Grace Hopper.",
  ])
})

it("reads a person's data exports, dropping an answer for a person the page has left", async () => {
  let release: (value: AdminApiResult<unknown>) => void = () => {}
  const late = new Promise<AdminApiResult<unknown>>((resolve) => release = resolve)
  const { request, calls } = fakeRequest((path) =>
    path === `/api/admin/users/7/data-exports`
      ? late
      : path === `/api/admin/users/42/data-exports`
      ? Promise.resolve(ok({ exports: [{ id: `b` }] }))
      : undefined
  )
  const state = createUsersState(request, createToastStore())
  const first = state.loadDataExports(7)
  await state.loadDataExports(42)
  release(ok({ exports: [{ id: `a` }] }))
  await first

  expect(calls).toEqual([
    `GET /api/admin/users/7/data-exports`,
    `GET /api/admin/users/42/data-exports`,
  ])
  expect(state.dataExports.value).toEqual({ userId: 42, exports: [{ id: `b` }], error: null })
})

it("shows the API's message when a person's data exports cannot be read", async () => {
  const { request } = fakeRequest(() => Promise.resolve(fail(500, "Could not load.")))
  const state = createUsersState(request, createToastStore())
  await state.loadDataExports(42)
  expect(state.dataExports.value).toEqual({ userId: 42, exports: null, error: "Could not load." })
})
